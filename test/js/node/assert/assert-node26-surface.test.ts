import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import strictAssert from "node:assert/strict";

// Node 26 introduced the Assert class, lazy-function `message` arguments,
// type validation of `message`, the AssertionError `diff` field, and removed
// the deprecated CallTracker.

const capture = (fn: () => void) => {
  try {
    fn();
  } catch (e: any) {
    return e;
  }
  throw new Error("expected function to throw");
};

describe("assert message argument", () => {
  test("function message is called lazily on failure and its string result is used", () => {
    const e = capture(() => assert.strictEqual(1, 2, () => "lazy-computed-message"));
    expect({ code: e.code, message: e.message.split("\n")[0], generatedMessage: e.generatedMessage }).toEqual({
      code: "ERR_ASSERTION",
      message: "lazy-computed-message",
      generatedMessage: false,
    });
  });

  test("function message receives (actual, expected)", () => {
    const e = capture(() => assert.strictEqual(1, 2, (a, b) => `a=${a} e=${b}`));
    expect(e.message.split("\n")[0]).toBe("a=1 e=2");
  });

  test("function message is not called when the assertion passes", () => {
    let called = false;
    assert.strictEqual(1, 1, () => {
      called = true;
      return "should not see";
    });
    expect(called).toBe(false);
  });

  test("function message returning a non-string falls back to the generated message", () => {
    for (const ret of [42, undefined, null, new TypeError("boom"), { a: 1 }]) {
      const e = capture(() => assert.strictEqual(1, 2, () => ret));
      expect(e.code).toBe("ERR_ASSERTION");
      expect(e.message).toContain("Expected values to be strictly equal");
    }
  });

  test("function message that throws falls back to the generated message", () => {
    const e = capture(() =>
      assert.strictEqual(1, 2, () => {
        throw new Error("boom");
      }),
    );
    expect(e.code).toBe("ERR_ASSERTION");
    expect(e.message).toContain("Expected values to be strictly equal");
  });

  test("Error message is thrown directly", () => {
    const err = new TypeError("boom");
    const e = capture(() => assert.strictEqual(1, 2, err));
    expect(e).toBe(err);
  });

  test("explicit non-string/function/Error message is rejected with ERR_INVALID_ARG_TYPE", () => {
    for (const bad of [42, undefined, null, true, Symbol("x"), {}]) {
      const e = capture(() => assert.strictEqual(1, 2, bad as never));
      expect({ code: e.code, name: e.name }).toEqual({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" });
      expect(e.message).toContain('"message" argument');
    }
  });

  test("omitting message generates one instead of rejecting", () => {
    const e = capture(() => assert.strictEqual(1, 2));
    expect({ code: e.code, generatedMessage: e.generatedMessage }).toEqual({
      code: "ERR_ASSERTION",
      generatedMessage: true,
    });
  });

  test("string message with trailing args is formatted printf-style", () => {
    const e = capture(() => (assert.strictEqual as any)(1, 2, "hello %s %d", "world", 42));
    expect(e.message.split("\n")[0]).toBe("hello world 42");
  });

  test("Error message with trailing args throws ERR_AMBIGUOUS_ARGUMENT", () => {
    const e = capture(() => (assert.strictEqual as any)(1, 2, new Error("e"), "extra"));
    expect(e.code).toBe("ERR_AMBIGUOUS_ARGUMENT");
  });

  test("function message with trailing args throws ERR_AMBIGUOUS_ARGUMENT", () => {
    const e = capture(() => (assert.strictEqual as any)(1, 2, () => "x", "extra"));
    expect(e.code).toBe("ERR_AMBIGUOUS_ARGUMENT");
  });

  describe("applies to the other comparison methods", () => {
    const cases: [string, unknown, unknown][] = [
      ["equal", 1, 2],
      ["notEqual", 1, 1],
      ["deepEqual", { a: 1 }, { a: 2 }],
      ["notDeepEqual", { a: 1 }, { a: 1 }],
      ["deepStrictEqual", { a: 1 }, { a: 2 }],
      ["notDeepStrictEqual", { a: 1 }, { a: 1 }],
      ["notStrictEqual", 1, 1],
      ["partialDeepStrictEqual", { a: 1 }, { a: 2 }],
      ["match", "a", /b/],
      ["doesNotMatch", "a", /a/],
    ];
    test.each(cases)("%s supports function message", (name, a, b) => {
      const e = capture(() => (assert as any)[name](a, b, () => "m"));
      expect({ code: e.code, message: e.message.split("\n")[0] }).toEqual({ code: "ERR_ASSERTION", message: "m" });
    });
    test.each(cases)("%s rejects number message", (name, a, b) => {
      const e = capture(() => (assert as any)[name](a, b, 42));
      expect(e.code).toBe("ERR_INVALID_ARG_TYPE");
    });
  });

  describe("ok / assert()", () => {
    test("supports function message", () => {
      expect(capture(() => assert.ok(false, () => "lazy ok")).message).toBe("lazy ok");
      expect(capture(() => assert(false, () => "lazy assert")).message).toBe("lazy assert");
    });
    test("rejects number message", () => {
      expect(capture(() => assert.ok(false, 42 as never)).code).toBe("ERR_INVALID_ARG_TYPE");
      expect(capture(() => assert(false, 42 as never)).code).toBe("ERR_INVALID_ARG_TYPE");
    });
    test("treats explicit undefined/null message as omitted (unlike comparison methods)", () => {
      expect(capture(() => assert.ok(false, undefined)).code).toBe("ERR_ASSERTION");
      expect(capture(() => assert.ok(false, null as never)).code).toBe("ERR_ASSERTION");
    });
    test("supports printf-style format args", () => {
      expect(capture(() => (assert.ok as any)(false, "hello %s %d", "world", 42)).message).toBe("hello world 42");
    });
  });

  test("fail() does not validate or evaluate message (matches Node)", () => {
    const fn = () => "lazy fail";
    const e1 = capture(() => assert.fail(fn as never));
    expect(e1.code).toBe("ERR_ASSERTION");
    expect(e1.message).toContain("lazy fail");
    const e2 = capture(() => assert.fail(42 as never));
    expect({ code: e2.code, message: e2.message }).toEqual({ code: "ERR_ASSERTION", message: "42" });
  });
});

describe("assert.Assert class", () => {
  test("exists on both default and strict exports and is the same constructor", () => {
    expect(typeof assert.Assert).toBe("function");
    expect(strictAssert.Assert).toBe(assert.Assert);
    expect(assert.Assert.name).toBe("Assert");
    expect(assert.Assert.length).toBe(1);
  });

  test("throws ERR_CONSTRUCT_CALL_REQUIRED without new", () => {
    const e = capture(() => (assert.Assert as any)());
    expect(e.code).toBe("ERR_CONSTRUCT_CALL_REQUIRED");
  });

  test("prototype.constructor is non-enumerable like a normal function prototype", () => {
    const d = Object.getOwnPropertyDescriptor(assert.Assert.prototype, "constructor");
    expect(d).toEqual({ value: assert.Assert, writable: true, enumerable: false, configurable: true });
  });

  test("prototype carries all assertion methods, shared with module exports", () => {
    const protoKeys = Object.getOwnPropertyNames(assert.Assert.prototype).sort();
    expect(protoKeys).toEqual(
      [
        "constructor",
        "deepEqual",
        "deepStrictEqual",
        "doesNotMatch",
        "doesNotReject",
        "doesNotThrow",
        "equal",
        "fail",
        "ifError",
        "match",
        "notDeepEqual",
        "notDeepStrictEqual",
        "notEqual",
        "notStrictEqual",
        "ok",
        "partialDeepStrictEqual",
        "rejects",
        "strictEqual",
        "throws",
      ].sort(),
    );
    expect(assert.strictEqual).toBe(assert.Assert.prototype.strictEqual);
    expect(assert.deepStrictEqual).toBe(assert.Assert.prototype.deepStrictEqual);
  });

  test("instance own keys and strict aliasing", () => {
    const a = new assert.Assert();
    expect(Object.getOwnPropertyNames(a).sort()).toEqual(
      ["AssertionError", "deepEqual", "equal", "notDeepEqual", "notEqual"].sort(),
    );
    expect(a.equal).toBe(assert.strictEqual);
    expect(a.deepEqual).toBe(assert.deepStrictEqual);
    expect(a.AssertionError).toBe(assert.AssertionError);

    const loose = new assert.Assert({ strict: false });
    expect(Object.getOwnPropertyNames(loose).sort()).toEqual(["AssertionError"]);
  });

  test("validates options.diff", () => {
    const e = capture(() => new assert.Assert({ diff: "bad" as never }));
    expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
    // Numeric options objects are not rejected by Node; just check it doesn't throw.
    expect(() => new assert.Assert(42 as never)).not.toThrow();
  });

  test("diff option propagates to thrown AssertionError", () => {
    const full = new assert.Assert({ diff: "full" });
    const e = capture(() => full.deepStrictEqual({ a: 1 }, { a: 2 }));
    expect(e.diff).toBe("full");

    const simple = new assert.Assert({ diff: "simple" });
    expect(capture(() => simple.strictEqual(1, 2)).diff).toBe("simple");

    const dflt = new assert.Assert();
    expect(capture(() => dflt.strictEqual(1, 2)).diff).toBe("simple");
  });

  test("destructured methods fall back to default diff", () => {
    const full = new assert.Assert({ diff: "full" });
    const { strictEqual } = full;
    expect(capture(() => strictEqual(1, 2)).diff).toBe("simple");
  });
});

describe("AssertionError.diff field", () => {
  test("is set on errors thrown by module-level functions", () => {
    const e = capture(() => assert.deepStrictEqual({ a: 1 }, { a: 2 }));
    expect(e.diff).toBe("simple");
  });

  test("is a configurable own property and defaults to 'simple' when constructed directly", () => {
    const e = new assert.AssertionError({ message: "x", actual: 1, expected: 2, operator: "strictEqual" });
    expect(e.diff).toBe("simple");
    const e2 = new assert.AssertionError({
      message: "x",
      actual: 1,
      expected: 2,
      operator: "strictEqual",
      diff: "full",
    });
    expect(e2.diff).toBe("full");
    const own = Object.getOwnPropertyNames(e);
    expect(own).toContain("diff");
  });
});

test("assert.CallTracker is removed", () => {
  expect(typeof (assert as any).CallTracker).toBe("undefined");
  expect(Object.getOwnPropertyNames(assert)).not.toContain("CallTracker");
  expect(typeof (strictAssert as any).CallTracker).toBe("undefined");
});

test("assert.fail uses only the first argument (DEP0094 removed)", () => {
  const e = capture(() => (assert.fail as any)("boom", "ignored"));
  expect({ message: e.message, operator: e.operator, actual: e.actual, expected: e.expected }).toEqual({
    message: "boom",
    operator: "fail",
    actual: undefined,
    expected: undefined,
  });
});
