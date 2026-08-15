/**
 * `simdutf::base64::encode` (src/simdutf_sys/simdutf.rs) hands C++ the
 * destination slice as a bare pointer and simdutf writes the whole encoding
 * without ever seeing the slice length, so the length check in that wrapper is
 * all that keeps a too-short destination passed to `bun_base64::encode` or
 * `encode_url_safe` from becoming a heap overflow. Every in-tree caller sizes
 * its destination correctly, so no JS API reaches that check; `base64EncodeProbe`
 * (src/runtime/base64_testing.rs) calls the encoders with a destination length
 * of the test's choosing. It runs against the built binary, which is what makes
 * the short-destination cases meaningful on release builds: a `debug_assert!`
 * there would compile out and the encoder would write past the destination
 * instead of panicking.
 *
 * The probe encodes the bytes 0..inputLength; `Buffer` gives the expected text
 * and, through its length, the exact number of bytes the encoder writes.
 */
import { base64EncodeProbe } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function encoding(inputLength: number, urlSafe: boolean): string {
  const bytes = Uint8Array.from({ length: inputLength }, (_, i) => i);
  return Buffer.from(bytes).toString(urlSafe ? "base64url" : "base64");
}

// Covers the empty input and every inputLength % 3 phase several times, for
// both alphabets: padded output is always a multiple of 4, URL-safe output is not.
const inputLengths = Array.from({ length: 10 }, (_, i) => i);

// The last column is the encoded length of a single input byte: 4 padded,
// 2 URL-safe. The short-destination test is one byte under it, and the panic
// message carries both numbers, so a check that computed the other alphabet's
// length fails that test too.
describe.each([
  ["base64", false, 4],
  ["base64url", true, 2],
])("%s", (_alphabet, urlSafe, encodedLength) => {
  test("a destination of exactly the encoded length holds the encoding", () => {
    const expected = inputLengths.map(n => encoding(n, urlSafe));
    expect(inputLengths.map((n, i) => base64EncodeProbe(n, expected[i].length, urlSafe))).toEqual(expected);
  });

  test("a larger destination returns only the bytes written", () => {
    const expected = inputLengths.map(n => encoding(n, urlSafe));
    expect(inputLengths.map((n, i) => base64EncodeProbe(n, expected[i].length + 3, urlSafe))).toEqual(expected);
  });

  test.concurrent("a destination one byte too short panics instead of being written past", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(JSON.stringify(require("bun:internal-for-testing").base64EncodeProbe(1, ${encodedLength - 1}, ${urlSafe})));`,
        // Without this, debug builds symbolize the panic trace with
        // llvm-symbolizer, which takes seconds (as in run-crash-handler.test.ts).
        "--debug-crash-handler-use-trace-string",
      ],
      // The panic is the expected outcome; it must not be reported as a crash.
      env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const message = `base64 encode: output buffer too small: need ${encodedLength} bytes for a 1-byte input, got ${encodedLength - 1}`;
    expect({
      stdout,
      stderr: stderr.includes(message) ? message : stderr,
      exitCode: exitCode === 0 ? 0 : "non-zero",
    }).toEqual({ stdout: "", stderr: message, exitCode: "non-zero" });
  });
});
