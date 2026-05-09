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

describe("does not leak uninitialized memory when a getter mutates input buffers during iteration", () => {
  // These tests exercise a former TOCTOU between the sizing pass and the
  // copy pass. A user-defined getter on the input array detaches or resizes
  // a previously-read buffer via ArrayBuffer.prototype.transfer() /
  // .resize(). All user code (getters) now runs before any byte lengths are
  // read or the output buffer is allocated, so the detached/resized state is
  // observed consistently and no uninitialized heap is exposed.

  const SIZE = 64 * 1024;

  function sprayHeap() {
    // Prime freed Gigacage pages with a recognizable pattern so that if the
    // implementation ever regresses to leaking uninitialized memory, the
    // zero-content assertions below observe non-zero bytes rather than
    // happening to pass on a freshly-zeroed heap.
    const spray = [];
    for (let i = 0; i < 64; i++) spray.push(Buffer.alloc(SIZE, 0xcc));
    spray.length = 0;
    Bun.gc(true);
  }

  function makeDetachingArray<T extends { buffer: ArrayBuffer } | ArrayBuffer>(first: T, replacement: T) {
    const arr: T[] = [first];
    Object.defineProperty(arr, 1, {
      enumerable: true,
      get() {
        // Detach the element that was already read at index 0.
        const ab = first instanceof ArrayBuffer ? first : first.buffer;
        ab.transfer();
        return replacement;
      },
    });
    arr.length = 2;
    return arr;
  }

  test("Buffer.concat throws on buffer detached by later getter", () => {
    sprayHeap();
    const first = new Uint8Array(SIZE);
    expect(() => Buffer.concat(makeDetachingArray(first, new Uint8Array(0)))).toThrow(TypeError);
  });

  test("Buffer.concat throws on buffer detached by later getter (3 elements)", () => {
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
    expect(() => Buffer.concat(arr)).toThrow(TypeError);
  });

  test("Buffer.concat sizes output using post-getter length when a resizable buffer shrinks", () => {
    sprayHeap();
    // A shrink doesn't detach, so it must not throw — but the output must
    // reflect the *final* length, not the pre-getter length, otherwise the
    // tail would be uninitialized.
    const ab = new ArrayBuffer(SIZE, { maxByteLength: SIZE });
    const view = new Uint8Array(ab).fill(0xaa);
    const arr: Uint8Array[] = [view];
    Object.defineProperty(arr, 1, {
      enumerable: true,
      get() {
        ab.resize(16);
        return new Uint8Array(0);
      },
    });
    arr.length = 2;
    const out = Buffer.concat(arr);
    expect(out.length).toBe(16);
    expect(out.every(b => b === 0xaa)).toBe(true);
  });

  test("Bun.concatArrayBuffers throws on TypedArray detached by later getter", () => {
    sprayHeap();
    const first = new Uint8Array(SIZE);
    expect(() => Bun.concatArrayBuffers(makeDetachingArray(first, new Uint8Array(0)))).toThrow();
  });

  test("Bun.concatArrayBuffers throws on ArrayBuffer detached by later getter", () => {
    sprayHeap();
    const first = new ArrayBuffer(SIZE);
    expect(() => Bun.concatArrayBuffers(makeDetachingArray(first, new ArrayBuffer(0)))).toThrow();
  });

  test("Bun.concatArrayBuffers throws on mixed inputs with detach", () => {
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
    expect(() => Bun.concatArrayBuffers(arr)).toThrow();
  });

  test("Bun.concatArrayBuffers (asUint8Array = true) throws on detach", () => {
    sprayHeap();
    const first = new Uint8Array(SIZE);
    expect(() => Bun.concatArrayBuffers(makeDetachingArray(first, new Uint8Array(0)), Infinity, true)).toThrow();
  });

  test("Bun.concatArrayBuffers sizes output using post-getter length when a resizable buffer shrinks", () => {
    sprayHeap();
    const ab = new ArrayBuffer(SIZE, { maxByteLength: SIZE });
    new Uint8Array(ab).fill(0xbb);
    const arr: ArrayBuffer[] = [ab];
    Object.defineProperty(arr, 1, {
      enumerable: true,
      get() {
        ab.resize(16);
        return new ArrayBuffer(0);
      },
    });
    arr.length = 2;
    const out = new Uint8Array(Bun.concatArrayBuffers(arr));
    expect(out.length).toBe(16);
    expect(out.every(b => b === 0xbb)).toBe(true);
  });
});
