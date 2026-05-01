import { describe, expect, test } from "bun:test";

test("Buffer.concat throws RangeError for too large buffers", () => {
  const bufferToUse = Buffer.allocUnsafe(1024 * 1024 * 64);
  const buffers = new Array(1024);
  for (let i = 0; i < buffers.length; i++) {
    buffers[i] = bufferToUse;
  }

  expect(() => Buffer.concat(buffers)).toThrow(/JavaScriptCore typed arrays are currently limited to/);
});

test("Buffer.concat works with normal sized buffers", () => {
  const buf1 = Buffer.from("hello");
  const buf2 = Buffer.from(" ");
  const buf3 = Buffer.from("world");
  const result = Buffer.concat([buf1, buf2, buf3]);
  expect(result.toString()).toBe("hello world");
});

test("Buffer.concat with totalLength parameter", () => {
  const buf1 = Buffer.from("hello");
  const buf2 = Buffer.from(" ");
  const buf3 = Buffer.from("world");

  // Test with exact length
  const result1 = Buffer.concat([buf1, buf2, buf3], 11);
  expect(result1.toString()).toBe("hello world");

  // Test with larger length (should pad with zeros)
  const result2 = Buffer.concat([buf1, buf2, buf3], 15);
  expect(result2.length).toBe(15);
  expect(result2.toString("utf8", 0, 11)).toBe("hello world");

  // Test with smaller length (should truncate)
  const result3 = Buffer.concat([buf1, buf2, buf3], 5);
  expect(result3.toString()).toBe("hello");
});

test("Buffer.concat with empty array", () => {
  const result = Buffer.concat([]);
  expect(result.length).toBe(0);
});

test("Buffer.concat with single buffer", () => {
  const buf = Buffer.from("test");
  const result = Buffer.concat([buf]);
  expect(result.toString()).toBe("test");
  expect(result).not.toBe(buf); // Should be a copy
});

test("Bun.concatArrayBuffers throws OutOfMemoryError", () => {
  const bufferToUse = Buffer.allocUnsafe(1024 * 1024 * 64);
  const buffers = new Array(1024);
  for (let i = 0; i < buffers.length; i++) {
    buffers[i] = bufferToUse;
  }

  expect(() => Bun.concatArrayBuffers(buffers)).toThrow(/Failed to allocate/i);
});

describe("Bun.concatArrayBuffers does not leak uninitialized heap when a getter detaches an earlier buffer", () => {
  const BIG = 4096;
  const SMALL = 16;
  const TOTAL = BIG + SMALL;

  function dirtyHeap() {
    // Prime the primitive gigacage with non-zero blocks of the exact size
    // tryCreateUninitialized() will request, so that if the tail is left
    // uninitialized we observe it.
    let churn: Uint8Array[] | null = [];
    for (let i = 0; i < 256; i++) {
      churn.push(new Uint8Array(TOTAL).fill(0xcc));
    }
    churn = null;
    Bun.gc(true);
  }

  function detach(buf: ArrayBuffer) {
    structuredClone(buf, { transfer: [buf] });
  }

  function check(makeBig: () => ArrayBufferView | ArrayBuffer, makeSmall: () => ArrayBufferView | ArrayBuffer) {
    dirtyHeap();
    const expectedSmall = new Uint8Array(SMALL).fill(0x42);
    const expectedTail = new Uint8Array(BIG); // zeros

    for (let attempt = 0; attempt < 32; attempt++) {
      const big = makeBig();
      const small = makeSmall();
      const bigBuffer = big instanceof ArrayBuffer ? big : big.buffer;

      const arr: any[] = [big];
      Object.defineProperty(arr, 1, {
        get() {
          // big's byteLength has already been summed; neuter it now.
          detach(bigBuffer as ArrayBuffer);
          return small;
        },
        enumerable: true,
        configurable: true,
      });
      arr.length = 2;

      const out = new Uint8Array(Bun.concatArrayBuffers(arr));
      expect(out.length).toBe(TOTAL);
      // big is detached (byteLength 0) by the time the copy loop runs, so
      // small's 16 bytes land at offset 0 and the remaining 4096 bytes must
      // be zeroed rather than whatever was previously in that allocation.
      expect(out.subarray(0, SMALL)).toEqual(expectedSmall);
      expect(out.subarray(SMALL)).toEqual(expectedTail);
    }
  }

  test("typed array path", () => {
    check(
      () => new Uint8Array(BIG).fill(0x41),
      () => new Uint8Array(SMALL).fill(0x42),
    );
  });

  test("ArrayBuffer path", () => {
    check(
      () => {
        const b = new ArrayBuffer(BIG);
        new Uint8Array(b).fill(0x41);
        return b;
      },
      () => {
        const b = new ArrayBuffer(SMALL);
        new Uint8Array(b).fill(0x42);
        return b;
      },
    );
  });

  test("mixed ArrayBuffer + typed array path", () => {
    check(
      () => {
        const b = new ArrayBuffer(BIG);
        new Uint8Array(b).fill(0x41);
        return b;
      },
      () => new Uint8Array(SMALL).fill(0x42),
    );
  });

  test("resizable ArrayBuffer shrunk by getter", () => {
    dirtyHeap();
    const expectedTail = new Uint8Array(BIG); // zeros

    for (let attempt = 0; attempt < 32; attempt++) {
      const big = new ArrayBuffer(BIG, { maxByteLength: BIG });
      new Uint8Array(big).fill(0x41);
      const small = new Uint8Array(SMALL).fill(0x42);

      const arr: any[] = [big];
      Object.defineProperty(arr, 1, {
        get() {
          big.resize(0);
          return small;
        },
        enumerable: true,
        configurable: true,
      });
      arr.length = 2;

      const out = new Uint8Array(Bun.concatArrayBuffers(arr));
      expect(out.length).toBe(TOTAL);
      expect(out.subarray(0, SMALL)).toEqual(new Uint8Array(SMALL).fill(0x42));
      expect(out.subarray(SMALL)).toEqual(expectedTail);
    }
  });

  test("asUint8Array=true return path", () => {
    dirtyHeap();
    for (let attempt = 0; attempt < 32; attempt++) {
      const big = new Uint8Array(BIG).fill(0x41);
      const small = new Uint8Array(SMALL).fill(0x42);

      const arr: any[] = [big];
      Object.defineProperty(arr, 1, {
        get() {
          detach(big.buffer as ArrayBuffer);
          return small;
        },
        enumerable: true,
        configurable: true,
      });
      arr.length = 2;

      const out = Bun.concatArrayBuffers(arr, Infinity, true);
      expect(out).toBeInstanceOf(Uint8Array);
      expect(out.length).toBe(TOTAL);
      expect(out.subarray(SMALL)).toEqual(new Uint8Array(BIG));
    }
  });
});
