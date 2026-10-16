import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
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

// Runs `script` in a child whose allocations fail above a cap (`env` sets the
// cap up). The script calls `run(label, fn)` per case; the child prints the
// collected results as JSON.
async function resultsUnderCap(env: Record<string, string | undefined>, script: string) {
  await using proc = Bun.spawn({
    cmd: [
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
});
