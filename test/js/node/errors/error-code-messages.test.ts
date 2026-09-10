import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import child_process from "node:child_process";
import http from "node:http";
import { Readable } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";

// Codes whose messages come from the fixed-template table behind $ERR_*.
function capture(fn: () => unknown): string {
  try {
    fn();
  } catch (e: any) {
    return `${e.code} | ${e.name} | ${e.message}`;
  }
  return "no throw";
}

test("table-driven ERR_* codes keep their exact messages", () => {
  expect(capture(() => zlib.createBrotliCompress({ params: { 99999: 1 } }))).toBe(
    "ERR_BROTLI_INVALID_PARAM | RangeError | 99999 is not a valid Brotli parameter",
  );
  expect(capture(() => zlib.zstdCompressSync("x", { params: { 99999: 1 } }))).toBe(
    "ERR_ZSTD_INVALID_PARAM | RangeError | 99999 is not a valid zstd parameter",
  );
  expect(capture(() => http.validateHeaderName("bad header"))).toBe(
    'ERR_INVALID_HTTP_TOKEN | TypeError | Header name must be a valid HTTP token ["bad header"]',
  );
  expect(capture(() => tls.createSecureContext({ minVersion: "TLSv9" as any }))).toBe(
    "ERR_TLS_INVALID_PROTOCOL_VERSION | TypeError | TLSv9 is not a valid minimum TLS protocol version",
  );
  expect(capture(() => child_process.fork("x", { stdio: ["pipe", "pipe", "pipe"] }))).toBe(
    "ERR_CHILD_PROCESS_IPC_REQUIRED | Error | Forked processes must have an IPC channel, missing value 'ipc' in options.stdio",
  );
  expect(capture(() => Readable.prototype._read.call(new Readable()))).toBe(
    "ERR_METHOD_NOT_IMPLEMENTED | Error | The _read() method is not implemented",
  );
});

test("ERR_INVALID_ARG_VALUE quotes and escapes the received value", () => {
  expect(capture(() => Buffer.alloc(4).fill("a'b\x01\n\\\u0085zz", "hex"))).toBe(
    'ERR_INVALID_ARG_VALUE | TypeError | The argument \'value\' is invalid. Received "a\'b\\x01\\n\\\\\\x85zz"',
  );
  expect(capture(() => Buffer.alloc(4).fill("plain\x7f\u009f", "hex"))).toBe(
    "ERR_INVALID_ARG_VALUE | TypeError | The argument 'value' is invalid. Received 'plain\\x7f\\x9f'",
  );
});

test(
  "a received value too large to render throws instead of killing the process",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        // Each "\x01" renders as the 4 characters "\x01", so 2**29 of them
        // escape to exactly 2**31: one past the longest string that can exist.
        // `repeat` is faster here than `Buffer.alloc(n, 1).toString("latin1")`
        // and it keeps one copy of the value instead of two.
        `const value = "\\x01".repeat(2 ** 29);
         try {
           Buffer.alloc(4).fill(value, "hex");
           console.log("no throw");
         } catch (e) {
           console.log(e.name + ": " + e.message);
         }`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("RangeError: Out of memory");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  // The value is 512 MB, and the renderer measures it before it gives up.
  // That takes a few seconds in a debug build.
  60_000,
);
