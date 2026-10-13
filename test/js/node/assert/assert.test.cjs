const assert = require("assert");
const crypto = require("crypto");
const vm = require("vm");
const { bunEnv, bunExe } = require("harness");

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

  // A hole is not an element. Node.js scans both arrays until the first hole on either side, then
  // matches the rest of Object.keys(expected) in order inside the rest of Object.keys(actual)
  // (partialArrayEquiv and partialSparseArrayEquiv in lib/internal/util/comparisons.js).
  // Every result in these tables is the answer of Node.js v26.3.0 for the same call.
  describe("array holes", () => {
    const outcome = (actual, expected) => {
      try {
        assert.partialDeepStrictEqual(actual, expected);
        return "passes";
      } catch (error) {
        if (!(error instanceof assert.AssertionError)) throw error;
        return "throws";
      }
    };
    // Each row is [label, actual, expected, result in Node.js].
    const rows = (title, table, run = test) =>
      describe(title, () => {
        run.each(table)("%s", (label, actual, expected, result) => {
          expect(outcome(actual, expected)).toBe(result);
        });
      });
    const sparse = (length, elements) => Object.assign(new Array(length), elements);
    const withGetter = (array, index, get) => Object.defineProperty(array, index, { get, enumerable: true });
    const hidden = (array, key) => Object.defineProperty(array, key, { enumerable: false });
    const tag = Symbol.toStringTag;
    const tagged = (object, value = "x") => Object.defineProperty(object, tag, { value });
    const sym = Symbol("key");

    rows("a hole in actual does not match undefined", [
      ["[,] has [undefined]", [,], [undefined], "throws"],
      ["[1, , 3] has [1, undefined, 3]", [1, , 3], [1, undefined, 3], "throws"],
      ["[, 1] has [undefined, 1]", [, 1], [undefined, 1], "throws"],
      ["[1, ,] has [1, undefined]", [1, ,], [1, undefined], "throws"],
      ["[, 1, 2] has [undefined]", [, 1, 2], [undefined], "throws"],
      ["[, undefined, 2] has [undefined, undefined]", [, undefined, 2], [undefined, undefined], "throws"],
      ["new Array(3) has [undefined, undefined, undefined]", new Array(3), [undefined, undefined, undefined], "throws"],
      ["[, , ,] has [1]", [, , ,], [1], "throws"],
      ["control: [undefined] has [undefined]", [undefined], [undefined], "passes"],
      ["control: [, undefined, 2] has [undefined]", [, undefined, 2], [undefined], "passes"],
      ["control: [1, , 3] has [1, 3]", [1, , 3], [1, 3], "passes"],
      ["control: [, 1, 2] has [1, 2]", [, 1, 2], [1, 2], "passes"],
    ]);

    rows("a hole in expected matches nothing and is skipped", [
      ["[1, 2, 3] has [, 2]", [1, 2, 3], [, 2], "passes"],
      ["[1, 2, 3] has [1, , 3]", [1, 2, 3], [1, , 3], "passes"],
      ["[1, 2, 3, 4] has [1, , 4]", [1, 2, 3, 4], [1, , 4], "passes"],
      ["[1, 2, 3] has [, , 3]", [1, 2, 3], [, , 3], "passes"],
      ["[1, 2, 3] has [, , 1]", [1, 2, 3], [, , 1], "passes"],
      ["[1, 2, 3] has [, , ,]", [1, 2, 3], [, , ,], "passes"],
      ["[1, 2, 3] has [1, 2, ,]", [1, 2, 3], [1, 2, ,], "passes"],
      ["[{ a: 1, b: 2 }, { c: 3 }] has [, { c: 3 }]", [{ a: 1, b: 2 }, { c: 3 }], [, { c: 3 }], "passes"],
      ["[undefined] has [,]", [undefined], [,], "passes"],
      ["[1, , 3] has [1, , 3]", [1, , 3], [1, , 3], "passes"],
      ["new Array(1000) has new Array(100)", new Array(1000), new Array(100), "passes"],
      ["[1, 2, 3] has [, 4]", [1, 2, 3], [, 4], "throws"],
      ["[3, 2, 1] has [1, , 3]", [3, 2, 1], [1, , 3], "throws"],
      ["[{ a: 1 }, { c: 3 }] has [, { d: 3 }]", [{ a: 1 }, { c: 3 }], [, { d: 3 }], "throws"],
      ["longer expected: [1, 3] has [1, , 3]", [1, 3], [1, , 3], "throws"],
      ["longer expected: new Array(100) has new Array(1000)", new Array(100), new Array(1000), "throws"],
    ]);

    const sparseActual = sparse(1000, { 90: 1, 92: 2, 95: 1, 96: 2 });
    rows("sparse arrays match by their own keys, not by position", [
      ["a subset at the same indexes", sparseActual, sparse(1000, { 90: 1, 95: 1 }), "passes"],
      ["a subset at other indexes", sparseActual, sparse(100, { 3: 2, 7: 1 }), "passes"],
      ["a value that is absent", sparseActual, sparse(1000, { 90: 1, 92: 1, 95: 1 }), "throws"],
      ["values out of order", sparseActual, sparse(1000, { 90: 2, 95: 1, 96: 1 }), "throws"],
      ["more keys than actual has", sparse(1000, { 90: 1, 92: 1 }), sparse(1000, { 90: 1, 92: 1, 95: 1 }), "throws"],
      ["partial objects", sparse(10, { 1: { a: 1, b: 2 } }), sparse(10, { 7: { a: 1 } }), "passes"],
    ]);

    const cyclicActual = [0, 1];
    cyclicActual.push(cyclicActual);
    const cyclicExpected = [, 1];
    cyclicExpected.push(cyclicExpected);
    rows("a hole is found in every nested position", [
      ["object value", { list: [,] }, { list: [undefined] }, "throws"],
      ["object value, hole in expected", { list: [1, 2, 3] }, { list: [, 3] }, "passes"],
      ["array element", [[1, , 3]], [[1, undefined, 3]], "throws"],
      ["array element, hole in expected", [[1, 2, 3]], [[, 2]], "passes"],
      ["Set member", new Set([[,]]), new Set([[undefined]]), "throws"],
      ["Set member, hole in expected", new Set([[1, 2, 3]]), new Set([[, 2]]), "passes"],
      ["Map value", new Map([["k", [,]]]), new Map([["k", [undefined]]]), "throws"],
      ["Map value, hole in expected", new Map([["k", [1, 2, 3]]]), new Map([["k", [, 2]]]), "passes"],
      ["Map key", new Map([[[,], 1]]), new Map([[[undefined], 1]]), "throws"],
      ["Error cause", new Error("e", { cause: [,] }), new Error("e", { cause: [undefined] }), "throws"],
      ["cycle", cyclicActual, cyclicExpected, "passes"],
    ]);

    class Sub extends Array {}
    const sparseSub = new Sub(3);
    sparseSub[0] = 1;
    sparseSub[2] = 3;
    rows("every kind of array tells a hole from undefined", [
      ["doubles", [1.5, , 3.5], [1.5, undefined, 3.5], "throws"],
      ["doubles, hole in expected", [1.5, 2.5, 3.5], [, 2.5], "passes"],
      ["strings", ["a", , "c"], ["a", undefined, "c"], "throws"],
      ["strings, hole in expected", ["a", , "c", , "e"], [, "c", "e"], "passes"],
      ["frozen", Object.freeze([1, , 3]), [1, undefined, 3], "throws"],
      ["frozen, hole in expected", [1, 2, 3], Object.freeze([, 2]), "passes"],
      ["sealed", Object.seal([1, , 3]), [1, undefined, 3], "throws"],
      ["sealed, no undefined expected", Object.seal([1, , 3]), [1, 3], "passes"],
      ["subclass", sparseSub, Sub.of(1, undefined, 3), "throws"],
      ["subclass, hole in expected", Sub.of(1, 2, 3), sparseSub, "passes"],
      ["other realm", vm.runInNewContext("[1, , 3]"), [1, undefined, 3], "throws"],
      ["other realm, hole in expected", [1, 2, 3], vm.runInNewContext("[, 2]"), "passes"],
      ["Proxy", new Proxy([,], {}), [undefined], "throws"],
      ["Proxy, hole in expected", [1, 2, 3], new Proxy([, 2], {}), "passes"],
      ["Proxy of a Proxy", new Proxy(new Proxy([1, , 3], {}), {}), [1, undefined], "throws"],
      ["index far from the others", sparse(3, { 0: 1, 100000: 4 }), [1, undefined], "throws"],
      ["index far from the others, hole in expected", sparse(3, { 0: 1, 100000: 4 }), [, 4], "passes"],
      [
        "a getter that returns undefined is an element",
        withGetter([1, 0, 3], 1, () => undefined),
        [1, undefined, 3],
        "passes",
      ],
      ["a hole is not that getter", [1, , 3], withGetter([1, 0, 3], 1, () => undefined), "throws"],
      ["a getter after a hole", withGetter([, 0, 3], 1, () => 2), [2, 3], "passes"],
    ]);

    // Before the first hole the scan is bound by both lengths, which count holes. From the first
    // hole on the keys are Object.keys: named keys follow the indexes and hidden indexes are left out.
    rows("the two phases of Node.js", [
      ["[, 1] has [1, ,]", [, 1], [1, ,], "passes"],
      ["[, undefined] has [undefined, ,]", [, undefined], [undefined, ,], "passes"],
      ["[1, 2] has [2, ,]", [1, 2], [2, ,], "throws"],
      ["[1, 2, 3] has [2, ,]", [1, 2, 3], [2, ,], "passes"],
      ["[1, 2] has [, 2]", [1, 2], [, 2], "passes"],
      ["[1, 2, 3] has [3, ,]", [1, 2, 3], [3, ,], "throws"],
      ["a named key of actual is a candidate", Object.assign([1, , 3], { foo: "x" }), [1, "x"], "passes"],
      [
        "named keys match in their order",
        Object.assign([1, , 3], { a: 1, b: 2 }),
        Object.assign([1, , 3], { b: 2, a: 1 }),
        "throws",
      ],
      ["a hidden index, no hole", hidden([1, 2, 3], 1), [1, 2, 3], "passes"],
      ["a hidden index of actual, hole in expected", hidden([1, 2, 3], 1), [, 2], "throws"],
      ["a hidden index of expected, hole in expected", [1, 2, 3], hidden([, 2, 3], 1), "passes"],
      ["a hidden index in a sparse array", hidden(sparse(6001, { 5000: 1, 6000: 2 }), 6000), [2], "throws"],
    ]);

    // Node.js uses the position of the first hole as an offset into Object.keys. A hidden index
    // before the hole shifts that offset, and the keys after it are not compared: 2 and 99 are not
    // in actual. That is a defect of Node.js. These rows hold it on purpose.
    rows("a hidden index before the first hole", [
      ["[1, ,] has [1 (hidden), 2]", [1, ,], hidden([1, 2], 0), "passes"],
      ["[1, 2, 3, 5] has [1 (hidden), 2, , 99]", [1, 2, 3, 5], hidden([1, 2, , 99], 0), "passes"],
    ]);

    class Tagged extends Array {
      get [tag]() {
        return "Tagged";
      }
    }
    rows("Symbol.toStringTag and named keys are compared before the elements", [
      ["tag on actual", Object.assign([1], { [tag]: "x" }), [1], "throws"],
      ["tag on expected", [1], Object.assign([1], { [tag]: "x" }), "throws"],
      ["tag from the class of actual", Tagged.of(1, 2), [1, 2], "throws"],
      ["tag from the class of both", Tagged.of(1, 2, 3), Tagged.of(1, 3), "passes"],
      ["tag on actual, hole in expected", Object.assign([1, 2, 3], { [tag]: "x" }), [, 2], "throws"],
      ["tag on actual, hole in actual", Object.assign([1, , 3], { [tag]: "x" }), [1, 3], "throws"],
      [
        "same tag, hole in expected",
        Object.assign([1, 2, 3], { [tag]: "x" }),
        Object.assign([, 2], { [tag]: "x" }),
        "passes",
      ],
      [
        "symbol key differs, hole in expected",
        Object.assign([1, 2, 3], { [sym]: 1 }),
        Object.assign([1, , 3], { [sym]: 2 }),
        "throws",
      ],
      ["symbol key missing, hole in expected", [1, 2, 3], Object.assign([1, , 3], { [sym]: 2 }), "throws"],
      [
        "symbol key differs, hole in actual",
        Object.assign([1, , 3], { [sym]: 1 }),
        Object.assign([1, 3], { [sym]: 2 }),
        "throws",
      ],
      ["named key missing, its value is an element", [1, 2, 3], Object.assign([1, ,], { foo: 2 }), "throws"],
      [
        "named key hidden on actual",
        hidden(Object.assign([1, 2, 3], { foo: 2 }), "foo"),
        Object.assign([1, ,], { foo: 2 }),
        "throws",
      ],
      ["named key equal", Object.assign([1, 2, 3], { foo: 7 }), Object.assign([1, , 3], { foo: 7 }), "passes"],
      [
        "named key compared partially",
        Object.assign([1, , 3], { k: [1, 2, 3] }),
        Object.assign([1, , 3], { k: [, 2] }),
        "passes",
      ],
      ["Proxy with a named key", [1], new Proxy(Object.assign([1], { k: 1 }), {}), "throws"],
      ["Proxy with a named key and a hole", [1, 1, 1], new Proxy(Object.assign([, 1], { k: 1 }), {}), "throws"],
      ["Proxy with a symbol key and a hole", [1, 2, 3], new Proxy(Object.assign([, 2], { [sym]: 1 }), {}), "throws"],
      [
        "Proxy with an equal named key and a hole",
        Object.assign([1, 2, 3], { k: 1 }),
        new Proxy(Object.assign([, 2], { k: 1 }), {}),
        "passes",
      ],
    ]);

    rows(
      "Symbol.toStringTag is compared in every kind of object but a view",
      Object.entries({
        Map: () => new Map([[1, 1]]),
        Set: () => new Set([1]),
        Date: () => new Date(0),
        RegExp: () => /a/g,
        Error: () => new Error("e"),
        URL: () => new URL("http://a/"),
        KeyObject: () => crypto.createSecretKey(Buffer.from("secret")),
        Number: () => new Number(1),
        Object: () => ({ a: 1 }),
        ArrayBuffer: () => new ArrayBuffer(2),
      })
        .flatMap(([kind, make]) => [
          [`${kind}, tag on actual`, tagged(make()), make(), "throws"],
          [`${kind}, tag on expected`, make(), tagged(make()), "throws"],
          [`${kind}, different tags`, tagged(make(), "x"), tagged(make(), "y"), "throws"],
          [`${kind}, same tag`, tagged(make()), tagged(make()), "passes"],
        ])
        .concat([
          ["Uint8Array, tag on actual", tagged(new Uint8Array([1])), new Uint8Array([1]), "passes"],
          ["Uint8Array, tag on expected", new Uint8Array([1]), tagged(new Uint8Array([1])), "passes"],
          [
            "DataView, tag on actual",
            tagged(new DataView(new ArrayBuffer(1))),
            new DataView(new ArrayBuffer(1)),
            "passes",
          ],
          [
            "DataView, tag on expected",
            new DataView(new ArrayBuffer(1)),
            tagged(new DataView(new ArrayBuffer(1))),
            "passes",
          ],
        ]),
    );

    // Node.js settles the lengths, the tags and the named keys of expected before it looks for a cycle.
    const shortInCycle = [];
    const longInCycle = [shortInCycle, 9];
    shortInCycle.push(longInCycle);
    const expectedShort = [];
    const expectedLong = [];
    expectedShort.push(expectedLong);
    expectedLong.push(expectedLong, 9);
    const taggedInCycle = [tagged([])];
    taggedInCycle.push(taggedInCycle);
    rows("a cycle does not answer for the lengths and the tags", [
      ["a revisit with a shorter actual", shortInCycle, expectedShort, "throws"],
      ["an empty expected against a revisit of actual", taggedInCycle, [[]], "passes"],
    ]);

    rows("a Proxy is compared through its traps", [
      ["elements at other indexes", [9, 8, 2], new Proxy([, 2], {}), "passes"],
      [
        "ownKeys hides an index",
        [1, 9, 3],
        new Proxy([, 2, 3], { ownKeys: target => Reflect.ownKeys(target).filter(key => key !== "1") }),
        "passes",
      ],
      [
        "get changes an element",
        [1, 20, 3],
        new Proxy([, 2, 3], {
          get: (target, key, receiver) => (key === "1" ? 20 : Reflect.get(target, key, receiver)),
        }),
        "passes",
      ],
    ]);

    rows("named keys follow the index keys of every kind of storage", [
      ["frozen actual", Object.freeze(Object.assign([1, , 3], { foo: "x" })), [1, "x"], "passes"],
      ["index far from the others", Object.assign(sparse(3, { 0: 1, 100000: 4 }), { foo: "x" }), [1, 4, "x"], "passes"],
    ]);

    // The tag compare uses the class string: a tag that is not a string, or that is the built-in
    // class name, is not seen. The lengths are read once: Node.js reads them again at every step.
    const growsWhenRead = withGetter([0, 2], 0, () => {
      growsWhenRead.push(3);
      return 1;
    });
    rows(
      "answers of Node.js that are not matched yet",
      [
        ['tag "Array" on actual', tagged([1], "Array"), [1], "throws"],
        ['tag "Array" on expected', [1], tagged([1], "Array"), "throws"],
        ["tag 5 on actual", tagged([1], 5), [1], "throws"],
        ["tags 5 and 6", tagged([1], 5), tagged([1], 6), "throws"],
        ["an index getter that grows actual", growsWhenRead, [1, 3], "passes"],
      ],
      test.failing,
    );

    test("a named key that throws is read before the elements", () => {
      const expected = Object.defineProperty([, 9], "k", {
        get() {
          throw new RangeError("from the getter");
        },
        enumerable: true,
      });
      expect(() => assert.partialDeepStrictEqual(Object.assign([1, 2], { k: 1 }), expected)).toThrow(
        new RangeError("from the getter"),
      );
    });

    test("an element read that throws is not a hole", () => {
      const trap = new Proxy([, 2], {
        getOwnPropertyDescriptor() {
          throw new RangeError("from the trap");
        },
      });
      expect(() => assert.partialDeepStrictEqual([1, 2], trap)).toThrow(new RangeError("from the trap"));
      const getter = withGetter([, 0, 3], 1, () => {
        throw new RangeError("from the getter");
      });
      expect(() => assert.partialDeepStrictEqual(getter, [3])).toThrow(new RangeError("from the getter"));
    });

    // All ordered pairs of the arrays of length 0 to 3 over a hole, undefined and 1. Bit n of
    // `answers` says that Node.js v26.3.0 passes pair n. To record it again, run this loop in
    // Node.js with a bit set for each pair that passes.
    test("every pair of small arrays gets the answer of Node.js", () => {
      const answers = Buffer.from(
        "AQAAAAADAAAAAAcAAAAACwAAAAATAAAAALcAAAAAWwQAAAC3AAAAALcBAAAA/wIAAABbBAAAAH8MAAAAWxQAAAATIAAAALdgQQAAW6QIgAC3YEEAALdhwwIA/+ZNkQBbpAiAAP/sWYAFW7QogCK3YEEAALdhwwIA/+ZNEQC3YcMCALdhwwYA/+PPCwD/5k0RAP/v3zEA//ZtUQBbpAiAAP/sGYAFW7QogCL/7BmABf/tG4AN//49gBdbtCiAIn/8OYBjW7QogKI=",
        "base64",
      );
      const hole = Symbol("hole");
      const specs = [[]];
      for (let i = 0; i < specs.length; i++) {
        if (specs[i].length < 3) for (const value of [hole, undefined, 1]) specs.push([...specs[i], value]);
      }
      const build = spec => {
        const array = new Array(spec.length);
        spec.forEach((value, index) => {
          if (value !== hole) array[index] = value;
        });
        return array;
      };
      const show = spec =>
        `[${spec.map(value => (value === hole ? "" : String(value))).join(", ")}${spec.at(-1) === hole ? "," : ""}]`;
      const mismatch = new Error("not equal");
      const wrong = [];
      let pair = 0;
      for (const actual of specs) {
        for (const expected of specs) {
          let passes = true;
          try {
            assert.partialDeepStrictEqual(build(actual), build(expected), mismatch);
          } catch (error) {
            if (error !== mismatch) throw error;
            passes = false;
          }
          const passesInNode = ((answers[pair >> 3] >> (pair & 7)) & 1) === 1;
          if (passes !== passesInNode) {
            wrong.push(`${show(actual)} has ${show(expected)}: Node.js ${passesInNode ? "passes" : "throws"}`);
          }
          pair++;
        }
      }
      expect({ pairs: pair, wrong }).toEqual({ pairs: 1600, wrong: [] });
    });

    // A getter of an element changes the array that holds it while the keys after the hole are matched.
    const selfChanging = change => {
      const array = [
        ,
        {
          get v() {
            change(array);
            return 1;
          },
        },
        { v: 2 },
        { v: 3 },
      ];
      return array;
    };
    rows("an array that changes during the comparison", [
      ["actual is truncated", selfChanging(array => (array.length = 2)), [{ v: 1 }, { v: 3 }], "throws"],
      ["actual loses a later element", selfChanging(array => delete array[3]), [{ v: 1 }, { v: 3 }], "throws"],
      ["actual is emptied", selfChanging(array => (array.length = 0)), [{ v: 1 }, { v: 2 }], "throws"],
      ["actual is emptied after the last match", selfChanging(array => (array.length = 0)), [{ v: 1 }], "passes"],
      ["actual is frozen", selfChanging(array => Object.freeze(array)), [{ v: 1 }, { v: 3 }], "passes"],
      [
        "actual gets an index far from the others",
        selfChanging(array => (array[1e9] = 0)),
        [{ v: 1 }, { v: 2 }],
        "passes",
      ],
      [
        "actual is reallocated",
        selfChanging(array => {
          for (let i = 0; i < 1e5; i++) array.push(i);
          array.length = 4;
        }),
        [{ v: 1 }, { v: 2 }],
        "passes",
      ],
      ["actual is pushed to", selfChanging(array => array.push({ v: 9 })), [{ v: 1 }, { v: 9 }], "throws"],
      ["actual gets a named key", selfChanging(array => (array.k = "n")), [{ v: 1 }, "n"], "throws"],
      ["actual gets an index that expected needs", selfChanging(array => (array[1e9] = 0)), [{ v: 1 }, 0], "throws"],
      ["actual gets its hole filled", selfChanging(array => (array[0] = { v: 5 })), [{ v: 1 }, { v: 5 }], "throws"],
      [
        "actual loses an element that expected has as undefined",
        selfChanging(array => delete array[3]),
        [{ v: 1 }, undefined],
        "passes",
      ],
      ["expected grows", [{ v: 1 }, { v: 2 }, { v: 3 }, 4], selfChanging(array => array.push({ v: 7 })), "passes"],
    ]);

    // The child exits in time only if the comparison reads the keys that exist, once. A mismatch
    // throws the error it is given, so no message is built for these arrays.
    const inChild = async script => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const assert = require("node:assert");
           const mismatch = new Error("not equal");
           const outcome = (actual, expected) => {
             try {
               assert.partialDeepStrictEqual(actual, expected, mismatch);
               return "passes";
             } catch (error) {
               if (error !== mismatch) throw error;
               return "throws";
             }
           };
           const results = {};
           ${script}
           console.log(JSON.stringify(results));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { results: stdout && JSON.parse(stdout), stderr, exitCode, signalCode: proc.signalCode };
    };

    // `array.length = 2 ** 32 - 1` puts the elements in a sparse map. The last two rows need an index
    // on Array.prototype: Node.js reads it as an element in the scan, and it is not a key after the hole.
    test.concurrent("the length of a sparse array does not set the cost", async () => {
      expect(
        await inChild(`
          const huge = elements => {
            const array = [];
            array.length = 2 ** 32 - 1;
            return Object.assign(array, elements);
          };
          results["one element, dense expected"] = outcome(huge({ 4000000000: "x" }), ["x"]);
          results["one element, another value expected"] = outcome(huge({ 4000000000: "x" }), ["y"]);
          results["one element each"] = outcome(huge({ 4000000000: "x" }), huge({ 5: "x" }));
          results["the last index"] = outcome(huge({ [2 ** 32 - 2]: "x" }), huge({ [2 ** 32 - 2]: "x" }));
          results["two elements in order"] = outcome(huge({ 7: "x", 4000000000: "y" }), huge({ 1: "x", 2: "y" }));
          results["more keys than actual has"] = outcome(huge({ 4000000000: "x" }), huge({ 1: "x", 2: "x" }));
          results["no element"] = outcome(huge({}), huge({}));
          Array.prototype[3] = "Q";
          results["inherited index before a hole in actual"] = outcome([1, 2, 3, , 5, , 7], [1, 2, 3, "Q", 5, 7]);
          results["inherited index before a hole in expected"] = outcome([1, 2, 3, "Q", 5, 7], [1, 2, 3, , , 7]);
          delete Array.prototype[3];
        `),
      ).toEqual({
        results: {
          "one element, dense expected": "passes",
          "one element, another value expected": "throws",
          "one element each": "passes",
          "the last index": "passes",
          "two elements in order": "passes",
          "more keys than actual has": "throws",
          "no element": "passes",
          "inherited index before a hole in actual": "throws",
          "inherited index before a hole in expected": "passes",
        },
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    // `new Array(500_000)` keeps its elements in a flat vector with holes, which is read slot by slot.
    // Freezing an array moves its elements to a sparse map.
    test.concurrent("the keys of a large array are listed once", async () => {
      expect(
        await inChild(`
          const spread = () => {
            const array = new Array(500_000);
            for (let i = 0; i < 10_000; i++) array[i * 50] = i;
            return array;
          };
          results["10,000 elements in 500,000 slots, the last one expected"] = outcome(spread(), [, 9_999]);
          results["10,000 elements in 500,000 slots, all expected"] = outcome(spread(), spread());
          const frozenByItsElement = [
            ,
            {
              get v() {
                Object.freeze(frozenByItsElement);
                return 1;
              },
            },
          ];
          for (let i = 2; i <= 5_000; i++) frozenByItsElement.push({ v: i });
          results["5,000 elements, frozen by the first one"] = outcome(frozenByItsElement, [{ v: 1 }, { v: 5_000 }]);
        `),
      ).toEqual({
        results: {
          "10,000 elements in 500,000 slots, the last one expected": "passes",
          "10,000 elements in 500,000 slots, all expected": "passes",
          "5,000 elements, frozen by the first one": "passes",
        },
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });
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

  test("line diff prints UTF-16 lines as text", () => {
    expect(messageOf(() => assert.deepStrictEqual({ s: "😀\nx" }, { s: "😺\nx" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   s: '😀\\nx'\n-   s: '😺\\nx'\n  }\n",
    );
    const a = Array.from({ length: 30 }, (_, i) => `値${i}`);
    const b = a.map((v, i) => (i === 2 || i === 27 ? "x" : v));
    expect(messageOf(() => assert.deepStrictEqual(a, b))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n... Skipped lines\n\n  [\n    '値0',\n    '値1',\n+   '値2',\n-   'x',\n    '値3',\n    '値4',\n    '値5',\n    '値6',\n    '値7',\n...\n    '値26',\n+   '値27',\n-   'x',\n    '値28',\n    '値29'\n  ]\n",
    );
  });

  test("mixed Latin-1 / UTF-16 sides diff by code unit", () => {
    expect(messageOf(() => assert.deepStrictEqual({ s: "café\nx" }, { s: "😀\nx" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   s: 'café\\nx'\n-   s: '😀\\nx'\n  }\n",
    );
  });

  test("long unchanged runs collapse with ... and report skipped lines", () => {
    const a = Array.from({ length: 30 }, (_, i) => i);
    const b = a.map((v, i) => (i === 3 || i === 25 ? -1 : v));
    expect(messageOf(() => assert.deepStrictEqual(a, b))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n... Skipped lines\n\n  [\n    0,\n    1,\n    2,\n+   3,\n-   -1,\n    4,\n    5,\n    6,\n    7,\n    8,\n...\n    24,\n+   25,\n-   -1,\n    26,\n    27,\n    28,\n    29\n  ]\n",
    );
  });

  // The per-character diff is only used when colors are on, so it runs in a child with FORCE_COLOR.
  test("colored char diff handles Latin-1, UTF-16 and mixed inputs", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const assert = require("node:assert");
         const messageOf = fn => { try { fn(); } catch (e) { return e.message; } };
         console.log(JSON.stringify([
           messageOf(() => assert.strictEqual("wörld, hello!", "world, hello!")),
           messageOf(() => assert.strictEqual("a😀b, hello!", "a😺b, hello!")),
           messageOf(() => assert.strictEqual("wörld, hello!", "😀rld, hello!")),
         ]));`,
      ],
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");

    const green = "\x1b[32m";
    const red = "\x1b[31m";
    const white = "\x1b[39m";
    // Every UTF-16 code unit is wrapped in its own color pair, as in node.
    const wrap = (color, s) =>
      s
        .split("")
        .map(c => `${color}${c}${white}`)
        .join("");
    const same = s => wrap(white, s);
    const added = s => wrap(green, s);
    const removed = s => wrap(red, s);
    const charDiff = body =>
      `Expected values to be strictly equal:\n${green}actual${white} ${red}expected${white}\n\n${body}\n`;
    expect(JSON.parse(stdout)).toEqual([
      charDiff(same("'w") + added("ö") + removed("o") + same("rld, hello!'")),
      charDiff(same("'a\ud83d") + added("\ude00") + removed("\ude3a") + same("b, hello!'")),
      charDiff(same("'") + added("wö") + removed("😀") + same("rld, hello!'")),
    ]);
    expect(exitCode).toBe(0);
  });
});
