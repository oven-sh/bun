import { expect, test } from "bun:test";
import child_process from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import http from "node:http";
import { createHistogram } from "node:perf_hooks";
import { Readable, Writable } from "node:stream";
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

// Node renders the value in these messages with util.inspect, or with the %s of util.format.
// Both print negative zero with its sign. Node v26.3.0 prints these exact messages.
test("a value of -0 keeps its sign in an error message", () => {
  expect({
    // ERR_OUT_OF_RANGE thrown from C++, with numeric bounds and with a range string.
    readUIntBE: capture(() => Buffer.alloc(8).readUIntBE(0, -0)),
    percentile: capture(() => createHistogram().percentile(-0)),
    // ERR_OUT_OF_RANGE thrown from JS ($ERR_OUT_OF_RANGE).
    figures: capture(() => createHistogram({ figures: -0 })),
    // ERR_INVALID_ARG_VALUE.
    paramEncoding: capture(() => generateKeyPairSync("ec", { namedCurve: "P-256", paramEncoding: -0 as any })),
    // %s codes.
    setDefaultEncoding: capture(() => new Writable().setDefaultEncoding(-0 as any)),
    readableStreamFrom: capture(() => ReadableStream.from(-0 as any)),
    // Positive zero has no sign.
    positiveZero: capture(() => Buffer.alloc(8).readUIntBE(0, 0)),
  }).toEqual({
    readUIntBE:
      'ERR_OUT_OF_RANGE | RangeError | The value of "byteLength" is out of range. It must be >= 1 and <= 6. Received -0',
    percentile:
      'ERR_OUT_OF_RANGE | RangeError | The value of "percentile" is out of range. It must be > 0 && <= 100. Received -0',
    figures:
      'ERR_OUT_OF_RANGE | RangeError | The value of "options.figures" is out of range. It must be >= 1 && <= 5. Received -0',
    paramEncoding: "ERR_INVALID_ARG_VALUE | TypeError | The property 'options.paramEncoding' is invalid. Received -0",
    setDefaultEncoding: "ERR_UNKNOWN_ENCODING | TypeError | Unknown encoding: -0",
    readableStreamFrom: "ERR_ARG_NOT_ITERABLE | TypeError | -0 must be iterable",
    positiveZero:
      'ERR_OUT_OF_RANGE | RangeError | The value of "byteLength" is out of range. It must be >= 1 and <= 6. Received 0',
  });
});
