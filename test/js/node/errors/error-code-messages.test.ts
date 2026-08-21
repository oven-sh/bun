import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import child_process from "node:child_process";
import crypto from "node:crypto";
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

// ERR_INVALID_ARG_TYPE messages that the native side formats through one shared body
// (JSGlobalObject::throw_invalid_argument_type_value* and throw_invalid_property_type).
// The callers below pass argument names and type names of different lengths, and the
// three `must be ...` variants differ only in the words inserted before the type name.
test("native ERR_INVALID_ARG_TYPE variants keep their exact messages", async () => {
  // "must be of type <type>"
  expect(capture(() => crypto.pbkdf2Sync("pw", "salt", "x" as any, 16, "sha256"))).toBe(
    `ERR_INVALID_ARG_TYPE | TypeError | The "iterations" argument must be of type number. Received type string ('x')`,
  );
  expect(capture(() => crypto.pbkdf2Sync("pw", "salt", 1, 16, 42 as any))).toBe(
    `ERR_INVALID_ARG_TYPE | TypeError | The "digest" argument must be of type string. Received type number (42)`,
  );
  expect(capture(() => crypto.randomInt(0, 10, "x" as any))).toBe(
    `ERR_INVALID_ARG_TYPE | TypeError | The "callback" argument must be of type function. Received type string ('x')`,
  );

  // "must be <description>"
  expect(capture(() => crypto.randomInt(1.5, 10))).toBe(
    `ERR_INVALID_ARG_TYPE | TypeError | The "min" argument must be a safe integer. Received type number (1.5)`,
  );
  expect(capture(() => crypto.randomInt(0, 2 ** 53))).toBe(
    `ERR_INVALID_ARG_TYPE | TypeError | The "max" argument must be a safe integer. Received type number (9007199254740992)`,
  );

  // "must be one of type <types>"
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", "setTimeout(() => {}, 60_000)"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
    ipc() {},
  });
  expect(capture(() => child.send(Symbol()))).toBe(
    `ERR_INVALID_ARG_TYPE | TypeError | The "message" argument must be one of type string, object, number, or boolean. Received type symbol (Symbol())`,
  );

  // Optional string properties read through JSValue::get_optional_slice.
  expect(capture(() => Bun.CSRF.generate("secret", { sessionId: 1 as any }))).toBe(
    `ERR_INVALID_ARG_TYPE | TypeError | The "sessionId" property must be of type string, got number`,
  );
  expect(capture(() => Bun.CSRF.verify("token", { secret: ["x"] as any }))).toBe(
    `ERR_INVALID_ARG_TYPE | TypeError | The "secret" property must be of type string, got array`,
  );
  expect(capture(() => Bun.CSRF.generate("secret", { sessionId: "abc" }))).toBe("no throw");
});
