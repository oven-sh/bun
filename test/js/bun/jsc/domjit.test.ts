// exercise DOMJIT-annotated host functions (and host functions that once were)
// across JIT tiers: baseline/DFG/FTL.

import { describe, expect, test } from "bun:test";

import { ptr, read } from "bun:ffi";
import crypto from "crypto";
import { statSync } from "fs";
import vm from "node:vm";

const dirStats = statSync(import.meta.dir);
const buffer = new BigInt64Array(16);
// non-zero bytes at offset 8 so read.i8 sign-extends and each width decodes a
// distinct value (read.* must agree with DataView on LE targets)
new Uint8Array(buffer.buffer).set([0x81, 0x02, 0x03, 0x04], 8);
const dv = new DataView(buffer.buffer);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encodedTest = new Uint8Array([116, 101, 115, 116]); // "test"
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Bun forces useConcurrentJIT=true, so the FTL replacement compiles off-thread
// and is only installed AFTER a tier's callback returns: the final tier must be
// a repeat so the FTLFunctionCall compiled during the previous tier actually
// executes. 200000 clears the bytecode-scaled thresholdForFTLOptimizeAfterWarmUp
// for every callback here (FFI's ~1K-bytecode body is the worst case).
const tiers = [1000, 10000, 200000, 200000];

describe("DOMJIT", () => {
  const buf = new Uint8Array(4);
  for (const [n, iter] of tiers.entries()) {
    const tag = `#${n + 1} x${iter}`;
    test(`Buffer.alloc ${tag}`, () => {
      let last!: Buffer;
      for (let i = 0; i < iter; i++) last = Buffer.alloc(1);
      expect([last.length, last[0]]).toEqual([1, 0]);
    });
    test(`Buffer.allocUnsafe ${tag}`, () => {
      let last!: Buffer;
      for (let i = 0; i < iter; i++) last = Buffer.allocUnsafe(1);
      expect(last.length).toBe(1);
    });
    test(`Buffer.allocUnsafeSlow ${tag}`, () => {
      let last!: Buffer;
      for (let i = 0; i < iter; i++) last = Buffer.allocUnsafeSlow(1);
      expect(last.length).toBe(1);
    });
    test(`Performance.now ${tag}`, () => {
      let prev = performance.now();
      let ok = true;
      let last = prev;
      for (let i = 0; i < iter; i++) {
        last = performance.now();
        ok &&= last >= prev;
        prev = last;
      }
      expect(ok).toBe(true);
      expect(Number.isFinite(last)).toBe(true);
    });
    test(`TextEncoder.encode ${tag}`, () => {
      let last!: Uint8Array;
      for (let i = 0; i < iter; i++) last = encoder.encode("test");
      expect([...last]).toEqual([116, 101, 115, 116]);
    });
    test(`TextEncoder.encodeInto ${tag}`, () => {
      let last!: TextEncoderEncodeIntoResult;
      for (let i = 0; i < iter; i++) last = encoder.encodeInto("test", buf);
      expect(last).toEqual({ read: 4, written: 4 });
      expect([...buf]).toEqual([116, 101, 115, 116]);
    });
    test(`Crypto.timingSafeEqual ${tag}`, () => {
      const a = new Uint8Array([1, 2, 3, 4]);
      const b = new Uint8Array([1, 2, 3, 4]);
      let last = false;
      for (let i = 0; i < iter; i++) last = crypto.timingSafeEqual(a, b);
      expect(last).toBe(true);
    });
    test(`Crypto.randomUUID ${tag}`, () => {
      let last = "";
      for (let i = 0; i < iter; i++) last = crypto.randomUUID();
      expect(last).toMatch(uuid);
    });
    test(`Crypto.getRandomValues ${tag}`, () => {
      let last!: Uint8Array;
      for (let i = 0; i < iter; i++) last = crypto.getRandomValues(buf);
      expect(last).toBe(buf);
    });
    test(`TextDecoder.decode ${tag}`, () => {
      let last = "";
      for (let i = 0; i < iter; i++) last = decoder.decode(encodedTest);
      expect(last).toBe("test");
    });
    test(`Stats ${tag}`, () => {
      let isSymbolicLink!: boolean,
        isSocket!: boolean,
        isFile!: boolean,
        isFIFO!: boolean,
        isDirectory!: boolean,
        isCharacterDevice!: boolean,
        isBlockDevice!: boolean;
      for (let i = 0; i < iter; i++) {
        isSymbolicLink = dirStats.isSymbolicLink();
        isSocket = dirStats.isSocket();
        isFile = dirStats.isFile();
        isFIFO = dirStats.isFIFO();
        isDirectory = dirStats.isDirectory();
        isCharacterDevice = dirStats.isCharacterDevice();
        isBlockDevice = dirStats.isBlockDevice();
      }
      expect({ isSymbolicLink, isSocket, isFile, isFIFO, isDirectory, isCharacterDevice, isBlockDevice }).toEqual({
        isSymbolicLink: false,
        isSocket: false,
        isFile: false,
        isFIFO: false,
        isDirectory: true,
        isCharacterDevice: false,
        isBlockDevice: false,
      });
    });
    test(`FFI ptr and read ${tag}`, () => {
      let intptr!: number,
        rptr!: number,
        f64!: number,
        i64!: bigint,
        u64!: bigint,
        i8!: number,
        i16!: number,
        i32!: number,
        u8!: number,
        u16!: number,
        u32!: number;
      for (let i = 0; i < iter; i++) {
        intptr = read.intptr(ptr(buffer), 8);
        rptr = read.ptr(ptr(buffer), 8);
        f64 = read.f64(ptr(buffer), 8);
        i64 = read.i64(ptr(buffer), 8);
        u64 = read.u64(ptr(buffer), 8);
        i8 = read.i8(ptr(buffer), 8);
        i16 = read.i16(ptr(buffer), 8);
        i32 = read.i32(ptr(buffer), 8);
        u8 = read.u8(ptr(buffer), 8);
        u16 = read.u16(ptr(buffer), 8);
        u32 = read.u32(ptr(buffer), 8);
      }
      expect(Number.isFinite(ptr(buffer))).toBe(true);
      expect({ intptr, rptr, f64, i64, u64, i8, i16, i32, u8, u16, u32 }).toEqual({
        intptr: Number(dv.getBigInt64(8, true)),
        rptr: Number(dv.getBigUint64(8, true)),
        f64: dv.getFloat64(8, true),
        i64: dv.getBigInt64(8, true),
        u64: dv.getBigUint64(8, true),
        i8: dv.getInt8(8),
        i16: dv.getInt16(8, true),
        i32: dv.getInt32(8, true),
        u8: dv.getUint8(8),
        u16: dv.getUint16(8, true),
        u32: dv.getUint32(8, true),
      });
      expect(i8).toBe(-127);
    });
  }

  describe("in NodeVM", () => {
    // "a".repeat is very slow in debug JSC; repros for #13320 used a >1024-byte string.
    const longStr = Buffer.alloc(1030, "a").toString();
    // One pass at 100000 covers FTL; the old 1000000-iter encoder.encode loop was the
    // single slowest thing in this file under ASAN and added no extra tier coverage.
    const code = `
    const buf = new Uint8Array(4);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const iter = 100000;
    for (let i = 0; i < iter; i++) performance.now();
    for (let i = 0; i < iter; i++) encoder.encode("test");
    for (let i = 0; i < iter; i++) encoder.encode(longStr);
    for (let i = 0; i < iter; i++) encoder.encodeInto("test", buf);
    for (let i = 0; i < iter; i++) crypto.timingSafeEqual(buf, buf);
    for (let i = 0; i < iter; i++) crypto.randomUUID();
    for (let i = 0; i < iter; i++) crypto.getRandomValues(buf);
    for (let i = 0; i < iter; i++) decoder.decode(buf);
    for (let i = 0; i < iter; i++) {
      dirStats.isSymbolicLink();
      dirStats.isSocket();
      dirStats.isFile();
      dirStats.isFIFO();
      dirStats.isDirectory();
      dirStats.isCharacterDevice();
      dirStats.isBlockDevice();
    }
    "success";`;
    const sandbox = { crypto, performance, TextEncoder, TextDecoder, dirStats, longStr };
    test("Script.runInNewContext", () => {
      const script = new vm.Script(code);
      expect(script.runInNewContext({ ...sandbox })).toBe("success");
    }, 20_000);
    test("vm.runInNewContext", () => {
      expect(vm.runInNewContext(code, { ...sandbox })).toBe("success");
    }, 20_000);
  });
});
