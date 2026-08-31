import { setMaxSingleAllocationSizeForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { StringDecoder } from "node:string_decoder";

const MiB = 1024 ** 2;

// Node's error for a failed allocation (node_errors.h). Node throws it for
// utf8, latin1 and ucs2 and aborts for hex and base64; Bun throws it for every
// encoding.
const allocationFailed = {
  name: "RangeError",
  code: "ERR_MEMORY_ALLOCATION_FAILED",
  message: "Failed to allocate memory",
};

// `setMaxSingleAllocationSizeForTesting` makes every WTF allocation above the
// cap fail the way a real out-of-memory does (`tryCreateUninitialized` returns
// null). It exists in debug WTF only. The cap is process-wide, so it is set
// around the one call under test and lifted again before anything else runs.
function thrownUnderAllocationCap(bytes: number, fn: () => unknown): unknown {
  expect(setMaxSingleAllocationSizeForTesting(bytes)).toBe(true);
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  } finally {
    setMaxSingleAllocationSizeForTesting(Infinity);
  }
}

// The input is 16 MiB of ASCII, so every output below is 8 MiB or more and the
// 4 MiB cap fails exactly the output string's allocation. The encodings whose
// output buffer comes from the Rust allocator (which the WTF cap does not
// reach) are covered by the ASAN block further down.
describe.skipIf(!isDebug)("a WTF string whose allocation fails is reported as a failed allocation", () => {
  const input = Buffer.alloc(16 * MiB, 97);

  test.each(["utf8", "hex", "latin1", "ascii", "ucs2"] as const)("Buffer.prototype.toString(%s)", encoding => {
    const error = thrownUnderAllocationCap(4 * MiB, () => input.toString(encoding));
    expect(error).toMatchObject(allocationFailed);
  });

  test("StringDecoder.prototype.write", () => {
    const error = thrownUnderAllocationCap(4 * MiB, () => new StringDecoder("utf8").write(input));
    expect(error).toMatchObject(allocationFailed);
  });

  test("the same conversion succeeds without the cap", () => {
    expect(input.toString("utf8").length).toBe(input.length);
    expect(input.toString("hex").length).toBe(2 * input.length);
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

  test("Buffer.prototype.toString and StringDecoder.prototype.write", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { StringDecoder } = require("node:string_decoder");
        const ascii = Buffer.alloc(${SIZE}, "a");
        const nonAscii = Buffer.alloc(${SIZE}, "a"); nonAscii[0] = 0xc3; nonAscii[1] = 0xa9;
        const results = {};
        for (const [label, fn] of Object.entries({
          "toString(utf8)": () => nonAscii.toString("utf8"),
          "toString(base64)": () => ascii.toString("base64"),
          "toString(base64url)": () => ascii.toString("base64url"),
          "StringDecoder(utf8).write": () => new StringDecoder("utf8").write(nonAscii),
          "StringDecoder(base64).write": () => new StringDecoder("base64").write(ascii),
        })) {
          try { results[label] = "unexpected success: " + fn().length; }
          catch (e) { results[label] = { name: e.name, code: e.code, message: e.message }; }
        }
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
    expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual({
      "toString(utf8)": allocationFailed,
      "toString(base64)": allocationFailed,
      "toString(base64url)": allocationFailed,
      "StringDecoder(utf8).write": allocationFailed,
      "StringDecoder(base64).write": allocationFailed,
    });
    expect(exitCode).toBe(0);
  });
});
