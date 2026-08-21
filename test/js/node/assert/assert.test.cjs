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

  test("failure message uses the kReadableOperator header", () => {
    let err;
    try {
      assert.partialDeepStrictEqual({ a: 1 }, { b: 2 });
    } catch (e) {
      err = e;
    }
    expect(err.message.split("\n")[0]).toBe("Expected values to be partially and strictly deep-equal:");
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
});

describe("AssertionError diff rendering", () => {
  // Expected messages captured from node v24 (ANSI stripped).
  const messageOf = fn => {
    try {
      fn();
    } catch (e) {
      return Bun.stripANSI(e.message);
    }
    throw new Error("did not throw");
  };

  test("line diff keeps Latin-1 text and trailing spaces intact", () => {
    expect(messageOf(() => assert.deepStrictEqual({ s: "línea\nütf" }, { s: "linea\nutf" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   s: 'línea\\nütf'\n-   s: 'linea\\nutf'\n  }\n",
    );
    expect(messageOf(() => assert.deepStrictEqual({ k: "v    " }, { k: "w" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   k: 'v    '\n-   k: 'w'\n  }\n",
    );
  });

  test("mixed Latin-1 / UTF-16 sides diff by code unit", () => {
    expect(messageOf(() => assert.deepStrictEqual({ s: "café\nx" }, { s: "😀\nx" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   s: 'café\\nx'\n-   s: '😀\\nx'\n  }\n",
    );
    expect(messageOf(() => assert.strictEqual("café", "caf😀"))).toBe(
      "Expected values to be strictly equal:\n\n'café' !== 'caf😀'\n",
    );
  });

  test("long unchanged runs collapse with ... and report skipped lines", () => {
    const a = Array.from({ length: 30 }, (_, i) => i);
    const b = a.map((v, i) => (i === 3 || i === 25 ? -1 : v));
    expect(messageOf(() => assert.deepStrictEqual(a, b))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n... Skipped lines\n\n  [\n    0,\n    1,\n    2,\n+   3,\n-   -1,\n    4,\n    5,\n    6,\n    7,\n    8,\n...\n    24,\n+   25,\n-   -1,\n    26,\n    27,\n    28,\n    29\n  ]\n",
    );
  });
});
