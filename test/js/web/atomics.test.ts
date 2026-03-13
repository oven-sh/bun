import { describe, expect, test } from "bun:test";

describe("Atomics", () => {
  describe("basic operations", () => {
    test("store and load", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      expect(Atomics.store(view, 0, 42)).toBe(42);
      expect(Atomics.load(view, 0)).toBe(42);

      expect(Atomics.store(view, 1, -123)).toBe(-123);
      expect(Atomics.load(view, 1)).toBe(-123);
    });

    test("add", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 10);
      expect(Atomics.add(view, 0, 5)).toBe(10); // returns old value
      expect(Atomics.load(view, 0)).toBe(15); // new value

      expect(Atomics.add(view, 0, -3)).toBe(15);
      expect(Atomics.load(view, 0)).toBe(12);
    });

    test("sub", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 20);
      expect(Atomics.sub(view, 0, 5)).toBe(20); // returns old value
      expect(Atomics.load(view, 0)).toBe(15); // new value

      expect(Atomics.sub(view, 0, -3)).toBe(15);
      expect(Atomics.load(view, 0)).toBe(18);
    });

    test("exchange", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 100);
      expect(Atomics.exchange(view, 0, 200)).toBe(100);
      expect(Atomics.load(view, 0)).toBe(200);
    });

    test("compareExchange", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 100);

      // Successful exchange
      expect(Atomics.compareExchange(view, 0, 100, 200)).toBe(100);
      expect(Atomics.load(view, 0)).toBe(200);

      // Failed exchange (expected value doesn't match)
      expect(Atomics.compareExchange(view, 0, 100, 300)).toBe(200);
      expect(Atomics.load(view, 0)).toBe(200); // unchanged
    });
  });

  describe("bitwise operations", () => {
    test("and", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 0b1111);
      expect(Atomics.and(view, 0, 0b1010)).toBe(0b1111); // returns old value
      expect(Atomics.load(view, 0)).toBe(0b1010); // new value
    });

    test("or", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 0b1010);
      expect(Atomics.or(view, 0, 0b0101)).toBe(0b1010); // returns old value
      expect(Atomics.load(view, 0)).toBe(0b1111); // new value
    });

    test("xor", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 0b1010);
      expect(Atomics.xor(view, 0, 0b1100)).toBe(0b1010); // returns old value
      expect(Atomics.load(view, 0)).toBe(0b0110); // new value (1010 ^ 1100 = 0110)
    });
  });

  describe("utility functions", () => {
    test("isLockFree", () => {
      expect(typeof Atomics.isLockFree(1)).toBe("boolean");
      expect(typeof Atomics.isLockFree(2)).toBe("boolean");
      expect(typeof Atomics.isLockFree(4)).toBe("boolean");
      expect(typeof Atomics.isLockFree(8)).toBe("boolean");

      // Most platforms support 4-byte atomic operations
      expect(Atomics.isLockFree(4)).toBe(true);
    });

    test("pause", () => {
      // pause() should not throw
      expect(() => Atomics.pause()).not.toThrow();
    });
  });

  describe("synchronization", () => {
    test("wait with timeout", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 0);

      // Should timeout since no one will notify
      const result = Atomics.wait(view, 0, 0, 10); // 10ms timeout
      expect(result).toBe("timed-out");
    });

    test("wait with non-matching value", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 42);

      // Should return immediately since value doesn't match
      const result = Atomics.wait(view, 0, 0, 1000);
      expect(result).toBe("not-equal");
    });

    test("notify", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 0);

      // notify returns number of agents that were woken up
      // Since no one is waiting, should return 0
      const notified = Atomics.notify(view, 0, 1);
      expect(notified).toBe(0);
    });

    test("waitAsync with timeout", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      Atomics.store(view, 0, 0);

      const result = Atomics.waitAsync(view, 0, 0, 10);
      expect(typeof result).toBe("object");
      expect(typeof result.async).toBe("boolean");

      if (result.async) {
        expect(result.value).toBeInstanceOf(Promise);
      } else {
        expect(typeof result.value).toBe("string");
      }
    });
  });

  describe("different TypedArray types", () => {
    test("Int8Array", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int8Array(buffer);

      expect(Atomics.store(view, 0, 42)).toBe(42);
      expect(Atomics.load(view, 0)).toBe(42);
      expect(Atomics.add(view, 0, 8)).toBe(42);
      expect(Atomics.load(view, 0)).toBe(50);
    });

    test("Int16Array", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int16Array(buffer);

      expect(Atomics.store(view, 0, 1000)).toBe(1000);
      expect(Atomics.load(view, 0)).toBe(1000);
      expect(Atomics.sub(view, 0, 200)).toBe(1000);
      expect(Atomics.load(view, 0)).toBe(800);
    });

    test("Int32Array", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      expect(Atomics.store(view, 0, 100000)).toBe(100000);
      expect(Atomics.load(view, 0)).toBe(100000);
      expect(Atomics.exchange(view, 0, 200000)).toBe(100000);
      expect(Atomics.load(view, 0)).toBe(200000);
    });

    test("Uint8Array", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Uint8Array(buffer);

      expect(Atomics.store(view, 0, 255)).toBe(255);
      expect(Atomics.load(view, 0)).toBe(255);
      expect(Atomics.and(view, 0, 0x0f)).toBe(255);
      expect(Atomics.load(view, 0)).toBe(0x0f);
    });

    test("Uint16Array", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Uint16Array(buffer);

      expect(Atomics.store(view, 0, 65535)).toBe(65535);
      expect(Atomics.load(view, 0)).toBe(65535);
      expect(Atomics.or(view, 0, 0xff00)).toBe(65535);
      expect(Atomics.load(view, 0)).toBe(65535);
    });

    test("Uint32Array", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Uint32Array(buffer);

      expect(Atomics.store(view, 0, 0xffffffff)).toBe(0xffffffff);
      expect(Atomics.load(view, 0)).toBe(0xffffffff);
      expect(Atomics.xor(view, 0, 0x12345678)).toBe(0xffffffff);
      // Use >>> 0 to convert to unsigned 32-bit for comparison
      expect(Atomics.load(view, 0)).toBe((0xffffffff ^ 0x12345678) >>> 0);
    });

    test("BigInt64Array", () => {
      const buffer = new SharedArrayBuffer(32);
      const view = new BigInt64Array(buffer);

      expect(Atomics.store(view, 0, 42n)).toBe(42n);
      expect(Atomics.load(view, 0)).toBe(42n);
      expect(Atomics.add(view, 0, 8n)).toBe(42n);
      expect(Atomics.load(view, 0)).toBe(50n);
    });

    test("BigUint64Array", () => {
      const buffer = new SharedArrayBuffer(32);
      const view = new BigUint64Array(buffer);

      expect(Atomics.store(view, 0, 123n)).toBe(123n);
      expect(Atomics.load(view, 0)).toBe(123n);
      expect(Atomics.compareExchange(view, 0, 123n, 456n)).toBe(123n);
      expect(Atomics.load(view, 0)).toBe(456n);
    });
  });

  describe("error cases", () => {
    test("works on regular ArrayBuffer in Bun", () => {
      // Note: Bun allows Atomics on regular ArrayBuffer, unlike some other engines
      const buffer = new ArrayBuffer(16);
      const view = new Int32Array(buffer);

      expect(() => Atomics.store(view, 0, 42)).not.toThrow();
      expect(() => Atomics.load(view, 0)).not.toThrow();
      expect(Atomics.load(view, 0)).toBe(42);
    });

    test("throws on non-integer TypedArray", () => {
      const buffer = new SharedArrayBuffer(16);
      const floatView = new Float32Array(buffer);

      expect(() => Atomics.store(floatView, 0, 1.5)).toThrow();
      expect(() => Atomics.load(floatView, 0)).toThrow();
    });

    test("throws on out of bounds access", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer); // 4 elements (16 bytes / 4 bytes each)

      expect(() => Atomics.store(view, 10, 42)).toThrow();
      expect(() => Atomics.load(view, -1)).toThrow();
    });
  });

  describe("edge cases", () => {
    test("operations at array boundaries", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer); // indices 0, 1, 2, 3

      // Test first element
      expect(Atomics.store(view, 0, 100)).toBe(100);
      expect(Atomics.load(view, 0)).toBe(100);

      // Test last element
      expect(Atomics.store(view, 3, 200)).toBe(200);
      expect(Atomics.load(view, 3)).toBe(200);
    });

    test("zero values", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      expect(Atomics.store(view, 0, 0)).toBe(0);
      expect(Atomics.load(view, 0)).toBe(0);
      expect(Atomics.add(view, 0, 0)).toBe(0);
      expect(Atomics.load(view, 0)).toBe(0);
    });

    test("negative values", () => {
      const buffer = new SharedArrayBuffer(16);
      const view = new Int32Array(buffer);

      expect(Atomics.store(view, 0, -42)).toBe(-42);
      expect(Atomics.load(view, 0)).toBe(-42);
      expect(Atomics.add(view, 0, -8)).toBe(-42);
      expect(Atomics.load(view, 0)).toBe(-50);
    });
  });
});
