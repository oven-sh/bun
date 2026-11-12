const assert = require("assert");
const { bunEnv, bunExe } = require("harness");
const cycles = require("./partial-deep-equal-cycles-fixture.cjs");

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

  test("a value that differs still fails when only one side is circular", () => {
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

  // An answer below is that of a new Node.js process, but where a test says that Bun gives another one. The fixture
  // says how to check that with Node.js.
  describe("cycles", () => {
    const { answerOf, partOfTree, ring, tree } = cycles;
    const fails = fn => expect(fn).toThrow(assert.AssertionError);

    test("a parent link in actual does not fail a part that matches", () => {
      assert.partialDeepStrictEqual(tree(), partOfTree("Program"));
      fails(() => assert.partialDeepStrictEqual(tree(), partOfTree("Script")));
    });

    test("an actual that holds itself matches a finite expected of any depth", () => {
      const self = {};
      self.a = self;
      assert.partialDeepStrictEqual(self, { a: {} });
      assert.partialDeepStrictEqual(self, { a: { a: { a: {} } } });
      fails(() => assert.partialDeepStrictEqual(self, { a: { a: { b: 1 } } }));

      const list = [1];
      list.push(list);
      assert.partialDeepStrictEqual(list, [1, [1]]);
    });

    test("the way back goes through a Map value, a Set member, a class field or an Error cause", () => {
      const viaMap = { kind: "root", kids: new Map() };
      viaMap.kids.set("k", { kind: "kid", up: viaMap });
      assert.partialDeepStrictEqual(viaMap, { kids: new Map([["k", { kind: "kid", up: { kind: "root" } }]]) });

      const viaSet = { kind: "root", kids: new Set() };
      viaSet.kids.add({ kind: "kid", up: viaSet });
      assert.partialDeepStrictEqual(viaSet, { kids: new Set([{ kind: "kid", up: { kind: "root" } }]) });

      class Node {
        kids = [];
        constructor(type, parent) {
          this.type = type;
          this.parent = parent;
          parent?.kids.push(this);
        }
      }
      const root = new Node("root");
      new Node("kid", root);
      assert.partialDeepStrictEqual(root, { kids: [{ type: "kid", parent: { type: "root" } }] });

      const holder = { name: "holder" };
      holder.error = new Error("boom", { cause: holder });
      assert.partialDeepStrictEqual(holder, { error: new Error("boom", { cause: { name: "holder" } }) });
    });

    test("an expected that comes back to itself under an actual that ends in it", () => {
      const expected = { v: 1 };
      expected.self = expected;
      assert.partialDeepStrictEqual({ v: 1, self: { v: 1, self: expected } }, expected);
    });

    test("objects met again at other depths are compared while no pair repeats", () => {
      const tail = { v: 2 };
      tail.next = tail;
      const expected = { v: 1 };
      expected.next = { v: 2, next: expected };
      // `actual.next.next.v` is 2 and `expected.next.next.v` is 1.
      fails(() => assert.partialDeepStrictEqual({ v: 1, next: tail }, expected));
    });

    test("the answer does not depend on what was compared before", () => {
      // Node.js looks for cycles in every later comparison of the process once one has thrown.
      assert.partialDeepStrictEqual(ring(2), ring(2));
      expect(() =>
        assert.partialDeepStrictEqual(
          {
            get v() {
              throw new Error("from a getter");
            },
          },
          { v: 1 },
        ),
      ).toThrow("from a getter");
      assert.partialDeepStrictEqual(tree(), partOfTree("Program"));
    });

    // From here on a pair of objects is inside its own comparison. Node.js runs out of stack there and compares
    // again with its memos.
    test("rings of one length pass and rings of different lengths fail", () => {
      assert.partialDeepStrictEqual(ring(2), ring(2));
      fails(() => assert.partialDeepStrictEqual(ring(2), ring(2, 2)));
      fails(() => assert.partialDeepStrictEqual(ring(1), ring(2)));
      fails(() => assert.partialDeepStrictEqual(ring(3), ring(1)));
      fails(() => assert.partialDeepStrictEqual(ring(2), ring(3)));
    });

    test("the memos then decide for every other part of the same comparison", () => {
      fails(() =>
        assert.partialDeepStrictEqual({ loop: ring(1), ast: tree() }, { loop: ring(1), ast: partOfTree("Program") }),
      );

      // An expected with no key passes before the memos are asked.
      const actual = {};
      actual.a = actual.b = actual.c = actual;
      const expected = { a: {} };
      expected.b = expected;
      assert.partialDeepStrictEqual(actual, expected);
    });

    test("under the memos every kind of value is still compared", () => {
      const beside = (actual, expected) => [
        { loop: ring(1), value: actual },
        { loop: ring(1), value: expected },
      ];
      fails(() => assert.partialDeepStrictEqual(...beside(new Error("a"), new Error("b"))));
      assert.partialDeepStrictEqual(...beside(new Error("a"), new Error("a")));
      fails(() => assert.partialDeepStrictEqual(...beside(new Date(1), new Date(2))));
      assert.partialDeepStrictEqual(...beside(new Date(1), new Date(1)));
      fails(() => assert.partialDeepStrictEqual(...beside(new Uint8Array([1, 2]), new Uint8Array([3]))));
      assert.partialDeepStrictEqual(...beside([1, [2, 3]], [[3]]));
      fails(() => assert.partialDeepStrictEqual(...beside([1], [1, 1])));
      assert.partialDeepStrictEqual(...beside(new Map([[{ k: 1 }, { v: 1, w: 2 }]]), new Map([[{ k: 1 }, { v: 1 }]])));
      fails(() => assert.partialDeepStrictEqual(...beside(new Set([{ v: 1 }]), new Set([{ v: 2 }]))));
      assert.partialDeepStrictEqual(...beside(new Set([{ v: 1 }]), new Set()));
    });

    test("the named keys of an array are compared before its elements", () => {
      // The named key of the first candidate differs, so its elements, which come back to it, are not compared.
      // The second candidate ends at the expected array itself.
      const expectedList = [];
      expectedList.push(expectedList);
      expectedList.p = 2;
      const first = [];
      first.push(first);
      first.p = 1;
      const second = [expectedList];
      second.p = 2;
      assert.partialDeepStrictEqual(
        { lists: [first, second], ast: tree() },
        { lists: [expectedList], ast: partOfTree("Program") },
      );

      // The key `p` is not on `actual`, and the elements before it come back to the pair.
      const actual = [];
      const holder = { a: actual };
      actual.push(actual, holder, holder);
      const expected = [];
      const inner = [expected, expected];
      inner.p = 1;
      expected.push({ a: inner });
      fails(() => assert.partialDeepStrictEqual(actual, expected));
    });

    test("operand code runs once, and once more when a pair is inside its own comparison", () => {
      const counted = (reads, value) => ({
        get v() {
          reads.count++;
          return value;
        },
      });
      const plain = { count: 0 };
      assert.partialDeepStrictEqual({ a: counted(plain, 1) }, { a: { v: 1 } });
      expect(plain.count).toBe(1);

      const beside = { count: 0 };
      assert.partialDeepStrictEqual({ a: counted(beside, 1), loop: ring(1) }, { a: { v: 1 }, loop: ring(1) });
      expect(beside.count).toBe(2);
    });

    test("no other candidate is read once a pair is inside its own comparison", () => {
      const reads = [];
      const later = {
        get v() {
          reads.push("later");
          return 1;
        },
      };
      // The ring is the first candidate of each search. The second run ends the search at it.
      assert.partialDeepStrictEqual([ring(1), later], [ring(1)]);
      assert.partialDeepStrictEqual(new Set([ring(1), later]), new Set([ring(1)]));
      assert.partialDeepStrictEqual(
        new Map([
          [ring(1), 1],
          [later, 1],
        ]),
        new Map([[ring(1), 1]]),
      );
      assert.partialDeepStrictEqual(
        new Map([
          [{ k: 1 }, ring(1)],
          [{ k: 1 }, later],
        ]),
        new Map([[{ k: 1 }, ring(1)]]),
      );
      const key = { v: 1 };
      assert.partialDeepStrictEqual(
        new Map([
          [key, ring(1)],
          [later, 1],
        ]),
        new Map([[key, ring(1)]]),
      );
      // The entry of a key that both Maps hold is found by lookup, behind another candidate.
      assert.partialDeepStrictEqual(
        new Map([
          [later, 1],
          [key, ring(1)],
        ]),
        new Map([[key, ring(1)]]),
      );
      expect(reads).toEqual([]);

      // What follows the search is read, in the second run only.
      assert.partialDeepStrictEqual([ring(1), later, later], [ring(1), { v: 1 }]);
      assert.partialDeepStrictEqual(new Set([ring(1), later, { v: 2 }]), new Set([ring(1), { v: 1 }]));
      assert.partialDeepStrictEqual(
        new Map([
          [{ k: 1 }, ring(1)],
          [{ k: 2 }, later],
          [{ k: 3 }, 1],
        ]),
        new Map([
          [{ k: 1 }, ring(1)],
          [{ k: 2 }, { v: 1 }],
        ]),
      );
      expect(reads).toEqual(["later", "later", "later"]);
    });

    test("the end of the stack is an error only when the second run reaches it too", () => {
      // A new object for each read: no pair of objects comes twice, and the comparison cannot end.
      const fresh = () => ({
        v: 1,
        get next() {
          return fresh();
        },
      });
      expect(answerOf(fresh(), ring(1))).toBe("fail");
      // The same pair comes again after 10,100 levels.
      expect(answerOf(ring(100), ring(101))).toBe("fail");

      let deep = {};
      let deepToo = {};
      const actual = deep;
      const expected = deepToo;
      for (let i = 0; i < 100000; i++) {
        deep = deep.x = {};
        deepToo = deepToo.x = {};
      }
      expect(answerOf(actual, expected)).toBe("RangeError");
    });

    // Node.js has less stack than Bun, so its answers differ from these where its first run does not fit.
    test("a deep comparison with no pair that repeats is never left to the memos", () => {
      // A list with links in both directions, against its part that goes to the last item and one link back. The
      // memos fail that link back, because only `actual` was there before.
      const answers = new Set();
      for (let depth = 64; !answers.has("RangeError"); depth += 32) {
        const items = Array.from({ length: depth }, (_, v) => ({ v }));
        items.forEach((item, i) => {
          if (i > 0) item.previous = items[i - 1];
          if (i < depth - 1) item.next = items[i + 1];
        });
        let expected = { v: depth - 1, previous: { v: depth - 2 } };
        for (let v = depth - 2; v >= 0; v--) expected = { v, next: expected };
        answers.add(answerOf(items[0], expected));
      }
      expect([...answers]).toEqual(["pass", "RangeError"]);
    });

    test("the depth of the caller does not change an answer", () => {
      // With little stack left, the first run has no room. The memos then give other answers for these three.
      const inActual = { p: { q: { p: {} } } };
      const loop = { v: 2 };
      loop.next = loop;
      const expectedRing = { v: 1 };
      expectedRing.next = { v: 2, next: expectedRing };
      const pairs = [
        [tree(), partOfTree("Program")],
        [{ p: { q: inActual } }, inActual],
        [{ v: 1, next: loop }, expectedRing],
      ];
      const answers = pairs.map(() => new Set());
      const down = level => {
        if (level % 32 === 0) pairs.forEach((pair, i) => answers[i].add(answerOf(...pair)));
        down(level + 1);
      };
      expect(() => down(0)).toThrow(RangeError);
      expect(answers.map(answersOfPair => [...answersOfPair].filter(answer => answer !== "RangeError"))).toEqual([
        ["pass"],
        ["pass"],
        ["fail"],
      ]);
    });

    describe("as the first comparison of a new Node.js process", () => {
      for (const { name, node, pair, bun, bug } of cycles.rows) {
        const title = bug ? `${name} (Bun ${bug})` : bun ? `${name} (Node.js: ${node}, Bun: ${bun})` : name;
        (bug ? test.failing : test)(title, () => {
          expect(answerOf(...pair())).toBe(bun ?? node);
        });
      }

      test.each(Object.keys(cycles.generated.node))("%s: generated pairs", kinds => {
        const differences = {};
        for (let seed = 0; seed < cycles.generated.seeds; seed++) {
          const answer = answerOf(...cycles.build(seed, kinds));
          if (answer !== cycles.answerOfNode(kinds, seed)) differences[seed] = answer;
        }
        expect(differences).toEqual(cycles.generated.bun[kinds] ?? {});
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
