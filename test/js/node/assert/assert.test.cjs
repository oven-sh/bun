const assert = require("assert");
const crypto = require("node:crypto");
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

  test("a circular actual fails against a non-circular expected that it does not contain", () => {
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

  // One maker per object arm of the native comparator.
  const arms = Object.entries({
    "plain object": () => ({}),
    "array": () => [],
    "Map": () => new Map(),
    "Set": () => new Set(),
    "Error": () => new Error("x"),
    "Date": () => new Date(0),
    "RegExp": () => /x/,
    "boxed primitive": () => new Number(1),
    "typed array": () => new Uint8Array(2),
    "DataView": () => new DataView(new ArrayBuffer(2)),
    "ArrayBuffer": () => new ArrayBuffer(2),
    "URL": () => new URL("http://x/"),
    "KeyObject": () => crypto.createSecretKey(Buffer.alloc(16)),
  });

  // A Node.js process that has not yet thrown inside a deep-equality walk compares these by content.
  describe("a reference back into actual against a finite expected", () => {
    const cyclic = make => {
      const value = make();
      value.v = 1;
      value.self = value;
      return value;
    };
    const finite = (make, leaf) => {
      const value = make();
      value.self = make();
      if (leaf !== undefined) value.self.v = leaf;
      return value;
    };

    test.each(arms)("%s: passes when expected matches under the back-reference", (_, make) => {
      assert.partialDeepStrictEqual(cyclic(make), finite(make, 1));
    });

    test.each(arms)("%s: passes when expected has nothing to compare under the back-reference", (_, make) => {
      assert.partialDeepStrictEqual(cyclic(make), finite(make));
    });

    test.each(arms)("%s: throws when expected differs under the back-reference", (_, make) => {
      expect(() => assert.partialDeepStrictEqual(cyclic(make), finite(make, 2))).toThrow(assert.AssertionError);
    });

    test.each(arms)("%s: a cycle only in expected throws", (_, make) => {
      const actual = finite(make);
      actual.self.self = make();
      const expected = make();
      expected.self = expected;
      expect(() => assert.partialDeepStrictEqual(actual, expected)).toThrow(assert.AssertionError);
    });

    test.each(arms)("%s: two values that cycle together pass", (_, make) => {
      assert.partialDeepStrictEqual(cyclic(make), cyclic(make));
    });

    test.each([
      [
        "an array element",
        () => {
          const actual = [1];
          actual.push(actual);
          return [actual, [[1]]];
        },
      ],
      [
        "a Map value",
        () => {
          const actual = new Map([["k", 1]]);
          actual.set("self", actual);
          return [actual, new Map([["self", new Map([["k", 1]])]])];
        },
      ],
      [
        "a Map key",
        () => {
          const actual = new Map();
          actual.set(actual, 1);
          return [actual, new Map([[new Map(), 1]])];
        },
      ],
      [
        "a Set member",
        () => {
          const actual = new Set([1]);
          actual.add(actual);
          return [actual, new Set([new Set([1])])];
        },
      ],
      [
        "an Error cause",
        () => {
          const actual = new Error("x");
          actual.cause = actual;
          return [actual, new Error("x", { cause: new Error("x") })];
        },
      ],
    ])("passes when the back-reference is %s", (_, make) => {
      const [actual, expected] = make();
      assert.partialDeepStrictEqual(actual, expected);
    });

    test("a tree whose children point at their parent matches a finite pattern", () => {
      const parent = { name: "p", children: [] };
      parent.children.push({ name: "c", parent });
      assert.partialDeepStrictEqual(parent, { children: [{ name: "c", parent: { name: "p" } }] });
      expect(() => assert.partialDeepStrictEqual(parent, { children: [{ name: "c", parent: { name: "q" } }] })).toThrow(
        assert.AssertionError,
      );
    });

    test("expected is followed to its end, however many times actual comes round", () => {
      const actual = { a: 1 };
      actual.self = actual;
      const nested = leaf => {
        let expected = leaf;
        for (let i = 0; i < 100; i++) expected = { self: expected };
        return expected;
      };
      assert.partialDeepStrictEqual(actual, nested({ a: 1 }));
      expect(() => assert.partialDeepStrictEqual(actual, nested({ a: 2 }))).toThrow(assert.AssertionError);
    });

    test("a getter under the back-reference is read once", () => {
      let reads = 0;
      const make = value => {
        const actual = {
          get a() {
            reads++;
            return value;
          },
        };
        actual.self = actual;
        return actual;
      };
      assert.partialDeepStrictEqual(make(1), { self: { a: 1 } });
      expect(reads).toBe(1);
      expect(() => assert.partialDeepStrictEqual(make(2), { self: { a: 1 } })).toThrow(assert.AssertionError);
    });

    // Node.js 24 and later gives this shape a different verdict once any deep-equality walk in the thread has thrown
    // (lib/internal/util/comparisons.js, detectCycles). Bun keeps no state between calls.
    test("the verdict does not depend on earlier comparisons", () => {
      const compare = () => {
        const actual = { a: 1 };
        actual.self = actual;
        assert.partialDeepStrictEqual(actual, { self: { a: 1 } });
      };
      compare();
      const a = {};
      a.a = a;
      const b = {};
      b.a = b;
      assert.deepStrictEqual(a, b);
      compare();
    });
  });

  // A new Node.js process also passes this, and reads the getter once. Node.js 24 and 26 throw ERR_ASSERTION on it
  // once a deep-equality walk has thrown in the thread.
  test("a call that passes without a back-reference does not look under it", () => {
    let reads = 0;
    const actual = {
      get probe() {
        reads++;
        return 1;
      },
    };
    actual.items = [actual, { probe: 1 }];
    assert.partialDeepStrictEqual(actual, { items: [{ probe: 1 }] });
    expect(reads).toBe(0);
  });

  // Node.js 24 and 26 throw ERR_ASSERTION on every row here, before and after a walk has thrown in the thread.
  describe("a reference back into actual where the contents do not decide", () => {
    const loop = make => {
      const value = make();
      value.loop = value;
      return value;
    };
    // Thrown as it is when the values are not equal, so that no message is rendered from them.
    const notEqual = new Error("not equal");
    const thrownBy = (actual, expected) => {
      try {
        assert.partialDeepStrictEqual(actual, expected, notEqual);
      } catch (error) {
        return error;
      }
    };

    // `self` is a back-reference in actual only. `loop` holds a value that refers to itself on both sides.
    test.each(arms)("%s: throws when expected comes round elsewhere in the call", (_, make) => {
      const actual = make();
      actual.v = 1;
      actual.self = actual;
      actual.loop = loop(make);
      const expected = make();
      expected.self = make();
      expected.self.v = 1;
      expected.loop = loop(make);
      expect(thrownBy(actual, expected)).toBe(notEqual);
    });

    test("contents under a back-reference throw once a pair has come round", () => {
      const list = [1];
      list.push(list);
      const set = new Set([1]);
      set.add(set);
      const map = new Map([["k", 1]]);
      map.set("self", map);
      const actual = { loop: loop(() => ({})), list, set, map };
      const patterns = [
        { list: [[1]] },
        { set: new Set([new Set([1])]) },
        { map: new Map([["self", new Map([["k", 1]])]]) },
      ];
      for (const pattern of patterns) expect(thrownBy(actual, { loop: loop(() => ({})), ...pattern })).toBe(notEqual);
    });

    test("a pair that comes round settles the call even when a later candidate matches", () => {
      const pattern = loop(() => ({}));
      const actual = { v: 1, list: [loop(() => ({})), pattern] };
      actual.self = actual;
      expect(thrownBy(actual, { self: { v: 1 }, list: [pattern] })).toBe(notEqual);
    });

    test("cycles of different lengths throw and end without a stack overflow", () => {
      const ring = length => {
        const nodes = Array.from({ length }, () => ({}));
        nodes.forEach((node, i) => (node.next = nodes[(i + 1) % length]));
        return nodes[0];
      };
      expect(thrownBy(ring(1), ring(2))).toBe(notEqual);
      expect(thrownBy(ring(2), ring(1))).toBe(notEqual);
      expect(thrownBy(ring(80), ring(81))).toBe(notEqual);
      expect(thrownBy(ring(81), ring(80))).toBe(notEqual);
    });

    test.each([
      [
        "a getter of actual under the back-reference",
        () => {
          const actual = {
            get boom() {
              throw new Error("boom");
            },
          };
          actual.self = actual;
          return [actual, { self: { boom: 1 } }];
        },
      ],
      [
        "a getter of actual after the back-reference",
        () => {
          const actual = { a: 1 };
          actual.self = actual;
          Object.defineProperty(actual, "boom", {
            enumerable: true,
            get() {
              throw new Error("boom");
            },
          });
          return [actual, { self: { a: 1 }, boom: 1 }];
        },
      ],
      [
        "a getter of expected under the back-reference",
        () => {
          const actual = { a: 1 };
          actual.self = actual;
          const under = {
            get a() {
              throw new Error("boom");
            },
          };
          return [actual, { self: under }];
        },
      ],
    ])("an error thrown by %s does not replace the verdict", (_, make) => {
      const [actual, expected] = make();
      expect(thrownBy(actual, expected)).toBe(notEqual);
    });

    test("an expected nested deeper than the native stack does not replace the verdict", () => {
      const actual = {};
      actual.self = actual;
      let expected = {};
      for (let i = 0; i < 100_000; i++) expected = { self: expected };
      expect(thrownBy(actual, expected)).toBe(notEqual);
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
