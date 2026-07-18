import assert from "node:assert";
import { describe, expect, test } from "bun:test";

describe("assert.partialDeepStrictEqual", () => {
  test("TypedArrays, Buffers and DataViews match the expected bytes as an in-order subsequence", () => {
    assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 3]));
    assert.partialDeepStrictEqual(new Uint8Array([1, 2, 1, 3]), new Uint8Array([1, 1, 3]));
    assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]), new Uint8Array([]));
    assert.partialDeepStrictEqual(new Uint16Array([1, 2, 3]), new Uint16Array([1, 3]));
    assert.partialDeepStrictEqual(new Float32Array([1.5, 2.5, 3.5]), new Float32Array([1.5, 3.5]));
    assert.partialDeepStrictEqual(new Float64Array([1, NaN, 3]), new Float64Array([NaN]));
    assert.partialDeepStrictEqual(new BigInt64Array([1n, 2n, 3n]), new BigInt64Array([1n, 3n]));
    assert.partialDeepStrictEqual(Buffer.from([1, 2, 3]), Buffer.from([1, 2]));
    assert.partialDeepStrictEqual(Buffer.from([1, 2, 3]), new Uint8Array([1, 3]));
    assert.partialDeepStrictEqual(
      new DataView(new Uint8Array([1, 2, 3]).buffer),
      new DataView(new Uint8Array([1, 3]).buffer),
    );

    expect(() => assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]), new Uint8Array([3, 1]))).toThrow(
      assert.AssertionError,
    );
    expect(() => assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4]))).toThrow(
      assert.AssertionError,
    );
    expect(() => assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]), new Int8Array([1, 3]))).toThrow(
      assert.AssertionError,
    );
    expect(() =>
      assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]), new DataView(new Uint8Array([1, 3]).buffer)),
    ).toThrow(assert.AssertionError);
  });

  test("ArrayBuffers match the expected bytes as an in-order subsequence", () => {
    assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]).buffer, new Uint8Array([1, 3]).buffer);
    assert.partialDeepStrictEqual(new SharedArrayBuffer(3), new SharedArrayBuffer(2));

    expect(() => assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]).buffer, new Uint8Array([1, 3]))).toThrow(
      assert.AssertionError,
    );
    expect(() => assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 3]).buffer)).toThrow(
      assert.AssertionError,
    );
    expect(() => assert.partialDeepStrictEqual(new ArrayBuffer(3), new SharedArrayBuffer(2))).toThrow(
      assert.AssertionError,
    );
  });

  test("Set members are compared with the partial algorithm", () => {
    assert.partialDeepStrictEqual(new Set([{ a: 1, b: 2 }]), new Set([{ a: 1 }]));
    assert.partialDeepStrictEqual(new Set([{ a: 1, b: 2 }, { c: 3 }]), new Set([{ a: 1 }]));
    assert.partialDeepStrictEqual(new Set([[1, 2, 3]]), new Set([[1, 3]]));
    assert.partialDeepStrictEqual(new Set([{ a: 1 }, { a: 1, b: 2 }]), new Set([{ a: 1 }, { a: 1 }]));
    assert.partialDeepStrictEqual(new Set([{ a: 1, nested: { x: 1, y: 2 } }]), new Set([{ nested: { x: 1 } }]));

    expect(() => assert.partialDeepStrictEqual(new Set([{ a: 1 }]), new Set([{ a: 1, b: 2 }]))).toThrow(
      assert.AssertionError,
    );
    expect(() => assert.partialDeepStrictEqual(new Set([{ a: 1 }]), new Set([{ a: 1 }, { b: 1 }]))).toThrow(
      assert.AssertionError,
    );

    // Circular Set structures still terminate.
    const a = new Set<object>();
    a.add({ s: a });
    const b = new Set<object>();
    b.add({ s: b });
    assert.partialDeepStrictEqual(a, b);
  });

  test("holes in the expected array are skipped", () => {
    assert.partialDeepStrictEqual([1, 2, 3], [, 2]);
    assert.partialDeepStrictEqual([1, 2, 3], [1, , 3]);
    assert.partialDeepStrictEqual([1, 2, 3], [, , ,]);
    assert.partialDeepStrictEqual([1, undefined, 3], [, undefined]);
    assert.partialDeepStrictEqual({ x: [5, 6, 7] }, { x: [, 6] });
    assert.partialDeepStrictEqual([, 2, 3], [2]);

    // Holes do not relax the length gate.
    expect(() => assert.partialDeepStrictEqual([1, 2, 3], [, , , ,])).toThrow(assert.AssertionError);
    expect(() => assert.partialDeepStrictEqual([1, 2], [, , ,])).toThrow(assert.AssertionError);
    // An explicit undefined in expected does not match a hole in actual.
    expect(() => assert.partialDeepStrictEqual([, 2, 3], [undefined])).toThrow(assert.AssertionError);
  });
});
