const assert = require("assert");

test("assert from require as a function does not throw", () => assert(true));
test("assert from require as a function does throw", () => {
  try {
    assert(false);
    expect(false).toBe(true);
  } catch (e) {}
});

describe("assert.partialDeepStrictEqual", () => {
  test("arrays match an in-order subsequence with partial element comparison", () => {
    assert.partialDeepStrictEqual([1, 2, 3, 4], [2, 4]);
    expect(() => assert.partialDeepStrictEqual([1, 2, 3, 4], [4, 2])).toThrow(assert.AssertionError);
  });

  test("array subsequence scan skips candidates missing an expected key", () => {
    assert.partialDeepStrictEqual([{ a: 1 }, { b: 2 }], [{ b: 2 }]);
    assert.partialDeepStrictEqual({ items: [{ a: 1 }, { b: 2 }] }, { items: [{ b: 2 }] });
    expect(() => assert.partialDeepStrictEqual([{ a: 1 }, { b: 2 }], [{ c: 3 }])).toThrow(assert.AssertionError);
  });

  test("a repeated reference is re-compared against each expected element", () => {
    const shared = { a: 1 };
    expect(() => assert.partialDeepStrictEqual({ x: [shared, shared] }, { x: [{ a: 1 }, { a: 99 }] })).toThrow(
      assert.AssertionError,
    );
    expect(() => assert.partialDeepStrictEqual({ y: shared, z: shared }, { y: { a: 1 }, z: { a: 99 } })).toThrow(
      assert.AssertionError,
    );
    assert.partialDeepStrictEqual({ x: [shared, shared] }, { x: [{ a: 1 }, { a: 1 }] });

    const sharedMap = new Map([["k", 1]]);
    expect(() =>
      assert.partialDeepStrictEqual({ x: [sharedMap, sharedMap] }, { x: [new Map([["k", 1]]), new Map([["k", 99]])] }),
    ).toThrow(assert.AssertionError);
  });

  test("circular structures compare without recursing forever", () => {
    const a = [];
    a.push(a);
    const b = [];
    b.push(b);
    assert.partialDeepStrictEqual(a, b);
    assert.partialDeepStrictEqual(a, a);

    const oa = {};
    oa.self = oa;
    const ob = {};
    ob.self = ob;
    assert.partialDeepStrictEqual(oa, ob);
  });

  test("a circular actual still fails against a non-circular expected", () => {
    const circularArr = [];
    circularArr.push(circularArr);
    expect(() => assert.partialDeepStrictEqual(circularArr, [[1]])).toThrow(assert.AssertionError);

    const circularObj = {};
    circularObj.self = circularObj;
    expect(() => assert.partialDeepStrictEqual(circularObj, { self: { self: 1 } })).toThrow(assert.AssertionError);

    // And the other way: a non-circular actual against a circular expected.
    const circularExpected = [];
    circularExpected.push(circularExpected);
    expect(() => assert.partialDeepStrictEqual([[1]], circularExpected)).toThrow(assert.AssertionError);
  });

  test("array scan past a non-matching candidate does not poison later matches", () => {
    const shared = { x: 1 };
    expect(() => assert.partialDeepStrictEqual({ arr: [shared, shared] }, { arr: [{ x: 2 }] })).toThrow(
      assert.AssertionError,
    );
    assert.partialDeepStrictEqual({ arr: [shared, shared] }, { arr: [{ x: 1 }] });
  });

  test("a descendant actual identical to an ancestor expected is not mistaken for a cycle", () => {
    const e = { k: {} };
    assert.partialDeepStrictEqual({ k: e }, e);

    const arr = [[]];
    assert.partialDeepStrictEqual([arr], arr);
  });

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
    const a = new Set();
    a.add({ s: a });
    const b = new Set();
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
