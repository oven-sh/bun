const assert = require("assert");
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

  // node:assert prints its values with the inspect hooks off, and node's util.inspect then
  // prints a URL as its href. The messages are node v26.3.0's.
  describe("URL", () => {
    const a = new URL("http://example.com/a");
    const b = new URL("http://example.com/b");

    test.each([
      ["strictEqual", 'Expected "actual" to be reference-equal to "expected":'],
      ["deepStrictEqual", "Expected values to be strictly deep-equal:"],
      ["partialDeepStrictEqual", "Expected values to be partially and strictly deep-equal:"],
    ])("%s shows the two hrefs as a diff", (method, header) => {
      expect(messageOf(() => assert[method](a, b))).toBe(
        `${header}\n+ actual - expected\n\n+ http://example.com/a\n- http://example.com/b\n`,
      );
    });

    test("a nested URL shows its href in the diff", () => {
      expect(messageOf(() => assert.deepStrictEqual({ url: a }, { url: b }))).toBe(
        "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   url: http://example.com/a\n-   url: http://example.com/b\n  }\n",
      );
      const thrown = () => {
        throw Object.assign(new Error("failed"), { url: a });
      };
      expect(messageOf(() => assert.throws(thrown, { url: b }))).toBe(
        "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  Comparison {\n+   url: http://example.com/a\n-   url: http://example.com/b\n  }\n",
      );
    });

    test("the messages without a diff name the hrefs", () => {
      expect(messageOf(() => assert.equal(a, b))).toBe("http://example.com/a == http://example.com/b");
      expect(messageOf(() => assert.deepEqual(a, b))).toBe(
        "Expected values to be loosely deep-equal:\n\nhttp://example.com/a\n\nshould loosely deep-equal\n\nhttp://example.com/b",
      );
      expect(messageOf(() => assert.notStrictEqual(a, a))).toBe(
        'Expected "actual" not to be reference-equal to "expected":\n\nhttp://example.com/a',
      );
      expect(messageOf(() => assert.notDeepStrictEqual(a, a))).toBe(
        'Expected "actual" not to be strictly deep-equal to:\n\nhttp://example.com/a',
      );
    });

    test("two values that print the same text keep the same-structure message", () => {
      class MyURL extends URL {}
      const sameStructure = text => `Values have same structure but are not reference-equal:\n\n${text}\n`;
      expect(messageOf(() => assert.strictEqual(a, new URL(a.href)))).toBe(sameStructure("http://example.com/a"));
      expect(messageOf(() => assert.strictEqual(a, new MyURL(a.href)))).toBe(sameStructure("http://example.com/a"));
      expect(messageOf(() => assert.deepStrictEqual(a, new MyURL(a.href)))).toBe(sameStructure("http://example.com/a"));
      expect(messageOf(() => assert.strictEqual([], []))).toBe(sameStructure("[]"));
    });

    // node's util.inspect reads `href` of every class instance it prints, and rethrows what the getter throws.
    test("a href getter that throws gives its own error, not an AssertionError", () => {
      const error = new Error("href getter");
      class Broken {
        get href() {
          throw error;
        }
      }
      let thrown;
      try {
        assert.deepStrictEqual({ a: new Broken() }, { a: 1 });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(error);
    });

    // util.inspect loads on the first use. The child replaces the global before that, as a preload or
    // happy-dom's registrator does (its URL is a subclass of the native one).
    test("a globalThis.URL replaced before node:assert loads does not change the message", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const NativeURL = globalThis.URL;
           globalThis.URL = class URL extends NativeURL {};
           const assert = require("node:assert");
           const util = require("node:util");
           const messageOf = fn => { try { fn(); } catch (e) { return e.name + ": " + e.message; } };
           const a = new NativeURL("http://example.com/a");
           const b = new NativeURL("http://example.com/b");
           class Link { get href() { return "http://example.com/a"; } }
           const rows = [messageOf(() => assert.strictEqual(a, b)), util.inspect(a, { customInspect: false })];
           delete globalThis.URL;
           rows.push(messageOf(() => assert.strictEqual(new Link(), new Link())));
           console.log(JSON.stringify(rows));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
        stdout: [
          'AssertionError: Expected "actual" to be reference-equal to "expected":\n+ actual - expected\n\n+ http://example.com/a\n- http://example.com/b\n',
          "http://example.com/a",
          "AssertionError: Values have same structure but are not reference-equal:\n\nLink {}\n",
        ],
        stderr: "",
        exitCode: 0,
      });
    });
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
