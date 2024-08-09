// test functions that use DOMJIT

import { describe, test, expect } from "bun:test";

import crypto from "crypto";
import { statSync } from "fs";
import { read, ptr } from "bun:ffi";
import vm from "node:vm";

const dirStats = statSync(import.meta.dir);
const buffer = new BigInt64Array(16);

describe("DOMJIT", () => {
  const buf = new Uint8Array(4);
  for (let iter of [1000, 10000, 100000, 1000000]) {
    test("Buffer.alloc", () => {
      for (let i = 0; i < iter; i++) {
        Buffer.alloc(1);
      }
      expect(true).toBe(true);
    });
    test("Buffer.allocUnsafe", () => {
      for (let i = 0; i < iter; i++) {
        Buffer.allocUnsafe(1);
      }
      expect(true).toBe(true);
    });
    test("Buffer.allocUnsafeSlow", () => {
      for (let i = 0; i < iter; i++) {
        Buffer.allocUnsafeSlow(1);
      }
      expect(true).toBe(true);
    });
    test("Performance.now", () => {
      for (let i = 0; i < iter; i++) {
        performance.now();
      }
      expect(true).toBe(true);
    });
    test("TextEncoder.encode", () => {
      for (let i = 0; i < iter; i++) {
        new TextEncoder().encode("test");
      }
      expect(true).toBe(true);
    });
    test("TextEncoder.encodeInto", () => {
      for (let i = 0; i < iter; i++) {
        new TextEncoder().encodeInto("test", buf);
      }
      expect(true).toBe(true);
    });
    test("Crypto.timingSafeEqual", () => {
      for (let i = 0; i < iter; i++) {
        crypto.timingSafeEqual(buf, buf);
      }
      expect(true).toBe(true);
    });
    test("Crypto.randomUUID", () => {
      for (let i = 0; i < iter; i++) {
        crypto.randomUUID();
      }
      expect(true).toBe(true);
    });
    test("Crypto.getRandomValues", () => {
      for (let i = 0; i < iter; i++) {
        crypto.getRandomValues(buf);
      }
      expect(true).toBe(true);
    });
    test("TextDecoder.decode", () => {
      for (let i = 0; i < iter; i++) {
        new TextDecoder().decode(buf);
      }
      expect(true).toBe(true);
    });
    test("Stats", () => {
      for (let i = 0; i < iter; i++) {
        dirStats.isSymbolicLink();
        dirStats.isSocket();
        dirStats.isFile();
        dirStats.isFIFO();
        dirStats.isDirectory();
        dirStats.isCharacterDevice();
        dirStats.isBlockDevice();
      }
      expect(true).toBe(true);
    });
    test.todo("FFI ptr and read", () => {
      for (let i = 0; i < iter; i++) {
        read.intptr(ptr(buffer), 8);
        read.ptr(ptr(buffer), 8);
        read.f64(ptr(buffer), 8);
        read.i64(ptr(buffer), 8);
        read.u64(ptr(buffer), 8);
        read.i8(ptr(buffer), 8);
        read.i16(ptr(buffer), 8);
        read.i32(ptr(buffer), 8);
        read.u8(ptr(buffer), 8);
        read.u16(ptr(buffer), 8);
        read.u32(ptr(buffer), 8);
      }
      expect(true).toBe(true);
    });
  }

  test("does not crash running in NodeVM", () => {
    const code = `
    const buf = new Uint8Array(4);
    for (let iter of [100000]) {
      for (let i = 0; i < iter; i++) {
        performance.now();
      }
      for (let i = 0; i < iter; i++) {
        new TextEncoder().encode("test");
      }
      for (let i = 0; i < iter; i++) {
        new TextEncoder().encodeInto("test", buf);
      }
      for (let i = 0; i < iter; i++) {
        crypto.timingSafeEqual(buf, buf);
      }
      for (let i = 0; i < iter; i++) {
        crypto.randomUUID();
      }
      for (let i = 0; i < iter; i++) {
        crypto.getRandomValues(buf);
      }
      for (let i = 0; i < iter; i++) {
        new TextDecoder().decode(buf);
      }
      for (let i = 0; i < iter; i++) {
        dirStats.isSymbolicLink();
        dirStats.isSocket();
        dirStats.isFile();
        dirStats.isFIFO();
        dirStats.isDirectory();
        dirStats.isCharacterDevice();
        dirStats.isBlockDevice();
      }
    }
    "success";`;
    const script = new vm.Script(code);
    expect(script.runInNewContext({ crypto, performance, TextEncoder, TextDecoder, dirStats })).toBe("success");
    expect(vm.runInNewContext(code, { crypto, performance, TextEncoder, TextDecoder, dirStats })).toBe("success");
    expect(vm.run);
  }, 100_000);
});
