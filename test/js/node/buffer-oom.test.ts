import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
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

// Runs `script` in a child whose allocations fail above a cap (`env` or
// `launcher` sets the cap up). The script calls `run(label, fn)` per case; the
// child prints the collected results as JSON.
async function resultsUnderCap(env: Record<string, string | undefined>, script: string, launcher: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [
      ...launcher,
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

const envWithAsanCap = (mib: number) => ({
  ...bunEnv,
  // `detect_leaks=0` (last wins): natives owned only by a JSC cell are
  // invisible to LeakSanitizer's reachability scan and get reported at exit.
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", `max_allocation_size_mb=${mib}`, "detect_leaks=0"]
    .filter(Boolean)
    .join(":"),
});

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
});

// Every allocation that a TextDecoder makes for 64 MiB of input is that long or
// longer, and here each is refused. At `ulimit -v` the kernel refuses them all,
// but ASAN's shadow memory does not fit under it. An ASAN build has ASAN's cap
// for what Rust allocates and, if it is a debug build too, WTF's for the rest.
describe.skipIf(!isASAN && !isLinux)("TextDecoder reports an allocation that fails", () => {
  const SIZE = 64 * MiB;
  const underRefusal = (script: string) =>
    isASAN
      ? resultsUnderCap(
          { ...envWithAsanCap(40), BUN_JSC_maxSingleAllocationSize: isDebug ? String(40 * MiB) : undefined },
          // Both caps are on malloc. A WebAssembly.Memory is mapped, so this input can be longer than they are.
          `const input = new Uint8Array(new WebAssembly.Memory({ initial: ${SIZE / 65536} }).buffer);
          ${script}`,
        )
      : resultsUnderCap(
          bunEnv,
          // Pages that are never written take address space without taking memory.
          `const input = new Uint8Array(${SIZE});
          const held = [];
          try { for (;;) held.push(new ArrayBuffer(${SIZE})); } catch {}
          ${script}`,
          ["sh", "-c", 'ulimit -c 0 && ulimit -v 4194304 && exec "$0" "$@"'],
        );
  const through = `
    const through = async (...args) => {
      const source = new ReadableStream({ start(c) { c.enqueue(input); c.close(); } });
      return (await Array.fromAsync(source.pipeThrough(new TextDecoderStream(...args)))).join("");
    };
  `;

  // The input is all zero bytes, which are ASCII.
  test.concurrent.skipIf(isASAN && !isDebug)(
    "for the 8-bit string of all-ASCII bytes, which WTF allocates",
    async () => {
      const results = await underRefusal(`
      ${through}
      await run("utf-8", () => new TextDecoder().decode(input));
      await run("utf-8, stream", () => new TextDecoder().decode(input, { stream: true }));
      await run("utf-8, fatal", () => new TextDecoder("utf-8", { fatal: true }).decode(input));
      await run("latin1", () => new TextDecoder("latin1").decode(input));
      await run("TextDecoderStream(utf-8)", () => through());
      await run("TextDecoderStream(utf-8, fatal)", () => through("utf-8", { fatal: true }));
      await run("TextDecoderStream(latin1)", () => through("latin1"));
    `);
      expect(results).toEqual({
        "utf-8": allocationFailed,
        "utf-8, stream": allocationFailed,
        "utf-8, fatal": allocationFailed,
        "latin1": allocationFailed,
        "TextDecoderStream(utf-8)": allocationFailed,
        "TextDecoderStream(utf-8, fatal)": allocationFailed,
        "TextDecoderStream(latin1)": allocationFailed,
      });
    },
  );

  test.concurrent("for what Rust allocates, and keeps what it carried for the stream alone", async () => {
    const results = await underRefusal(`
      ${through}
      const bytes = (...values) => new Uint8Array(values);
      await run("utf-16le", () => new TextDecoder("utf-16le").decode(input));
      await run("utf-16be", () => new TextDecoder("utf-16be").decode(input));
      await run("euc-kr", () => new TextDecoder("euc-kr").decode(input));
      await run("TextDecoderStream(utf-16le)", () => through("utf-16le"));

      const utf8 = new TextDecoder();
      utf8.decode(bytes(0xc3), { stream: true });
      await run("utf-8 after half a character", () => utf8.decode(input, { stream: true }));
      results["utf-8 goes on with the other half"] = utf8.decode(bytes(0xa9), { stream: true });
      utf8.decode(bytes(0xc3), { stream: true });
      await run("utf-8 flush after half a character", () => utf8.decode(input));
      results["utf-8 starts a new stream"] = utf8.decode(bytes(0xef, 0xbb, 0xbf, 0x41));

      const utf16 = new TextDecoder("utf-16le");
      utf16.decode(bytes(0x41), { stream: true });
      await run("utf-16le after half a unit", () => utf16.decode(input, { stream: true }));
      results["utf-16le goes on with the other half"] = utf16.decode(bytes(0x00), { stream: true });
      utf16.decode(bytes(0x41), { stream: true });
      await run("utf-16le flush after half a unit", () => utf16.decode(input));
      results["utf-16le starts a new stream"] = utf16.decode(bytes(0xff, 0xfe, 0x42, 0x00));

      const eucKr = new TextDecoder("euc-kr");
      eucKr.decode(bytes(0xb0), { stream: true });
      await run("euc-kr flush after half a character", () => eucKr.decode(input));
      results["euc-kr starts a new stream"] = eucKr.decode(bytes(0x41));

      input[0] = 0xe9;
      await run("utf-8, not ASCII", () => new TextDecoder().decode(input));
      await run("latin1, not ASCII", () => new TextDecoder("latin1").decode(input));
    `);
    expect(results).toEqual({
      "utf-16le": allocationFailed,
      "utf-16be": allocationFailed,
      "euc-kr": allocationFailed,
      "TextDecoderStream(utf-16le)": allocationFailed,
      "utf-8 after half a character": allocationFailed,
      "utf-8 goes on with the other half": "é",
      "utf-8 flush after half a character": allocationFailed,
      "utf-8 starts a new stream": "A",
      "utf-16le after half a unit": allocationFailed,
      "utf-16le goes on with the other half": "A",
      "utf-16le flush after half a unit": allocationFailed,
      "utf-16le starts a new stream": "B",
      "euc-kr flush after half a character": allocationFailed,
      "euc-kr starts a new stream": "A",
      "utf-8, not ASCII": allocationFailed,
      "latin1, not ASCII": allocationFailed,
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
  const env = envWithAsanCap(40);
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
