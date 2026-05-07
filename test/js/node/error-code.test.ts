// Exercises the generated `ErrorCode.Error.fmt` / `Error.throw` helpers from
// `src/codegen/generate-node-errors.ts` → `build/<profile>/codegen/ErrorCode.zig`.
//
// Both code paths are covered:
//   - zero-arg messages (outlined to `fmtStatic` / `throwStatic`)
//   - formatted messages (outlined to `createFormat` + `toJS` / `throwFromString`)
//
// For each case we assert the full (code, name, constructor, message) tuple so
// that any regression in how these errors are constructed — wrong prototype,
// wrong .code, truncated/garbled message — fails loudly.

import { expect, test } from "bun:test";
import crypto from "node:crypto";
import dns from "node:dns";
import zlib from "node:zlib";

function errorOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    const err = e as Error & { code?: string };
    return {
      code: err.code,
      name: err.name,
      ctor: err.constructor.name,
      message: err.message,
    };
  }
  expect.unreachable();
}

// --- zero-arg messages: Error.{fmt,throw}(code, global, "literal", .{}) ----

test("ErrorCode zero-arg: crypto.timingSafeEqual length mismatch", () => {
  expect(errorOf(() => crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(2)))).toEqual({
    code: "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH",
    name: "RangeError",
    ctor: "RangeError",
    message: "Input buffers must have the same byte length",
  });
});

test("ErrorCode zero-arg: crypto.timingSafeEqual wrong argument type", () => {
  expect(errorOf(() => crypto.timingSafeEqual("x" as any, Buffer.alloc(1)))).toEqual({
    code: "ERR_INVALID_ARG_TYPE",
    name: "TypeError",
    ctor: "TypeError",
    message: 'The "buf1" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.',
  });
});

test("ErrorCode zero-arg: crypto.setEngine is unsupported", () => {
  expect(errorOf(() => crypto.setEngine("x"))).toEqual({
    code: "ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED",
    name: "Error",
    ctor: "Error",
    message: "Custom engines not supported by BoringSSL",
  });
});

test("ErrorCode zero-arg: Bun.randomUUIDv5 missing name", () => {
  expect(errorOf(() => (Bun as any).randomUUIDv5())).toEqual({
    code: "ERR_INVALID_ARG_TYPE",
    name: "TypeError",
    ctor: "TypeError",
    message: 'The "name" argument must be specified',
  });
});

test("ErrorCode zero-arg: Bun.randomUUIDv5 invalid namespace", () => {
  expect(errorOf(() => (Bun as any).randomUUIDv5("a", "not-a-uuid"))).toEqual({
    code: "ERR_INVALID_ARG_VALUE",
    name: "TypeError",
    ctor: "TypeError",
    message: "Invalid UUID format for namespace",
  });
});

// --- formatted messages: Error.{fmt,throw}(code, global, "…{…}…", .{…}) ----

test("ErrorCode formatted: crypto.pbkdf2Sync invalid digest", () => {
  expect(errorOf(() => crypto.pbkdf2Sync("p", "s", 1, 16, "notadigest"))).toEqual({
    code: "ERR_CRYPTO_INVALID_DIGEST",
    name: "TypeError",
    ctor: "TypeError",
    message: "Invalid digest: notadigest",
  });
});

test("ErrorCode formatted: crypto.randomInt max <= min", () => {
  expect(errorOf(() => crypto.randomInt(5, 2))).toEqual({
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    ctor: "RangeError",
    message: 'The value of "max" is out of range. It must be greater than the value of "min" (5). Received 2',
  });
});

test("ErrorCode formatted: zlib.crc32 out-of-range seed", () => {
  expect(errorOf(() => zlib.crc32("abc", -1))).toEqual({
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    ctor: "RangeError",
    message: 'The value of "value" is out of range. It must be >= 0 and <= 4294967295. Received -1',
  });
});

test("ErrorCode formatted: zlib.crc32 wrong data type", () => {
  expect(errorOf(() => zlib.crc32(123 as any))).toEqual({
    code: "ERR_INVALID_ARG_TYPE",
    name: "TypeError",
    ctor: "TypeError",
    message: 'The "data" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received number',
  });
});

test("ErrorCode formatted: dns.Resolver#setLocalAddress invalid IP", () => {
  expect(errorOf(() => new dns.Resolver().setLocalAddress("notanip"))).toEqual({
    code: "ERR_INVALID_IP_ADDRESS",
    name: "TypeError",
    ctor: "TypeError",
    message: 'Invalid IP address: "notanip"',
  });
});
