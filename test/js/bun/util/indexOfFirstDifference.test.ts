import { describe, expect, test } from "bun:test";

describe("Bun.indexOfFirstDifference", () => {
  test("identical arrays return length", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(5);
  });

  test("difference at start returns 0", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([9, 2, 3]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(0);
  });

  test("difference at end returns length - 1", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 9]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
  });

  test("difference in middle returns correct index", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 99, 4, 5]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
  });

  test("empty arrays return 0", () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(0);
  });

  describe("multiple TypedArray types", () => {
    test("Uint8Array", () => {
      const a = new Uint8Array([10, 20, 30]);
      const b = new Uint8Array([10, 20, 99]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });

    test("Uint8ClampedArray", () => {
      const a = new Uint8ClampedArray([10, 20, 30]);
      const b = new Uint8ClampedArray([10, 20, 99]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });

    test("Int8Array", () => {
      const a = new Int8Array([10, -20, 30]);
      const b = new Int8Array([10, -20, 99]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });

    test("Uint16Array", () => {
      const a = new Uint16Array([1000, 2000, 3000]);
      const b = new Uint16Array([1000, 2000, 9999]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });

    test("Int16Array", () => {
      const a = new Int16Array([1000, -2000, 3000]);
      const b = new Int16Array([1000, -2000, 9999]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });

    test("Int32Array", () => {
      const a = new Int32Array([100000, 200000, 300000]);
      const b = new Int32Array([100000, 200000, 999999]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });

    test("Uint32Array", () => {
      const a = new Uint32Array([100000, 200000, 300000]);
      const b = new Uint32Array([100000, 200000, 999999]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });

    test("BigInt64Array", () => {
      const a = new BigInt64Array([1n, 2n, 3n]);
      const b = new BigInt64Array([1n, 2n, 99n]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });

    test("BigUint64Array", () => {
      const a = new BigUint64Array([1n, 2n, 3n]);
      const b = new BigUint64Array([1n, 2n, 99n]);
      expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
    });
  });

  describe("float arrays throw TypeError", () => {
    test("Float32Array", () => {
      const a = new Float32Array([1.0, 2.0]);
      const b = new Float32Array([1.0, 2.0]);
      expect(() => Bun.indexOfFirstDifference(a, b)).toThrow(TypeError);
    });

    test("Float64Array", () => {
      const a = new Float64Array([1.0, 2.0]);
      const b = new Float64Array([1.0, 2.0]);
      expect(() => Bun.indexOfFirstDifference(a, b)).toThrow(TypeError);
    });
  });

  test("mismatched types throw TypeError", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint16Array([1, 2, 3]);
    expect(() => Bun.indexOfFirstDifference(a as any, b as any)).toThrow(TypeError);
  });

  test("different lengths compares up to min length - identical prefix", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(3);
  });

  test("different lengths compares up to min length - difference found", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 99, 3]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(1);
  });

  test("large arrays (10000 elements) correctness", () => {
    const size = 10000;
    const a = new Uint8Array(size);
    const b = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      a[i] = i & 0xff;
      b[i] = i & 0xff;
    }
    // Identical
    expect(Bun.indexOfFirstDifference(a, b)).toBe(size);

    // Difference near end
    b[size - 1] = (b[size - 1]! + 1) & 0xff;
    expect(Bun.indexOfFirstDifference(a, b)).toBe(size - 1);

    // Restore and differ at start
    b[size - 1] = a[size - 1]!;
    b[0] = (b[0]! + 1) & 0xff;
    expect(Bun.indexOfFirstDifference(a, b)).toBe(0);
  });

  test("large Int32Array correctness", () => {
    const size = 5000;
    const a = new Int32Array(size);
    const b = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      a[i] = i * 7;
      b[i] = i * 7;
    }
    expect(Bun.indexOfFirstDifference(a, b)).toBe(size);

    b[4999] = -1;
    expect(Bun.indexOfFirstDifference(a, b)).toBe(4999);
  });

  // Exhaustive SIMD boundary tests: test every length from 0..256
  // and every diff position to catch SIMD lane/tail edge cases
  describe("exhaustive SIMD boundary tests", () => {
    test("Uint8Array: every length 0..256, identical", () => {
      for (let len = 0; len <= 256; len++) {
        const a = new Uint8Array(len);
        const b = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          a[i] = (i + 1) & 0xff;
          b[i] = (i + 1) & 0xff;
        }
        expect(Bun.indexOfFirstDifference(a, b)).toBe(len);
      }
    });

    test("Uint8Array: every length 0..256, diff at every position", () => {
      for (let len = 1; len <= 256; len++) {
        for (let diffAt = 0; diffAt < len; diffAt++) {
          const a = new Uint8Array(len);
          const b = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            a[i] = (i + 1) & 0xff;
            b[i] = (i + 1) & 0xff;
          }
          b[diffAt] = (b[diffAt]! ^ 0x80) & 0xff;
          expect(Bun.indexOfFirstDifference(a, b)).toBe(diffAt);
        }
      }
    });

    test("Uint16Array: every length 0..256, identical", () => {
      for (let len = 0; len <= 256; len++) {
        const a = new Uint16Array(len);
        const b = new Uint16Array(len);
        for (let i = 0; i < len; i++) {
          a[i] = (i + 1) * 257;
          b[i] = (i + 1) * 257;
        }
        expect(Bun.indexOfFirstDifference(a, b)).toBe(len);
      }
    });

    test("Uint16Array: every length 1..128, diff at every position", () => {
      for (let len = 1; len <= 128; len++) {
        for (let diffAt = 0; diffAt < len; diffAt++) {
          const a = new Uint16Array(len);
          const b = new Uint16Array(len);
          for (let i = 0; i < len; i++) {
            a[i] = (i + 1) * 257;
            b[i] = (i + 1) * 257;
          }
          b[diffAt] = b[diffAt]! ^ 0x8000;
          expect(Bun.indexOfFirstDifference(a, b)).toBe(diffAt);
        }
      }
    });

    test("Int32Array: every length 0..256, identical", () => {
      for (let len = 0; len <= 256; len++) {
        const a = new Int32Array(len);
        const b = new Int32Array(len);
        for (let i = 0; i < len; i++) {
          a[i] = (i + 1) * 100003;
          b[i] = (i + 1) * 100003;
        }
        expect(Bun.indexOfFirstDifference(a, b)).toBe(len);
      }
    });

    test("Int32Array: every length 1..128, diff at every position", () => {
      for (let len = 1; len <= 128; len++) {
        for (let diffAt = 0; diffAt < len; diffAt++) {
          const a = new Int32Array(len);
          const b = new Int32Array(len);
          for (let i = 0; i < len; i++) {
            a[i] = (i + 1) * 100003;
            b[i] = (i + 1) * 100003;
          }
          b[diffAt] = ~b[diffAt]!;
          expect(Bun.indexOfFirstDifference(a, b)).toBe(diffAt);
        }
      }
    });
  });

  test("subarray views work correctly", () => {
    const buf = new Uint8Array([0, 0, 1, 2, 3, 4, 5, 0, 0]);
    const a = buf.subarray(2, 7); // [1, 2, 3, 4, 5]
    const b = new Uint8Array([1, 2, 99, 4, 5]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
  });

  test("subarray views identical", () => {
    const buf = new Uint8Array([0, 0, 1, 2, 3, 0, 0]);
    const a = buf.subarray(2, 5); // [1, 2, 3]
    const b = new Uint8Array([1, 2, 3]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(3);
  });

  test("detached buffers throw TypeError", () => {
    const buf = new ArrayBuffer(8);
    const a = new Uint8Array(buf);
    const b = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    // Detach the buffer by transferring it
    const transferred = buf.transfer();
    void transferred;

    expect(() => Bun.indexOfFirstDifference(a, b)).toThrow(TypeError);
  });

  test("too few arguments throws TypeError", () => {
    expect(() => (Bun.indexOfFirstDifference as any)()).toThrow(TypeError);
    expect(() => (Bun.indexOfFirstDifference as any)(new Uint8Array([1]))).toThrow(TypeError);
  });

  test("non-TypedArray arguments throw TypeError", () => {
    expect(() => (Bun.indexOfFirstDifference as any)("hello", "world")).toThrow(TypeError);
    expect(() => (Bun.indexOfFirstDifference as any)(123, 456)).toThrow(TypeError);
    expect(() => (Bun.indexOfFirstDifference as any)(new Uint8Array([1]), "world")).toThrow(TypeError);
  });

  test("Uint16Array element-level index", () => {
    // Each element is 2 bytes. Difference at element index 1.
    const a = new Uint16Array([0xaaaa, 0xbbbb, 0xcccc]);
    const b = new Uint16Array([0xaaaa, 0xffff, 0xcccc]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(1);
  });

  test("Int32Array element-level index", () => {
    // Each element is 4 bytes. Difference at element index 2.
    const a = new Int32Array([1, 2, 3, 4]);
    const b = new Int32Array([1, 2, 99, 4]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(2);
  });

  test("Uint32Array difference only in 3rd byte of element", () => {
    // On little-endian, 0x00000000 vs 0x00FF0000 differ at byte offset 2 within the element.
    // The function should still return element index 0 (not byte index 2).
    const a = new Uint32Array([0x00000000, 0x12345678]);
    const b = new Uint32Array([0x00ff0000, 0x12345678]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(0);

    // Same but difference in element 1's 3rd byte
    const c = new Uint32Array([0x12345678, 0x00000000, 0xaabbccdd]);
    const d = new Uint32Array([0x12345678, 0x00ff0000, 0xaabbccdd]);
    expect(Bun.indexOfFirstDifference(c, d)).toBe(1);
  });

  test("Uint32Array difference only in last byte of element", () => {
    // 0x00000000 vs 0xFF000000 — differ only in the 4th byte (byte offset 3)
    const a = new Uint32Array([0x11111111, 0x00000000]);
    const b = new Uint32Array([0x11111111, 0xff000000]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(1);
  });

  test("Uint32Array interior byte diff at every element and byte position", () => {
    // For each element position and each byte within the element,
    // ensure the correct element index is returned.
    for (let numElems = 1; numElems <= 64; numElems++) {
      for (let elemIdx = 0; elemIdx < numElems; elemIdx++) {
        for (let byteWithin = 0; byteWithin < 4; byteWithin++) {
          const a = new Uint32Array(numElems);
          const b = new Uint32Array(numElems);
          for (let i = 0; i < numElems; i++) {
            a[i] = 0x01010101;
            b[i] = 0x01010101;
          }
          // Flip just one byte within the element
          b[elemIdx] = b[elemIdx]! ^ (0xff << (byteWithin * 8));
          expect(Bun.indexOfFirstDifference(a, b)).toBe(elemIdx);
        }
      }
    }
  });

  test("BigUint64Array element-level index", () => {
    // Each element is 8 bytes. Difference at element index 1.
    const a = new BigUint64Array([0xffffffffffffffffn, 0x1234567890abcdefn, 0n]);
    const b = new BigUint64Array([0xffffffffffffffffn, 0n, 0n]);
    expect(Bun.indexOfFirstDifference(a, b)).toBe(1);
  });
});
