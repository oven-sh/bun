import { expect, test } from "bun:test";
import child_process from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import http2 from "node:http2";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
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
// Both keep the sign of -0. Node v26.3.0 prints these exact messages.
test("a received -0 keeps its sign at sites that format the number themselves", () => {
  expect({
    bufferToString: capture(() => Buffer.alloc(1).toString(-0 as any)),
    stringDecoder: capture(() => new StringDecoder(-0 as any)),
    setEncoding: capture(() => new Readable().setEncoding(-0 as any)),
    randomInt: capture(() => crypto.randomInt(-0)),
    randomIntWithMin: capture(() => crypto.randomInt(5, -0)),
    getUnpackedSettings: capture(() => http2.getUnpackedSettings(-0 as any)),
    validateHeaderName: capture(() => http.validateHeaderName(-0 as any)),
    killSignal: capture(() => child_process.spawnSync("true", [], { killSignal: -0 as any })),
    // Positive zero has no sign.
    positiveZero: capture(() => crypto.randomInt(0)),
  }).toEqual({
    bufferToString: "ERR_UNKNOWN_ENCODING | TypeError | Unknown encoding: -0",
    stringDecoder: "ERR_UNKNOWN_ENCODING | TypeError | Unknown encoding: -0",
    setEncoding: "ERR_UNKNOWN_ENCODING | TypeError | Unknown encoding: -0",
    randomInt:
      'ERR_OUT_OF_RANGE | RangeError | The value of "max" is out of range. It must be greater than the value of "min" (0). Received -0',
    randomIntWithMin:
      'ERR_OUT_OF_RANGE | RangeError | The value of "max" is out of range. It must be greater than the value of "min" (5). Received -0',
    getUnpackedSettings:
      'ERR_INVALID_ARG_TYPE | TypeError | The "buf" argument must be an instance of Buffer or TypedArray. Received type number (-0)',
    validateHeaderName: 'ERR_INVALID_HTTP_TOKEN | TypeError | Header name must be a valid HTTP token ["-0"]',
    killSignal: "ERR_UNKNOWN_SIGNAL | TypeError | Unknown signal: -0",
    positiveZero:
      'ERR_OUT_OF_RANGE | RangeError | The value of "max" is out of range. It must be greater than the value of "min" (0). Received 0',
  });
});

// The %s of util.format prints an object through String() when its toString or
// Symbol.toPrimitive is user code, and through util.inspect otherwise.
test("%s codes render an object like util.format", () => {
  class Enc {
    toString() {
      return "enc!";
    }
  }
  const toPrimitive = { [Symbol.toPrimitive]: () => "prim" };
  expect({
    userToString: capture(() => Buffer.alloc(1).toString(new Enc() as any)),
    userToPrimitive: capture(() => new StringDecoder(toPrimitive as any)),
    proxied: capture(() => http.validateHeaderName(new Proxy(new Enc(), {}) as any)),
    plainObject: capture(() => http.validateHeaderName({ a: 1 } as any)),
    nullPrototype: capture(() => http.validateHeaderName(Object.create(null))),
    builtinToString: capture(() => http.validateHeaderName(new Date(0) as any)),
  }).toEqual({
    userToString: "ERR_UNKNOWN_ENCODING | TypeError | Unknown encoding: enc!",
    userToPrimitive: "ERR_UNKNOWN_ENCODING | TypeError | Unknown encoding: prim",
    proxied: 'ERR_INVALID_HTTP_TOKEN | TypeError | Header name must be a valid HTTP token ["enc!"]',
    plainObject: 'ERR_INVALID_HTTP_TOKEN | TypeError | Header name must be a valid HTTP token ["{ a: 1 }"]',
    nullPrototype:
      'ERR_INVALID_HTTP_TOKEN | TypeError | Header name must be a valid HTTP token ["[Object: null prototype] {}"]',
    builtinToString:
      'ERR_INVALID_HTTP_TOKEN | TypeError | Header name must be a valid HTTP token ["1970-01-01T00:00:00.000Z"]',
  });
});
