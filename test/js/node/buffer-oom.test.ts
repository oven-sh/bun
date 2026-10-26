import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir, tls as tlsCert } from "harness";
import { join } from "node:path";

const MiB = 1024 ** 2;

// Node's error for a failed allocation (node_errors.h). Node throws it for
// utf8, latin1 and ucs2 and aborts for hex and base64; Bun throws it for every
// encoding.
const allocationFailed = {
  name: "RangeError",
  code: "ERR_MEMORY_ALLOCATION_FAILED",
  message: "Failed to allocate memory",
};
// What JSC throws for a string that it cannot make. The callers that threw it before they had the error above still do.
const outOfMemory = { name: "RangeError", message: "Out of memory" };

// Runs `script` in a child whose allocations fail above a cap (`env` sets the
// cap up, or the command that `wrap` puts in front of the child's). The script
// calls `run(label, fn)` per case; the child prints the collected results as
// JSON on its last line.
async function resultsUnderCap(
  env: Record<string, string | undefined>,
  script: string,
  { wrap = [], ...options }: { cwd?: string; stdin?: Blob; argv0?: string; wrap?: string[] } = {},
) {
  await using proc = Bun.spawn({
    cmd: [
      ...wrap,
      bunExe(),
      "-e",
      `
      import { StringDecoder } from "node:string_decoder";
      const results = {};
      const run = async (label, fn) => {
        try { results[label] = "unexpected success: " + String(await fn()).length; }
        catch (e) { results[label] = { name: e.name, code: e.code, message: e.message }; }
      };
      ${script}
      console.log("\\n" + JSON.stringify(results));
      `,
    ],
    env,
    ...options,
    stdout: "pipe",
    // ASAN prints a benign "failed to allocate" WARNING line per recovered
    // failure; drain it but do not assert on it.
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results = stdout.trim().split("\n").at(-1);
  expect(results || stderr).toStartWith("{");
  expect(exitCode).toBe(0);
  return JSON.parse(results!);
}

// `length` bytes: `prefix`, then "a".
const bytesOf = (length: number, prefix: number[] = []) => {
  const bytes = Buffer.alloc(length, "a");
  bytes.set(prefix);
  return bytes;
};
// The first bytes of an input that is not ASCII ("é"), and of one that is not UTF-8.
const notASCII = [0xc3, 0xa9];
const illFormed = [0xff];
// For a child: one input of `length` bytes of each kind, and `join`, which makes one buffer of strings and buffers.
const inputsOf = (length: number) => `
  const bytesOf = ${bytesOf};
  const inputs = {
    "ASCII": bytesOf(${length}),
    "not ASCII": bytesOf(${length}, ${JSON.stringify(notASCII)}),
    "ill-formed": bytesOf(${length}, ${JSON.stringify(illFormed)}),
  };
  const join = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
`;
// For a child: a Response with a multipart body of one part, and one with a URL-encoded body.
const formDataSource = `
  const multipart = (...part) =>
    new Response(join("--x\\r\\ncontent-disposition: form-data; ", ...part, "\\r\\n--x--\\r\\n"), {
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
  const urlEncoded = value =>
    new Response(join("a=", value), { headers: { "content-type": "application/x-www-form-urlencoded" } });
`;

// Writes `chunk` to a TextDecoderStream and reads what comes out. The writer
// closes after the write, so a stream that drops the chunk ends the read too.
const readThroughTextDecoderStream = `
  const readThrough = async (chunk, ...args) => {
    const stream = new TextDecoderStream(...args);
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const [, read] = await Promise.all([
      writer.write(chunk).then(() => writer.close()).catch(() => {}),
      reader.read(),
    ]);
    return read.value;
  };
`;

// `BUN_JSC_maxSingleAllocationSize` makes every WTF `try*` allocation above the
// cap return null, the way a failed allocation does. It exists in debug WTF
// only. The input is 16 MiB of ASCII, so every output below is 8 MiB or more
// and the 4 MiB cap fails exactly the output string's allocation. The encodings
// whose output buffer comes from the Rust allocator (which the WTF cap does not
// reach) are covered by the ASAN block further down.
describe.skipIf(!isDebug)("a WTF string whose allocation fails is reported as a failed allocation", () => {
  test("Buffer.prototype.toString and StringDecoder.prototype.write", async () => {
    const results = await resultsUnderCap(
      { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(4 * MiB) },
      `
      const input = Buffer.alloc(${16 * MiB}, 97);
      for (const encoding of ["utf8", "hex", "latin1", "ascii", "ucs2"]) {
        await run("toString(" + encoding + ")", () => input.toString(encoding));
      }
      await run("StringDecoder(utf8).write", () => new StringDecoder("utf8").write(input));
      // Under the cap, so the string is created.
      results["1 MiB toString(hex)"] = Buffer.alloc(${MiB}, 97).toString("hex").length;
      `,
    );
    expect(results).toEqual({
      "toString(utf8)": allocationFailed,
      "toString(hex)": allocationFailed,
      "toString(latin1)": allocationFailed,
      "toString(ascii)": allocationFailed,
      "toString(ucs2)": allocationFailed,
      "StringDecoder(utf8).write": allocationFailed,
      "1 MiB toString(hex)": 2 * MiB,
    });
  });

  // `process.env` and a string over bytes that Rust lends are copied in C++,
  // and gave "" when the copy failed. The environment of a process cannot hold
  // a value this long, so `process.env.BIG` comes from a .env file.
  test("process.env and a string of borrowed bytes", async () => {
    using dir = tempDir("buffer-oom-env", { ".env": "BIG=" + Buffer.alloc(5 * MiB, "a").toString() + "\n" });
    const results = await resultsUnderCap(
      { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(4 * MiB) },
      `
      import { $ } from "bun";
      await run("process.env.BIG", () => process.env.BIG);
      // The failed read is not cached as the value.
      await run("process.env.BIG again", () => process.env.BIG);
      // The token list of 512 KiB of "a," is about 5 MiB of JSON.
      await run("$.braces", () => $.braces("{" + Buffer.alloc(${MiB / 2}, "a,").toString() + "a}", { tokenize: true }));
      // Under the cap, so the string is created.
      results["$.braces({a,b})"] = $.braces("{a,b}", { tokenize: true }).length;
      `,
      { cwd: String(dir) },
    );
    expect(results).toEqual({
      "process.env.BIG": allocationFailed,
      "process.env.BIG again": allocationFailed,
      "$.braces": allocationFailed,
      "$.braces({a,b})": 76,
    });
  });

  // Bytes that Rust tags as UTF-8 went to a WTF converter that ends the
  // process when an allocation fails. For ASCII bytes it makes an 8-bit string.
  // For other bytes it makes a buffer of two bytes for each one, and then a
  // 16-bit string. `prompt` tags every line as UTF-8, and each of the first
  // three lines is over the cap in one of those three requests.
  test("prompt", async () => {
    const results = await resultsUnderCap(
      { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(4 * MiB) },
      `
      for (const label of ["8-bit string", "buffer", "16-bit string", "ill-formed"]) await run(label, () => prompt());
      // Under the cap, so the string is created.
      results["short line"] = prompt();
      `,
      {
        stdin: new Blob([
          bytesOf(5 * MiB),
          "\n",
          // 2.8 MiB of UTF-8, so a buffer of 5.6 MiB.
          Buffer.alloc(2 * 1_400_000, "é"),
          "\n",
          // The buffer is 4 bytes under the cap. The string has one unit less, and a header.
          bytesOf(2 * MiB - 2, notASCII),
          "\n",
          bytesOf(5 * MiB, illFormed),
          "\né\n",
        ]),
      },
    );
    expect(results).toEqual({
      "8-bit string": allocationFailed,
      "buffer": allocationFailed,
      "16-bit string": allocationFailed,
      "ill-formed": allocationFailed,
      "short line": "é",
    });
  });

  // These copies throw the error that the Latin-1 and UTF-16 copies throw. A
  // multipart part and a URL-encoded body are tagged as UTF-8 also when they
  // are ASCII.
  test("process.env, $.braces, FormData and Response.json with bytes that are not ASCII", async () => {
    using dir = tempDir("buffer-oom-utf8", {
      ".env": Buffer.concat([
        Buffer.from("NOT_ASCII="),
        bytesOf(5 * MiB, notASCII),
        Buffer.from("\nILL_FORMED="),
        bytesOf(5 * MiB, illFormed),
        Buffer.from("\n"),
      ]),
    });
    const results = await resultsUnderCap(
      { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(4 * MiB) },
      `
      import { $ } from "bun";
      ${inputsOf(5 * MiB)}
      await run("process.env.NOT_ASCII", () => process.env.NOT_ASCII);
      // The failed read is not cached as the value.
      await run("process.env.NOT_ASCII again", () => process.env.NOT_ASCII);
      await run("process.env.ILL_FORMED", () => process.env.ILL_FORMED);
      await run("{ ...process.env }", () => ({ ...process.env }));
      // The token list of "é" and 512 KiB of "a," is about 5 MiB of JSON.
      await run("$.braces", () => $.braces("{é," + Buffer.alloc(${MiB / 2}, "a,").toString() + "a}", { tokenize: true }));
      ${formDataSource}
      for (const [kind, value] of Object.entries(inputs)) {
        await run("multipart value, " + kind, async () => (await multipart('name="a"\\r\\n\\r\\n', value).formData()).get("a"));
        await run("URL-encoded value, " + kind, async () => (await urlEncoded(value).formData()).get("a"));
      }
      await run("multipart name", async () =>
        [...(await multipart('name="', inputs["not ASCII"], '"\\r\\n\\r\\nv').formData()).keys()][0]);
      await run("multipart file name", async () =>
        (await multipart('name="a"; filename="', inputs["not ASCII"], '"\\r\\n\\r\\nv').formData()).get("a").name);
      await run("FormData.from", async () =>
        FormData.from(await multipart('name="a"\\r\\n\\r\\n', inputs["ASCII"]).bytes(), "x").get("a"));
      await run("Response.json", () => new Response(join('"', inputs["not ASCII"], '"')).json());
      // Under the cap, so the strings are created.
      results["short values"] = [
        (await multipart('name="a"\\r\\n\\r\\n', "é").formData()).get("a"),
        (await urlEncoded("é").formData()).get("a"),
        await new Response('"é"').json(),
      ];
      `,
      { cwd: String(dir) },
    );
    expect(results).toEqual({
      "process.env.NOT_ASCII": allocationFailed,
      "process.env.NOT_ASCII again": allocationFailed,
      "process.env.ILL_FORMED": allocationFailed,
      "{ ...process.env }": allocationFailed,
      "$.braces": allocationFailed,
      "multipart value, ASCII": allocationFailed,
      "URL-encoded value, ASCII": allocationFailed,
      "multipart value, not ASCII": allocationFailed,
      "URL-encoded value, not ASCII": allocationFailed,
      "multipart value, ill-formed": allocationFailed,
      "URL-encoded value, ill-formed": allocationFailed,
      "multipart name": allocationFailed,
      "multipart file name": allocationFailed,
      "FormData.from": allocationFailed,
      "Response.json": allocationFailed,
      "short values": ["é", "é", "é"],
    });
  });

  // These callers of the same converter already throw for a conversion that
  // gives no string. Until now, only 2^30 bytes or more reached that error.
  test("Bun.JSONL, the text of a stream, Bun.CookieMap, CString and the message of an error", async () => {
    const results = await resultsUnderCap(
      { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(4 * MiB) },
      `
      import { CString, ptr } from "bun:ffi";
      import { decodeURIComponentSIMD } from "bun:internal-for-testing";
      import { expect } from "bun:test";
      ${inputsOf(5 * MiB)}
      const streamOf = chunk => new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } });
      for (const [kind, value] of Object.entries(inputs)) {
        await run("Response.text of a stream, " + kind, () => new Response(streamOf(value)).text());
        await run("Bun.readableStreamToText, " + kind, () => Bun.readableStreamToText(streamOf(value)));
      }
      // Bun.JSONL makes its own copy of ASCII bytes, and sends other bytes to the converter.
      for (const [kind, value] of Object.entries(inputs)) {
        const line = join('"', value, '"\\n');
        await run("Bun.JSONL.parse, " + kind, () => Bun.JSONL.parse(line));
        await run("Bun.JSONL.parseChunk, " + kind, () => Bun.JSONL.parseChunk(line));
      }
      // With no "%", the input is copied.
      await run("decodeURIComponentSIMD, ASCII", () => decodeURIComponentSIMD(inputs["ASCII"]));
      await run("decodeURIComponentSIMD, not ASCII", () => decodeURIComponentSIMD(inputs["not ASCII"]));
      // With one, it makes a buffer as long as the input, and converts what is not ASCII around the "%".
      await run("decodeURIComponentSIMD with %41, buffer", () => decodeURIComponentSIMD(join("%41", inputs["ASCII"])));
      await run("decodeURIComponentSIMD with %41, conversion", () =>
        decodeURIComponentSIMD(join("%41", inputs["not ASCII"].subarray(0, ${3 * MiB}))));
      // The value of a cookie is decoded only when the header has a "%" in it: 2.6 MiB of UTF-8, so a buffer of 5.2 MiB.
      const cookie = "a=%41" + Buffer.alloc(1_300_000, "é", "latin1").toString("latin1");
      await run("Bun.CookieMap", () => new Bun.CookieMap(cookie).get("a"));
      // A CString of valid UTF-8 does not take this converter.
      const terminated = join(inputs["ill-formed"], "\\0");
      await run("CString", () => new CString(ptr(terminated)).toString());
      // Rust formats the message of this error as UTF-8: 3 MiB of it. The error is made with another message.
      const message = Buffer.alloc(${3 * MiB}, "é").toString();
      await run("expect", () => expect(1, message).toBe(2));
      // Under the cap, so the strings are created.
      results["short values"] = [
        Bun.JSONL.parse(Buffer.from('"é"\\n'))[0],
        await Bun.readableStreamToText(streamOf(Buffer.from("é"))),
        decodeURIComponentSIMD(Buffer.from("%41é")),
        new Bun.CookieMap("a=%41é").get("a"),
        new CString(ptr(Buffer.from([0xff, 0]))).toString(),
      ];
      `,
    );
    expect(results).toEqual({
      "Response.text of a stream, ASCII": outOfMemory,
      "Bun.readableStreamToText, ASCII": outOfMemory,
      "Response.text of a stream, not ASCII": outOfMemory,
      "Bun.readableStreamToText, not ASCII": outOfMemory,
      "Response.text of a stream, ill-formed": outOfMemory,
      "Bun.readableStreamToText, ill-formed": outOfMemory,
      "Bun.JSONL.parse, ASCII": outOfMemory,
      "Bun.JSONL.parseChunk, ASCII": outOfMemory,
      "Bun.JSONL.parse, not ASCII": outOfMemory,
      "Bun.JSONL.parseChunk, not ASCII": outOfMemory,
      "Bun.JSONL.parse, ill-formed": outOfMemory,
      "Bun.JSONL.parseChunk, ill-formed": outOfMemory,
      "decodeURIComponentSIMD, ASCII": outOfMemory,
      "decodeURIComponentSIMD, not ASCII": outOfMemory,
      "decodeURIComponentSIMD with %41, buffer": outOfMemory,
      "decodeURIComponentSIMD with %41, conversion": outOfMemory,
      "Bun.CookieMap": outOfMemory,
      "CString": outOfMemory,
      "expect": { name: "Error", message: "Failed to allocate memory for the error message" },
      "short values": ["é", "é", "Aé", "Aé", "\ufffd"],
    });
  });

  // A parameter of a route is decoded as the value of a cookie is. The server
  // takes a request line this long only with a higher limit. The client is a
  // socket, because a URL string of 5 MiB is over the cap.
  test("a parameter of a Bun.serve route", async () => {
    const results = await resultsUnderCap(
      {
        ...bunEnv,
        BUN_JSC_maxSingleAllocationSize: String(4 * MiB),
        BUN_OPTIONS: `--max-http-header-size=${8 * MiB}`,
      },
      `
      import net from "node:net";
      ${inputsOf(5 * MiB)}
      using server = Bun.serve({
        port: 0,
        routes: { "/:id": request => new Response(String(request.params.id.length)) },
        error: error => new Response(error.name + ": " + error.message, { status: 500 }),
      });
      // The status and the body of the response.
      const get = path =>
        new Promise((resolve, reject) => {
          const chunks = [];
          const socket = net.connect(server.port, "127.0.0.1", () =>
            socket.end(join("GET /", path, " HTTP/1.1\\r\\nhost: x\\r\\nconnection: close\\r\\n\\r\\n")));
          socket.on("data", chunk => chunks.push(chunk));
          socket.on("error", reject);
          socket.on("close", () => {
            const response = Buffer.concat(chunks).toString();
            resolve(response.slice(9, 12) + " " + response.slice(response.indexOf("\\r\\n\\r\\n") + 4));
          });
        });
      results["ASCII"] = await get(inputs["ASCII"]);
      results["not ASCII"] = await get(inputs["not ASCII"]);
      // Under the cap, so the string is created.
      results["short"] = await get("%41é");
      `,
    );
    expect(results).toEqual({
      "ASCII": "500 RangeError: Out of memory",
      "not ASCII": "500 RangeError: Out of memory",
      "short": "200 2",
    });
  });
});

// A UTF-8 input with a non-ASCII character is transcoded into a Rust-owned
// UTF-16 buffer, and a large base64 output is encoded into a Rust-owned byte
// buffer; both are adopted by JSC afterwards. ASAN's per-allocation cap makes
// those allocations fail: the 36 MiB input fits under the 40 MiB cap while the
// 48 MiB base64 and 72 MiB UTF-16 outputs do not.
describe.skipIf(!isASAN)("a Rust-allocated string whose allocation fails is reported as a failed allocation", () => {
  const SIZE = 36 * MiB;
  const env = {
    ...bunEnv,
    // `detect_leaks=0` (last wins): natives owned only by a JSC cell are
    // invisible to LeakSanitizer's reachability scan and get reported at exit.
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=40", "detect_leaks=0"]
      .filter(Boolean)
      .join(":"),
  };
  const inputs = `
    const ascii = Buffer.alloc(${SIZE}, "a");
    const nonAscii = Buffer.alloc(${SIZE}, "a"); nonAscii[0] = 0xc3; nonAscii[1] = 0xa9;
    // '"' + '\\u00e9' + 'a'.repeat(${SIZE} - 4) + '"': a valid JSON string literal.
    const json = Buffer.alloc(${SIZE}, "a");
    json[0] = 0x22; json[1] = 0xc3; json[2] = 0xa9; json[${SIZE} - 1] = 0x22;
  `;

  test("Buffer.prototype.toString and StringDecoder.prototype.write", async () => {
    const results = await resultsUnderCap(
      env,
      `
      ${inputs}
      await run("toString(utf8)", () => nonAscii.toString("utf8"));
      await run("toString(base64)", () => ascii.toString("base64"));
      await run("toString(base64url)", () => ascii.toString("base64url"));
      await run("StringDecoder(utf8).write", () => new StringDecoder("utf8").write(nonAscii));
      await run("StringDecoder(base64).write", () => new StringDecoder("base64").write(ascii));
      `,
    );
    expect(results).toEqual({
      "toString(utf8)": allocationFailed,
      "toString(base64)": allocationFailed,
      "toString(base64url)": allocationFailed,
      "StringDecoder(utf8).write": allocationFailed,
      "StringDecoder(base64).write": allocationFailed,
    });
  });

  // Node 26 throws the same error from Blob.text() and Response.text(), and
  // aborts in TextDecoder.decode().
  test("TextDecoder.decode, Blob, Response and Bun.file", async () => {
    using dir = tempDir("buffer-oom", {});
    const file = join(String(dir), "non-ascii.txt");
    const results = await resultsUnderCap(
      env,
      `
      ${inputs}
      await run("TextDecoder.decode", () => new TextDecoder().decode(nonAscii));
      await run("Blob.text", () => new Blob([nonAscii]).text());
      await run("Blob.json", () => new Blob([json]).json());
      await run("Response.text", () => new Response(nonAscii).text());
      await Bun.write(${JSON.stringify(file)}, nonAscii);
      await run("Bun.file.text", () => Bun.file(${JSON.stringify(file)}).text());
      `,
    );
    expect(results).toEqual({
      "TextDecoder.decode": allocationFailed,
      "Blob.text": allocationFailed,
      "Blob.json": allocationFailed,
      "Response.text": allocationFailed,
      "Bun.file.text": allocationFailed,
    });
  });

  // An all-ASCII input is not transcoded: it is copied into a WTF string as
  // long as the input, and the decoder returned "" when that copy failed.
  // `Malloc=1` makes WTF allocate with the system allocator, which the cap
  // reaches. The input is a mapped file, which the cap does not reach, so it
  // can be longer than the cap.
  test("TextDecoder.decode of ASCII, TextDecoderStream and Bun.unsafe.arrayBufferToString", async () => {
    using dir = tempDir("buffer-oom-ascii", {});
    const file = join(String(dir), "ascii.txt");
    await Bun.write(file, Buffer.alloc(48 * MiB, "a"));
    const results = await resultsUnderCap(
      { ...env, Malloc: "1" },
      `
      ${readThroughTextDecoderStream}
      const ascii = Bun.mmap(${JSON.stringify(file)});
      await run("decode(utf-8)", () => new TextDecoder().decode(ascii));
      await run("decode(utf-8, fatal)", () => new TextDecoder("utf-8", { fatal: true }).decode(ascii));
      await run("decode(latin1)", () => new TextDecoder("latin1").decode(ascii));
      const decoder = new TextDecoder();
      await run("decode(utf-8, stream)", () => decoder.decode(ascii, { stream: true }));
      // The chunk that failed did not spend the BOM of the stream, and the decoder still works.
      results["the next chunk"] = decoder.decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61));
      await run("TextDecoderStream(latin1)", () => readThrough(ascii, "latin1"));
      await run("TextDecoderStream(utf-8, fatal)", () => readThrough(ascii, "utf-8", { fatal: true }));
      await run("arrayBufferToString(Uint8Array)", () => Bun.unsafe.arrayBufferToString(ascii));
      await run("arrayBufferToString(Uint16Array)", () =>
        Bun.unsafe.arrayBufferToString(new Uint16Array(ascii.buffer, ascii.byteOffset, ascii.byteLength / 2)));
      // Under the cap, so the string is created.
      results["32 MiB decode"] = new TextDecoder().decode(ascii.subarray(0, ${32 * MiB})).length;
      `,
    );
    expect(results).toEqual({
      "decode(utf-8)": allocationFailed,
      "decode(utf-8, fatal)": allocationFailed,
      "decode(latin1)": allocationFailed,
      "decode(utf-8, stream)": allocationFailed,
      "the next chunk": "a",
      "TextDecoderStream(latin1)": allocationFailed,
      "TextDecoderStream(utf-8, fatal)": allocationFailed,
      "arrayBufferToString(Uint8Array)": allocationFailed,
      "arrayBufferToString(Uint16Array)": allocationFailed,
      "32 MiB decode": 32 * MiB,
    });
  });

  // Bytes that are tagged as UTF-8 are copied by a converter that ended the
  // process when an allocation failed. It makes an 8-bit string of ASCII bytes:
  // the mapped file is longer than the cap. For other bytes it makes a buffer
  // of two bytes for each one, and then a 16-bit string: 24 MiB are under the
  // cap and their buffer is not.
  test("UTF-8 bytes: prompt, process.env, FormData, Response.json, Bun.JSONL and the text of a stream", async () => {
    const head = '--x\r\ncontent-disposition: form-data; name="a"\r\n\r\n';
    using dir = tempDir("buffer-oom-utf8", {
      ".env": Buffer.concat([Buffer.from("NOT_ASCII="), bytesOf(24 * MiB, notASCII), Buffer.from("\n")]),
      "multipart.txt": Buffer.concat([Buffer.from(head), bytesOf(48 * MiB), Buffer.from("\r\n--x--\r\n")]),
    });
    const results = await resultsUnderCap(
      { ...env, Malloc: "1" },
      `
      import { CString, ptr } from "bun:ffi";
      ${inputsOf(24 * MiB)}
      ${formDataSource}
      const streamOf = chunk => new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } });
      const notASCII = inputs["not ASCII"];
      await run("prompt", () => prompt());
      await run("process.env.NOT_ASCII", () => process.env.NOT_ASCII);
      await run("multipart value", async () => (await multipart('name="a"\\r\\n\\r\\n', notASCII).formData()).get("a"));
      await run("URL-encoded value", async () => (await urlEncoded(notASCII).formData()).get("a"));
      await run("Response.json", () => new Response(join('"', notASCII, '"')).json());
      await run("Bun.JSONL.parse", () => Bun.JSONL.parse(join('"', notASCII, '"\\n')));
      await run("Response.text of a stream", () => new Response(streamOf(notASCII)).text());
      await run("Bun.readableStreamToText", () => Bun.readableStreamToText(streamOf(notASCII)));
      await run("Bun.readableStreamToText, ill-formed", () => Bun.readableStreamToText(streamOf(inputs["ill-formed"])));
      // The buffer is 8 bytes under the cap. The string has one unit less, and a header.
      await run("Bun.readableStreamToText, 16-bit string", () =>
        Bun.readableStreamToText(streamOf(notASCII.subarray(0, ${20 * MiB - 4}))));
      // A CString of valid UTF-8 does not take this converter.
      const terminated = join(inputs["ill-formed"], "\\0");
      await run("CString", () => new CString(ptr(terminated)).toString());

      const mapped = Bun.mmap("multipart.txt");
      const ascii = mapped.subarray(${head.length}, ${head.length + 48 * MiB});
      await run("FormData.from, ASCII", () => FormData.from(mapped, "x").get("a"));
      await run("Bun.readableStreamToText, ASCII", () => Bun.readableStreamToText(streamOf(ascii)));
      // Under the cap, so the string is created.
      results["24 MiB of ASCII"] = (await Bun.readableStreamToText(streamOf(inputs["ASCII"]))).length;
      `,
      { cwd: String(dir), stdin: new Blob([bytesOf(24 * MiB, notASCII), "\n"]) },
    );
    expect(results).toEqual({
      "prompt": allocationFailed,
      "process.env.NOT_ASCII": allocationFailed,
      "multipart value": allocationFailed,
      "URL-encoded value": allocationFailed,
      "Response.json": allocationFailed,
      "Bun.JSONL.parse": outOfMemory,
      "Response.text of a stream": outOfMemory,
      "Bun.readableStreamToText": outOfMemory,
      "Bun.readableStreamToText, ill-formed": outOfMemory,
      "Bun.readableStreamToText, 16-bit string": outOfMemory,
      "CString": outOfMemory,
      "FormData.from, ASCII": allocationFailed,
      "Bun.readableStreamToText, ASCII": outOfMemory,
      "24 MiB of ASCII": 24 * MiB,
    });
  });
});

// A release build has neither cap, but an address-space limit makes its
// allocator return null. The input takes 60% of the address space that is
// left, so the string, which is as long, cannot fit beside it. Nothing writes
// to the input, so it costs no memory. An ASAN build cannot start under the
// limit.
const underAddressSpaceLimit = (script: string) =>
  resultsUnderCap(
    // One glibc arena, so that a thread that starts does not reserve another 64 MiB.
    { ...bunEnv, MALLOC_ARENA_MAX: "1" },
    `
    import { readFileSync } from "node:fs";
    const limit = Number(/Max address space\\s+(\\d+)/.exec(readFileSync("/proc/self/limits", "utf8"))[1]);
    const used = Number(/VmSize:\\s+(\\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))[1]) * 1024;
    const input = new Uint8Array(Math.floor(((limit - used) * 0.6) / ${MiB}) * ${MiB});
    // Takes what is left in blocks of that size, until none fits.
    const hold = [];
    try {
      for (;;) hold.push(new Uint8Array(input.length));
    } catch {}
    ${script}
    `,
    { wrap: ["/bin/sh", "-c", `ulimit -v ${1024 * 1024} && exec "$0" "$@"`] },
  );

test.skipIf(isASAN || !isLinux)(
  "TextDecoder.decode of ASCII and Bun.unsafe.arrayBufferToString under an address-space limit",
  async () => {
    const results = await underAddressSpaceLimit(`
      await run("decode(utf-8)", () => new TextDecoder().decode(input));
      await run("decode(latin1)", () => new TextDecoder("latin1").decode(input));
      await run("arrayBufferToString", () => Bun.unsafe.arrayBufferToString(input));
      // Fits in what is left, so the string is created.
      results["1 MiB decode"] = new TextDecoder().decode(input.subarray(0, ${MiB})).length;
    `);
    expect(results).toEqual({
      "decode(utf-8)": allocationFailed,
      "decode(latin1)": allocationFailed,
      "arrayBufferToString": allocationFailed,
      "1 MiB decode": MiB,
    });
  },
);

// These read the input where it is and copy it into a string, and that copy
// ended the process at 0xBBADBEEF. The input is a multipart body with one
// value of NUL bytes, which are ASCII, so the copy is an 8-bit string. With one
// byte that is not ASCII, the copy starts with a buffer of twice the size.
test.skipIf(isASAN || !isLinux)(
  "FormData.from, Bun.JSONL.parse and the text of a stream under an address-space limit",
  async () => {
    const results = await underAddressSpaceLimit(`
      const head = Buffer.from('--x\\r\\ncontent-disposition: form-data; name="a"\\r\\n\\r\\n');
      const tail = Buffer.from("\\r\\n--x--\\r\\n");
      input.set(head);
      input.set(tail, input.length - tail.length);
      const value = input.subarray(head.length, input.length - tail.length);
      const streamOf = chunk => new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } });
      for (const kind of ["ASCII", "not ASCII"]) {
        await run("FormData.from, " + kind, () => FormData.from(input, "x").get("a"));
        await run("Bun.readableStreamToText, " + kind, () => Bun.readableStreamToText(streamOf(value)));
        await run("Bun.JSONL.parse, " + kind, () => Bun.JSONL.parse(value));
        value.set(${JSON.stringify(notASCII)});
      }
      // Fits in what is left, so the string is created.
      results["1 MiB"] = (await Bun.readableStreamToText(streamOf(value.subarray(0, ${MiB})))).length;
    `);
    expect(results).toEqual({
      "FormData.from, ASCII": allocationFailed,
      "Bun.readableStreamToText, ASCII": outOfMemory,
      "Bun.JSONL.parse, ASCII": outOfMemory,
      "FormData.from, not ASCII": allocationFailed,
      "Bun.readableStreamToText, not ASCII": outOfMemory,
      "Bun.JSONL.parse, not ASCII": outOfMemory,
      "1 MiB": MiB - 1,
    });
  },
);

// `BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT` lowers the longest string that Bun
// copies from bytes, so a copy over it is refused the way a copy of 2^31 bytes
// is. Each of these gave the whole string or "" instead of an error.
describe("bytes that are copied into a string over the length limit", () => {
  const tooLong = {
    name: "Error",
    code: "ERR_STRING_TOO_LONG",
    message: "Cannot create a string longer than 2147483647 characters",
  };
  const big = Buffer.alloc(2 * MiB, "a").toString();
  // `TZ` of bunEnv would win over the .env file.
  const env = { ...bunEnv, TZ: undefined, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(MiB) };
  const dotEnv = (...keys: string[]) => ({ ".env": keys.map(key => `${key}=${big}\n`).join("") });

  test("process.env, $.braces, Blob, Request, FormData and Bun.unsafe.arrayBufferToString", async () => {
    // The last value is not ASCII, so its copy converts from UTF-8.
    const keys = ["BIG", "TZ", "NODE_TLS_REJECT_UNAUTHORIZED", "BUN_CONFIG_VERBOSE_FETCH", "NOT_ASCII"];
    using dir = tempDir("string-limit", { ".env": dotEnv(...keys.slice(0, -1))[".env"] + `NOT_ASCII=é${big}\n` });
    const results = await resultsUnderCap(
      env,
      `
      import { $ } from "bun";
      import { spawnSync } from "node:child_process";
      const ascii = new Uint8Array(${2 * MiB}).fill(97);
      const big = Buffer.from(ascii.buffer).toString("latin1");
      for (const key of ${JSON.stringify(keys)}) await run("process.env." + key, () => process.env[key]);
      // The failed read is not cached as the value.
      await run("process.env.BIG again", () => process.env.BIG);
      await run("$.braces", () => $.braces("{" + Buffer.alloc(${MiB / 2}, "a,").toString() + "a}", { tokenize: true }));
      await run("Blob.type", () => new Blob([], { type: big }).type);
      await run("Request.referrer", () => new Request("http://example.com/", { headers: { referrer: big } }).referrer);
      const formData = part =>
        new Response("--x\\r\\n" + part + "\\r\\n--x--\\r\\n", {
          headers: { "content-type": "multipart/form-data; boundary=x" },
        }).formData();
      await run("FormData field", async () =>
        (await formData('content-disposition: form-data; name="a"\\r\\n\\r\\n' + big)).get("a"));
      await run("FormData file name", async () =>
        (await formData('content-disposition: form-data; name="a"; filename="' + big + '"\\r\\n\\r\\nx')).get("a").name);
      await run("arrayBufferToString(Uint8Array)", () => Bun.unsafe.arrayBufferToString(ascii));
      await run("arrayBufferToString(Uint16Array)", () =>
        Bun.unsafe.arrayBufferToString(new Uint16Array(${2 * MiB}).fill(97)));
      // At the limit, so the string is created.
      results["1 MiB"] = Bun.unsafe.arrayBufferToString(ascii.subarray(0, ${MiB})).length;
      // A copy of process.env reads every variable, so it fails while one of them cannot be read.
      await run("{ ...process.env }", () => ({ ...process.env }));
      await run("child_process.spawnSync", () => spawnSync(process.execPath, ["-e", ""]));
      for (const key of ${JSON.stringify(keys)}) delete process.env[key];
      results["{ ...process.env } after delete"] = Object.keys({ ...process.env }).includes("BIG");
      `,
      { cwd: String(dir) },
    );
    expect(results).toEqual({
      "process.env.BIG": tooLong,
      "process.env.TZ": tooLong,
      "process.env.NODE_TLS_REJECT_UNAUTHORIZED": tooLong,
      "process.env.BUN_CONFIG_VERBOSE_FETCH": tooLong,
      "process.env.NOT_ASCII": tooLong,
      "process.env.BIG again": tooLong,
      "$.braces": tooLong,
      "Blob.type": tooLong,
      "Request.referrer": tooLong,
      "FormData field": tooLong,
      "FormData file name": tooLong,
      "arrayBufferToString(Uint8Array)": tooLong,
      "arrayBufferToString(Uint16Array)": tooLong,
      "1 MiB": MiB,
      "{ ...process.env }": tooLong,
      "child_process.spawnSync": tooLong,
      "{ ...process.env } after delete": false,
    });
  });

  // A variable with an integer name is read when `process.env` is made, so
  // while its value cannot be read, no variable can.
  test("process.env with an integer-named variable", async () => {
    using dir = tempDir("string-limit-integer", { ".env": `123=${big}\nSMALL=abc\n` });
    const results = await resultsUnderCap(
      env,
      `
      await run("process.env[123]", () => process.env[123]);
      await run("process.env.SMALL", () => process.env.SMALL);
      `,
      { cwd: String(dir) },
    );
    expect(results).toEqual({ "process.env[123]": tooLong, "process.env.SMALL": tooLong });
  });

  // The listener that prints a warning reads NODE_REDIRECT_WARNINGS first.
  test("NODE_REDIRECT_WARNINGS", async () => {
    using dir = tempDir("string-limit-warnings", dotEnv("NODE_REDIRECT_WARNINGS"));
    const results = await resultsUnderCap(
      env,
      `
      await run("process.emitWarning", async () => {
        const { promise, resolve, reject } = Promise.withResolvers();
        process.on("uncaughtException", reject);
        process.emitWarning("a warning");
        // The listener runs in a tick, before this.
        setImmediate(resolve, "printed");
        return await promise;
      });
      `,
      { cwd: String(dir) },
    );
    expect(results).toEqual({ "process.emitWarning": tooLong });
  });

  test("prompt", async () => {
    const results = await resultsUnderCap(env, `await run("prompt", () => prompt());`, {
      stdin: new Blob([big + "\n"]),
    });
    expect(results).toEqual({ prompt: tooLong });
  });

  // `process.argv0` is made on the first read. A read that throws makes no
  // property, so the next read copies the name again. A bcrypt hash has 60
  // characters, and its promise rejects.
  test("process.argv0 and Bun.password.hash", async () => {
    const argv0 = "the-name-that-this-process-was-started-with";
    const results = await resultsUnderCap(
      { ...env, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: "30" },
      `
      import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
      await run("process.argv0", () => process.argv0);
      await run("process.argv0 again", () => process.argv0);
      await run("Bun.password.hash", () => Bun.password.hash("password", { algorithm: "bcrypt", cost: 4 }));
      // The lowest limit that this sets is 1 MiB.
      setSyntheticAllocationLimitForTesting(${MiB});
      results["process.argv0 under the limit"] = process.argv0;
      `,
      { argv0 },
    );
    expect(results).toEqual({
      "process.argv0": tooLong,
      "process.argv0 again": tooLong,
      "Bun.password.hash": tooLong,
      "process.argv0 under the limit": argv0,
    });
  });

  // A TLS server copies the name that the client asks for, for SNICallback
  // and for ALPNCallback. A copy that fails ends that handshake, not the
  // process. No SNICallback ran, so the server reports a rejected connection.
  test("SNICallback and ALPNCallback", async () => {
    const results = await resultsUnderCap(
      { ...env, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: "100" },
      `
      import tls from "node:tls";
      const { cert, key } = ${JSON.stringify({ cert: tlsCert.cert, key: tlsCert.key })};
      const servername = Buffer.alloc(150, "a").toString() + ".example";
      const handshake = async (label, serverOptions, clientOptions) => {
        const { promise, resolve } = Promise.withResolvers();
        // What the server reports, and whether the client gets a session.
        const events = [];
        const server = tls.createServer({ key, cert, ...serverOptions }, socket => socket.end());
        server.on("tlsClientError", error => events.push("tlsClientError " + error.code));
        server.on("error", error => resolve(["server error " + error.code]));
        server.listen(0, "127.0.0.1", () => {
          const client = tls.connect({
            port: server.address().port,
            host: "127.0.0.1",
            servername,
            rejectUnauthorized: false,
            ...clientOptions,
          });
          client.on("error", () => {});
          client.on("secureConnect", () => events.push("secureConnect"));
          // The server closes after its side of the connection, so its events are complete.
          client.on("close", () => server.close(() => resolve(events)));
        });
        results[label] = await promise;
      };
      await handshake("SNICallback", { SNICallback: (name, callback) => callback(null, null) }, {});
      await handshake("ALPNCallback", { ALPNCallback: ({ protocols }) => protocols[0] }, { ALPNProtocols: ["h2"] });
      `,
    );
    expect(results).toEqual({
      SNICallback: ["tlsClientError ERR_SSL_CONNECTION_REJECTED"],
      ALPNCallback: ["tlsClientError ERR_STRING_TOO_LONG"],
    });
  });
});
