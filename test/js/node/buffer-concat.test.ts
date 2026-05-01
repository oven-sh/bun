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

describe("does not leak uninitialized memory when input is detached by a getter during iteration", () => {
  // These tests exercise a TOCTOU between the sizing pass and the copy pass.
  // A user-defined getter on the input array detaches a previously-measured
  // buffer via ArrayBuffer.prototype.transfer(). The output allocation was
  // sized for the original length, but the copy pass sees a 0-length span for
  // the detached buffer. The tail of the output must be zeroed, not left as
  // uninitialized heap.

  const SIZE = 64 * 1024;

  function sprayHeap() {
    // Prime freed Gigacage pages with a recognizable pattern so that if the
    // implementation ever regresses to leaking uninitialized memory, the
    // assertions below observe non-zero bytes rather than happening to pass
    // on a freshly-zeroed heap.
    const spray = [];
    for (let i = 0; i < 64; i++) spray.push(Buffer.alloc(SIZE, 0xcc));
    spray.length = 0;
    Bun.gc(true);
  }

  function makeDetachingArray(first: Uint8Array) {
    const arr: Uint8Array[] = [first];
    Object.defineProperty(arr, 1, {
      enumerable: true,
      get() {
        // Detach the element that was already measured at index 0.
        first.buffer.transfer();
        return new Uint8Array(0);
      },
    });
    arr.length = 2;
    return arr;
  }

  test("Buffer.concat", () => {
    sprayHeap();
    const first = new Uint8Array(SIZE);
    const out = Buffer.concat(makeDetachingArray(first));
    expect(out.length).toBe(SIZE);
    expect(out.every(b => b === 0)).toBe(true);
  });

  test("Buffer.concat preserves bytes copied before the detach", () => {
    sprayHeap();
    const head = Buffer.alloc(16, 0xaa);
    const victim = new Uint8Array(SIZE);
    const arr: Uint8Array[] = [head, victim];
    Object.defineProperty(arr, 2, {
      enumerable: true,
      get() {
        victim.buffer.transfer();
        return new Uint8Array(0);
      },
    });
    arr.length = 3;
    const out = Buffer.concat(arr);
    expect(out.length).toBe(16 + SIZE);
    expect(out.subarray(0, 16).every(b => b === 0xaa)).toBe(true);
    expect(out.subarray(16).every(b => b === 0)).toBe(true);
  });

  test("Bun.concatArrayBuffers (TypedArray inputs)", () => {
    sprayHeap();
    const first = new Uint8Array(SIZE);
    const out = new Uint8Array(Bun.concatArrayBuffers(makeDetachingArray(first)));
    expect(out.length).toBe(SIZE);
    expect(out.every(b => b === 0)).toBe(true);
  });

  test("Bun.concatArrayBuffers (ArrayBuffer inputs)", () => {
    sprayHeap();
    const first = new ArrayBuffer(SIZE);
    const arr: ArrayBuffer[] = [first];
    Object.defineProperty(arr, 1, {
      enumerable: true,
      get() {
        first.transfer();
        return new ArrayBuffer(0);
      },
    });
    arr.length = 2;
    const out = new Uint8Array(Bun.concatArrayBuffers(arr));
    expect(out.length).toBe(SIZE);
    expect(out.every(b => b === 0)).toBe(true);
  });

  test("Bun.concatArrayBuffers (mixed inputs)", () => {
    sprayHeap();
    const typed = new Uint8Array(SIZE);
    const ab = new ArrayBuffer(16);
    const arr: (Uint8Array | ArrayBuffer)[] = [typed, ab];
    Object.defineProperty(arr, 2, {
      enumerable: true,
      get() {
        typed.buffer.transfer();
        return new Uint8Array(0);
      },
    });
    arr.length = 3;
    const out = new Uint8Array(Bun.concatArrayBuffers(arr));
    expect(out.length).toBe(SIZE + 16);
    expect(out.every(b => b === 0)).toBe(true);
  });

  test("Bun.concatArrayBuffers (asUint8Array = true)", () => {
    sprayHeap();
    const first = new Uint8Array(SIZE);
    const out = Bun.concatArrayBuffers(makeDetachingArray(first), undefined, true);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(SIZE);
    expect(out.every(b => b === 0)).toBe(true);
  });
});
