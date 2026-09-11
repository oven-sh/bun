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

  // Node reads `cause` like message/name/errors (an undefined expected value is not compared)
  // and additionally requires an own `cause` on expected to exist on actual.
  // Expectations below were checked against Node v26.
  describe("error cause", () => {
    class InheritedCauseError extends Error {
      get cause() {
        return 1;
      }
    }

    const rejected = [
      [
        "no actual cause vs own undefined expected cause",
        () => new Error("x"),
        () => new Error("x", { cause: undefined }),
      ],
      [
        "own undefined actual cause vs defined expected cause",
        () => new Error("x", { cause: undefined }),
        () => new Error("x", { cause: 1 }),
      ],
      ["different causes", () => new Error("x", { cause: 1 }), () => new Error("x", { cause: 2 })],
      [
        "actual cause differs from an inherited expected cause",
        () => new Error("x", { cause: 2 }),
        () => new InheritedCauseError("x"),
      ],
      ["no actual cause vs an inherited expected cause", () => new Error("x"), () => new InheritedCauseError("x")],
      [
        "inherited actual cause vs an own expected cause with the same value",
        () => new InheritedCauseError("x"),
        () => new Error("x", { cause: 1 }),
      ],
    ];

    const accepted = [
      [
        "defined actual cause vs own undefined expected cause",
        () => new Error("x", { cause: 1 }),
        () => new Error("x", { cause: undefined }),
      ],
      ["same causes", () => new Error("x", { cause: 1 }), () => new Error("x", { cause: 1 })],
      [
        "expected cause is a subset of the actual cause",
        () => new Error("x", { cause: { a: 1, b: 2 } }),
        () => new Error("x", { cause: { a: 1 } }),
      ],
      ["actual cause vs no expected cause", () => new Error("x", { cause: 1 }), () => new Error("x")],
      [
        "own actual cause vs an inherited expected cause with the same value",
        () => new Error("x", { cause: 1 }),
        () => new InheritedCauseError("x"),
      ],
    ];

    test.each(rejected)("rejects %s", (_name, actual, expected) => {
      expect(() => assert.partialDeepStrictEqual(actual(), expected())).toThrow(assert.AssertionError);
    });

    test.each(accepted)("accepts %s", (_name, actual, expected) => {
      assert.partialDeepStrictEqual(actual(), expected());
    });
  });

  // DOMException is `instanceof Error` but has no own enumerable properties (name and message
  // are prototype accessors), so node compares it like an Error: name, message and cause.
  // Expectations below were checked against Node v26.
  describe("DOMException", () => {
    class SubException extends DOMException {}
    const abortMessage = AbortSignal.abort().reason.message;

    const rejected = [
      [
        "different name and message",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("other", "NotFoundError"),
      ],
      [
        "same name, different message",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("other", "AbortError"),
      ],
      [
        "same message, different name",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("boom", "NotFoundError"),
      ],
      ["default name vs explicit name", () => new DOMException("boom", "AbortError"), () => new DOMException("boom")],
      [
        "empty actual message vs non-empty expected message",
        () => new DOMException("", "AbortError"),
        () => new DOMException("boom", "AbortError"),
      ],
      [
        "different cause",
        () => new DOMException("boom", { name: "AbortError", cause: 1 }),
        () => new DOMException("boom", { name: "AbortError", cause: 2 }),
      ],
      [
        "expected cause has a property the actual cause lacks",
        () => new DOMException("boom", { name: "AbortError", cause: { x: 1 } }),
        () => new DOMException("boom", { name: "AbortError", cause: { x: 1, y: 2 } }),
      ],
      [
        "own cause on expected only",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("boom", { name: "AbortError", cause: 1 }),
      ],
      [
        "own undefined cause on expected only",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("boom", { name: "AbortError", cause: undefined }),
      ],
      [
        "own enumerable property on expected only",
        () => new DOMException("boom", "AbortError"),
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 1 }),
      ],
      [
        "subclass instances with different messages",
        () => new SubException("boom", "SyntaxError"),
        () => new SubException("other", "SyntaxError"),
      ],
      [
        "AbortSignal reason vs a different DOMException",
        () => AbortSignal.abort().reason,
        () => new DOMException("boom", "TimeoutError"),
      ],
      [
        "AbortSignal reason vs the same message under a different name",
        () => AbortSignal.abort().reason,
        () => new DOMException(abortMessage, "TimeoutError"),
      ],
      ["DOMException vs a plain object", () => new DOMException("boom", "AbortError"), () => ({})],
      ["plain object vs DOMException", () => ({}), () => new DOMException("boom", "AbortError")],
      [
        "DOMException vs an object with the same name and message",
        () => new DOMException("boom", "AbortError"),
        () => ({ name: "AbortError", message: "boom" }),
      ],
      [
        "DOMException vs an Error with the same name and message",
        () => new DOMException("boom"),
        () => new Error("boom"),
      ],
      [
        "Error vs a DOMException with the same name and message",
        () => new Error("boom"),
        () => new DOMException("boom"),
      ],
      [
        "nested in an object",
        () => ({ error: new DOMException("boom", "AbortError") }),
        () => ({ error: new DOMException("other", "NotFoundError") }),
      ],
      [
        "no array element matches",
        () => [new DOMException("a", "AbortError"), new DOMException("b", "TimeoutError")],
        () => [new DOMException("c", "TimeoutError")],
      ],
    ];

    const accepted = [
      [
        "same name and message",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("boom", "AbortError"),
      ],
      ["both default name", () => new DOMException("boom"), () => new DOMException("boom")],
      [
        "empty expected message",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("", "AbortError"),
      ],
      [
        "same cause",
        () => new DOMException("boom", { name: "AbortError", cause: 1 }),
        () => new DOMException("boom", { name: "AbortError", cause: 1 }),
      ],
      [
        "expected cause is a subset of the actual cause",
        () => new DOMException("boom", { name: "AbortError", cause: { x: 1, y: 2 } }),
        () => new DOMException("boom", { name: "AbortError", cause: { x: 1 } }),
      ],
      [
        "own cause on actual only",
        () => new DOMException("boom", { name: "AbortError", cause: 1 }),
        () => new DOMException("boom", "AbortError"),
      ],
      [
        "own undefined cause on both",
        () => new DOMException("boom", { name: "AbortError", cause: undefined }),
        () => new DOMException("boom", { name: "AbortError", cause: undefined }),
      ],
      [
        "defined cause on actual, own undefined cause on expected",
        () => new DOMException("boom", { name: "AbortError", cause: 1 }),
        () => new DOMException("boom", { name: "AbortError", cause: undefined }),
      ],
      [
        "own enumerable property on actual only",
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 1 }),
        () => new DOMException("boom", "AbortError"),
      ],
      [
        "same own enumerable property on both",
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 1 }),
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 1 }),
      ],
      [
        "subclass instances with the same name and message",
        () => new SubException("boom", "SyntaxError"),
        () => new SubException("boom", "SyntaxError"),
      ],
      [
        "subclass instance vs base instance",
        () => new SubException("boom", "SyntaxError"),
        () => new DOMException("boom", "SyntaxError"),
      ],
      [
        "AbortSignal reason vs an equal DOMException",
        () => AbortSignal.abort().reason,
        () => new DOMException(abortMessage, "AbortError"),
      ],
      [
        "nested in an object",
        () => ({ error: new DOMException("boom", "AbortError"), z: 1 }),
        () => ({ error: new DOMException("boom", "AbortError") }),
      ],
      [
        "a later array element matches",
        () => [new DOMException("a", "AbortError"), new DOMException("b", "TimeoutError")],
        () => [new DOMException("b", "TimeoutError")],
      ],
      [
        "self-referencing causes on both sides",
        () => {
          const cause = {};
          cause.self = cause;
          return new DOMException("boom", { name: "AbortError", cause });
        },
        () => {
          const cause = {};
          cause.self = cause;
          return new DOMException("boom", { name: "AbortError", cause });
        },
      ],
    ];

    test.each(rejected)("rejects %s", (_name, actual, expected) => {
      expect(() => assert.partialDeepStrictEqual(actual(), expected())).toThrow(assert.AssertionError);
    });

    test.each(accepted)("accepts %s", (_name, actual, expected) => {
      assert.partialDeepStrictEqual(actual(), expected());
    });

    test("the same instance on both sides is accepted", () => {
      const error = new DOMException("boom", "AbortError");
      assert.partialDeepStrictEqual(error, error);
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
