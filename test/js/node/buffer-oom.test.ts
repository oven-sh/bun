import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isGlibc, tempDir } from "harness";
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
// What JSC throws for a string that it cannot make. The readers of UTF-8 bytes
// below throw it when the converter gives no string.
const outOfMemory = { name: "RangeError", message: "Out of memory" };

// Runs `script` in a child whose allocations fail above a cap (`env` sets the
// cap up, or the command that `wrap` puts in front of the child's). The script
// calls `run(label, fn)` per case; the child prints the collected results as
// JSON.
async function resultsUnderCap(
  env: Record<string, string | undefined>,
  script: string,
  { wrap = [] }: { wrap?: string[] } = {},
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
      console.log(JSON.stringify(results));
      `,
    ],
    env,
    stdout: "pipe",
    // ASAN prints a benign "failed to allocate" WARNING line per recovered
    // failure; drain it but do not assert on it.
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim() || stderr).toStartWith("{");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

// For a child: `bytesOf(length, prefix)` is `prefix` and then "a", `join` makes
// one buffer of strings and buffers, and `streamOf` is a stream of its chunks.
const utf8Inputs = `
  const bytesOf = (length, prefix = []) => {
    const bytes = Buffer.alloc(length, "a");
    bytes.set(prefix);
    return bytes;
  };
  const join = (...parts) => Buffer.concat(parts.map(part => (typeof part === "string" ? Buffer.from(part) : part)));
  const streamOf = (...chunks) =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  const directStreamOf = chunk =>
    new ReadableStream({
      type: "direct",
      pull(controller) {
        controller.write(chunk);
        controller.end();
      },
    });
`;
// The first bytes of an input that is not ASCII ("é"), and of one that is not UTF-8.
const notASCII = "[0xc3, 0xa9]";
const illFormed = "[0xff]";

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

  // The 8-bit copy that the converter of UTF-8 bytes makes of ASCII bytes. A
  // node:sqlite TEXT cell is the caller that can throw for it.
  test("an ASCII node:sqlite TEXT cell", async () => {
    const results = await resultsUnderCap(
      { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(4 * MiB) },
      `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(":memory:");
      const cell = length => db.prepare("SELECT CAST(? AS TEXT) AS text").get(Buffer.alloc(length, "a")).text;
      await run("6 MiB", () => cell(${6 * MiB}));
      // Under the cap, so the string is created.
      results["1 MiB"] = cell(${MiB}).length;
      `,
    );
    expect(results).toEqual({ "6 MiB": outOfMemory, "1 MiB": MiB });
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
      // Blob.json() parses the bytes where they lie. The string that it answers with has one byte a character and fits under the cap.
      const parsed = await new Blob([json]).json();
      results["Blob.json"] = { length: parsed.length, start: parsed.slice(0, 2) };
      await run("Response.text", () => new Response(nonAscii).text());
      await Bun.write(${JSON.stringify(file)}, nonAscii);
      await run("Bun.file.text", () => Bun.file(${JSON.stringify(file)}).text());
      `,
    );
    expect(results).toEqual({
      "TextDecoder.decode": allocationFailed,
      "Blob.text": allocationFailed,
      "Blob.json": { length: SIZE - 3, start: "\u00e9a" },
      "Response.text": allocationFailed,
      "Bun.file.text": allocationFailed,
    });
  });
});

// The converter of UTF-8 bytes replaces ill-formed sequences. For that it
// makes a buffer of two bytes for each input byte, and then a 16-bit string:
// 5 MiB are under this cap and their buffer is not. It ended the process when
// one of the two could not be allocated. `Malloc=1` makes WTF allocate with the
// system allocator, which the cap reaches.
describe.skipIf(!isASAN)("UTF-8 bytes whose string cannot be allocated", () => {
  const env = {
    ...bunEnv,
    Malloc: "1",
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=8", "detect_leaks=0"]
      .filter(Boolean)
      .join(":"),
  };
  const illFormedInput = `const illFormed = bytesOf(${5 * MiB}, ${illFormed});`;

  // Node 26 ends the process when the text of a stream is not ASCII and its
  // decoder cannot allocate.
  test.concurrent("the text of a stream", async () => {
    const results = await resultsUnderCap(
      env,
      `
      ${utf8Inputs}
      ${illFormedInput}
      await run("Bun.readableStreamToText", () => Bun.readableStreamToText(streamOf(illFormed)));
      // The buffer is 8 bytes under the cap. The string is as long, and has a header.
      await run("Bun.readableStreamToText, 16-bit string", () =>
        Bun.readableStreamToText(streamOf(illFormed.subarray(0, ${4 * MiB - 4}))));
      await run("Bun.readableStreamToText, two chunks", () =>
        Bun.readableStreamToText(streamOf(illFormed.subarray(0, ${2 * MiB}), illFormed.subarray(${2 * MiB}))));
      await run("Response.text of a stream", () => new Response(streamOf(illFormed)).text());
      await run("Response.text of a direct stream", () => new Response(directStreamOf(illFormed)).text());
      // Under the cap, so the string is created.
      const replaced = await Bun.readableStreamToText(streamOf(illFormed.subarray(0, ${MiB})));
      results["1 MiB"] = [replaced.length, replaced.codePointAt(0)];
      `,
    );
    expect(results).toEqual({
      "Bun.readableStreamToText": outOfMemory,
      "Bun.readableStreamToText, 16-bit string": outOfMemory,
      "Bun.readableStreamToText, two chunks": outOfMemory,
      "Response.text of a stream": outOfMemory,
      "Response.text of a direct stream": outOfMemory,
      "1 MiB": [MiB, 0xfffd],
    });
  });

  // Node 26 ends the process when `buffer.transcode` cannot allocate.
  test.concurrent("Bun.JSONL, CString, buffer.transcode and the name of a File", async () => {
    const results = await resultsUnderCap(
      env,
      `
      import { CString, ptr } from "bun:ffi";
      import { deserialize, serialize } from "bun:jsc";
      import { transcode } from "node:buffer";
      ${utf8Inputs}
      ${illFormedInput}
      await run("Bun.JSONL.parse", () => Bun.JSONL.parse(join('{"a":"', illFormed, '"}\\n')));
      await run("Bun.JSONL.parseChunk", () => Bun.JSONL.parseChunk(join('{"a":"', illFormed, '"}\\n')));
      const terminated = join(illFormed, "\\0");
      await run("CString", () => new CString(ptr(terminated)).toString());
      await run("buffer.transcode", () => transcode(illFormed, "utf8", "latin1"));
      // A string that owns its copy carries why it has none: the name of a File that was serialized.
      const record = Buffer.from(serialize(new File(["x"], Buffer.alloc(${4.5 * MiB}, "a").toString())));
      record[record.indexOf("aaaa")] = 0xff;
      await run("the name of a deserialized File", () => deserialize(record).name);
      `,
    );
    expect(results).toEqual({
      "Bun.JSONL.parse": outOfMemory,
      "Bun.JSONL.parseChunk": outOfMemory,
      "CString": outOfMemory,
      "buffer.transcode": outOfMemory,
      "the name of a deserialized File": allocationFailed,
    });
  });

  // decodeURIComponentSIMD copies ASCII bytes with no "%". With a "%" it makes a
  // buffer as long as the input. The child maps a file for these: the cap does
  // not reach a mapping, so the ASCII bytes can be longer than it. For valid
  // bytes that are not ASCII it gave "", or dropped them after a "%".
  test.concurrent("decodeURIComponentSIMD", async () => {
    using dir = tempDir("buffer-oom-decode", {});
    const file = join(String(dir), "ascii.txt");
    await Bun.write(file, Buffer.concat([Buffer.alloc(10 * MiB, "a"), Buffer.from("%41")]));
    const results = await resultsUnderCap(
      env,
      `
      import { decodeURIComponentSIMD } from "bun:internal-for-testing";
      ${utf8Inputs}
      ${illFormedInput}
      const mapped = Bun.mmap(${JSON.stringify(file)});
      const valid = bytesOf(${5 * MiB}, ${notASCII});
      await run("ill-formed", () => decodeURIComponentSIMD(illFormed));
      await run("ill-formed, after %41", () => decodeURIComponentSIMD(join("%41", illFormed)));
      await run("valid", () => decodeURIComponentSIMD(valid));
      await run("valid, after %41", () => decodeURIComponentSIMD(join("%41", valid)));
      await run("ASCII", () => decodeURIComponentSIMD(mapped.subarray(0, ${10 * MiB})));
      await run("ASCII, before %41", () => decodeURIComponentSIMD(mapped));
      // The escape is "€", so the 5 MiB before it need a 16-bit buffer of 10 MiB.
      const cookie = "a=" + Buffer.alloc(${5 * MiB}, "a") + "%E2%82%AC";
      await run("Bun.CookieMap, ASCII before an escape", () => new Bun.CookieMap(cookie).size);
      `,
    );
    expect(results).toEqual({
      "ill-formed": outOfMemory,
      "ill-formed, after %41": outOfMemory,
      "valid": outOfMemory,
      "valid, after %41": outOfMemory,
      "ASCII": outOfMemory,
      "ASCII, before %41": outOfMemory,
      "Bun.CookieMap, ASCII before an escape": outOfMemory,
    });
  });

  // The text of a cell (5 MiB), and the SQL of a statement (4.4 MiB of UTF-8).
  // These called WTF's converter with no helper, which ended the process for
  // valid UTF-8 too.
  test.concurrent("SQLite text", async () => {
    const results = await resultsUnderCap(
      env,
      `
      import { Database } from "bun:sqlite";
      import { DatabaseSync } from "node:sqlite";
      ${utf8Inputs}
      const db = new DatabaseSync(":memory:");
      const text = bytesOf(${5 * MiB}, ${notASCII});
      await run("node:sqlite TEXT", () => db.prepare("SELECT CAST(? AS TEXT) AS text").get(text).text);
      const sql = "SELECT '" + Buffer.alloc(${2.2 * MiB}, 0xe9).toString("latin1") + "'";
      const statement = db.prepare(sql);
      await run("node:sqlite sourceSQL", () => statement.sourceSQL);
      await run("node:sqlite expandedSQL", () => statement.expandedSQL);
      await run("bun:sqlite toString", () => new Database(":memory:").prepare(sql).toString());
      // Under the cap, so the string is created.
      results["1 MiB"] = db.prepare("SELECT CAST(? AS TEXT) AS text").get(text.subarray(0, ${MiB})).text.length;
      `,
    );
    expect(results).toEqual({
      "node:sqlite TEXT": outOfMemory,
      "node:sqlite sourceSQL": outOfMemory,
      "node:sqlite expandedSQL": outOfMemory,
      "bun:sqlite toString": outOfMemory,
      "1 MiB": MiB - 1,
    });
  });

  // A caller with no error path ends the process with the out-of-memory
  // report: here the name of a column (4.5 MiB of UTF-8), which becomes a
  // property key.
  test.concurrent("a caller that cannot throw reports out of memory", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { DatabaseSync } from "node:sqlite";
        const name = Buffer.alloc(${4.5 * MiB}, "\u20ac").toString();
        console.log(Object.keys(new DatabaseSync(":memory:").prepare('SELECT 1 AS "' + name + '"').get()).length);
        `,
        "--debug-crash-handler-use-trace-string",
      ],
      // The crash is deliberate, so it must not be uploaded as a crash report.
      env: { ...env, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const outOfMemory = stderr.includes("Bun has run out of memory");
    expect({
      stdout,
      outOfMemory,
      // Only populated when the assertion is about to fail, so the diff shows why.
      stderr: outOfMemory ? "" : stderr,
      signalCode: proc.signalCode,
    }).toEqual({ stdout: "", outOfMemory: true, stderr: "", signalCode: "SIGABRT" });
    expect(exitCode).not.toBe(0);
  });
});

// A release build has neither cap, but an address-space limit makes its
// allocator return null. An ASAN build cannot start under the limit, and the
// parts of the address space below are measured with glibc. For the child:
// `partOfFree(part)` is that part of the address space that is left, in whole
// MiB.
const underAddressSpaceLimit = (script: string) =>
  resultsUnderCap(
    // One glibc arena, so that a thread that starts does not reserve another 64 MiB. No JIT, so that
    // its pool (1 GiB on x64, 512 MiB on arm64) takes the same part of the limit on each: none.
    { ...bunEnv, MALLOC_ARENA_MAX: "1", BUN_JSC_useJIT: "0" },
    `
    import { readFileSync } from "node:fs";
    const limit = Number(/Max address space\\s+(\\d+)/.exec(readFileSync("/proc/self/limits", "utf8"))[1]);
    const used = Number(/VmSize:\\s+(\\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))[1]) * 1024;
    const partOfFree = part => Math.floor(((limit - used) * part) / ${MiB}) * ${MiB};
    ${script}
    `,
    { wrap: ["/bin/sh", "-c", `ulimit -v ${1024 * 1024} && exec "$0" "$@"`] },
  );

// The input takes 60% of the address space that is left, so a string of it
// cannot fit beside it. Nothing writes to the input but its first byte, so it
// costs no memory.
test.concurrent.skipIf(isASAN || !isGlibc)(
  "the text of a stream, Bun.JSONL and decodeURIComponentSIMD under an address-space limit",
  async () => {
    const results = await underAddressSpaceLimit(`
      import { decodeURIComponentSIMD } from "bun:internal-for-testing";
      ${utf8Inputs}
      const input = new Uint8Array(partOfFree(0.6));

      // NUL bytes are ASCII, so the string is as long as the input.
      await run("decodeURIComponentSIMD, ASCII", () => decodeURIComponentSIMD(input));

      // With an ill-formed byte, the conversion starts with a buffer of twice the size.
      input.set(${illFormed});
      await run("Bun.readableStreamToText", () => Bun.readableStreamToText(streamOf(input)));
      await run("Response.text of a stream", () => new Response(streamOf(input)).text());
      await run("Bun.JSONL.parse", () => Bun.JSONL.parse(input));
      await run("Bun.JSONL.parseChunk", () => Bun.JSONL.parseChunk(input));
      await run("decodeURIComponentSIMD", () => decodeURIComponentSIMD(input));
      // Fits in what is left, so the string is created.
      results["1 MiB"] = (await Bun.readableStreamToText(streamOf(input.subarray(0, ${MiB})))).length;
    `);
    expect(results).toEqual({
      "decodeURIComponentSIMD, ASCII": outOfMemory,
      "Bun.readableStreamToText": outOfMemory,
      "Response.text of a stream": outOfMemory,
      "Bun.JSONL.parse": outOfMemory,
      "Bun.JSONL.parseChunk": outOfMemory,
      "decodeURIComponentSIMD": outOfMemory,
      "1 MiB": MiB,
    });
  },
);

// The ASAN cap cannot fail a copy that is as long as its source: the name and
// the value of a cookie with no "%", which stay 8-bit. Each cookie child keeps
// its input alive, so the copy cannot fit. The SQLite child reads a cell that
// is not ASCII with the allocator of a release build. The text takes a quarter
// of the address space that is left and SQLite copies it, so the converter's
// buffer of twice its size cannot fit.
test.concurrent.skipIf(isASAN || !isGlibc)("node:sqlite and Bun.CookieMap under an address-space limit", async () => {
  const cookie = (write: string) => `
    const bytes = Buffer.alloc(partOfFree(0.4), "x");
    ${write};
    const cookie = bytes.toString("latin1");
    await run("Bun.CookieMap", () => new Bun.CookieMap(cookie).size + bytes.length);
  `;
  const results = await Promise.all([
    underAddressSpaceLimit(`
      import { DatabaseSync } from "node:sqlite";
      const text = new Uint8Array(partOfFree(0.25)).fill(0x61);
      text.set(${notASCII});
      const db = new DatabaseSync(":memory:");
      await run("node:sqlite TEXT", () => db.prepare("SELECT CAST(? AS TEXT) AS text").get(text).text + text.length);
    `),
    // A value, in a header with no "%".
    underAddressSpaceLimit(cookie(`bytes.write("a=")`)),
    // A name, in a header with a "%".
    underAddressSpaceLimit(cookie(`bytes.write("=%41", bytes.length - 4)`)),
  ]);
  expect(results).toEqual([
    { "node:sqlite TEXT": outOfMemory },
    { "Bun.CookieMap": outOfMemory },
    { "Bun.CookieMap": outOfMemory },
  ]);
});

// For up to 1,024 bytes the buffer of the converter is on the stack. An
// ill-formed byte gives one UTF-16 unit, so these inputs fill that buffer, or
// are one unit over it.
test("ill-formed UTF-8 bytes at the end of the converter's stack buffer", async () => {
  const textOf = (bytes: Uint8Array) =>
    Bun.readableStreamToText(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    );
  for (const size of [1023, 1024, 1025, 1026]) {
    for (const at of [0, size - 1]) {
      const bytes = new Uint8Array(size).fill(0x61);
      bytes[at] = 0xff;
      expect(await textOf(bytes)).toBe(Buffer.alloc(at, "a") + "\uFFFD" + Buffer.alloc(size - 1 - at, "a"));
    }
    expect(await textOf(new Uint8Array(size).fill(0xff))).toBe(Buffer.alloc(size * 3, "\uFFFD").toString());
  }
});
