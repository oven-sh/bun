import assert, { AssertionError } from "assert";
import { beforeEach, describe, expect, it } from "bun:test";

describe("assert(expr)", () => {
  // https://github.com/oven-sh/bun/issues/941
  it.each([true, 1, "foo"])(`assert(%p) does not throw`, expr => {
    expect(() => assert(expr)).not.toThrow();
  });

  it.each([false, 0, "", null, undefined])(`assert(%p) throws`, expr => {
    expect(() => assert(expr)).toThrow(AssertionError);
  });

  it("behaves like assert.ok (a distinct function since node 25)", () => {
    // node >= 25 builds the namespace from Assert.prototype, so assert !== assert.ok.
    expect(assert as Function).not.toBe(assert.ok);
    expect(() => assert.ok(1)).not.toThrow();
    expect(() => assert.ok(0)).toThrow(AssertionError);
  });
});

describe("assert.equal(actual, expected)", () => {
  it.each([
    ["foo", "foo"],
    [1, 1],
    [1, true],
    [0, ""],
    [0, false],
    [Symbol.for("foo"), Symbol.for("foo")],
  ])(`%p == %p`, (actual, expected) => {
    expect(() => assert.equal(actual, expected)).not.toThrow();
  });
  it.each([
    //
    ["foo", "bar"],
    [1, 0],
    [true, false],
    [{}, {}],
    [Symbol("foo"), Symbol("foo")],
    [new Error("oops"), new Error("oops")],
  ])("%p != %p", (actual, expected) => {
    expect(() => assert.equal(actual, expected)).toThrow(AssertionError);
  });
});

describe("assert.deepEqual(actual, expected)", () => {
  describe("error instances", () => {
    let e1: Error & Record<string, any>, e2: Error & Record<string, any>;

    beforeEach(() => {
      e1 = new Error("oops");
      e2 = new Error("oops");
    });

    it("errors with the same message and constructor are equal", () => {
      expect(() => assert.deepEqual(e1, e2)).not.toThrow();
    });

    it("errors with different messages are not equal", () => {
      e2.message = "nope";
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });

    it("errors with different constructors are not equal", () => {
      e2 = new TypeError("oops");
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });

    it("errors with different names are not equal", () => {
      e2.name = "SpecialError";
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });

    it("errors with different causes are not equal", () => {
      e1.cause = { property: "value" };
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
      e2.cause = { property: "another value" };
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });

    it("errors with the same cause are equal", () => {
      e1.cause = { property: "value" };
      e2.cause = { property: "value" };
      expect(() => assert.deepEqual(e1, e2)).not.toThrow();
    });

    it("adding different arbitrary properties makes errors unequal", () => {
      expect(() => assert.deepEqual(e1, e2)).not.toThrow();
      e1.a = 1;
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
      e2.a = 1;
      expect(() => assert.deepEqual(e1, e2)).not.toThrow();
      e2.a = { foo: "bar" };
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
      e1.a = { foo: "baz" };
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });
  });
});

describe("assert.throws(fn, message)", () => {
  const boom = () => {
    throw new Error("boom");
  };
  const failureOf = (fn: () => void) => {
    try {
      fn();
    } catch (e: any) {
      return { name: e.name, code: e.code, message: e.message };
    }
  };

  // A string in the `error` position is only the failure message. The empty
  // string is a message like any other.
  it.each(["", "failed"])("with the message %p, passes when fn throws", message => {
    expect(() => assert.throws(boom, message)).not.toThrow();
    expect(() => assert.strict.throws(boom, message)).not.toThrow();
  });

  it.each([
    ["", "Missing expected exception."],
    ["failed", "Missing expected exception: failed"],
  ])("with the message %p, fails with an AssertionError when fn does not throw", (message, expected) => {
    expect(failureOf(() => assert.throws(() => {}, message))).toEqual({
      name: "AssertionError",
      code: "ERR_ASSERTION",
      message: expected,
    });
  });

  it("an empty message that is identical to the thrown value is ambiguous", () => {
    expect(
      failureOf(() =>
        assert.throws(() => {
          throw new Error("");
        }, ""),
      ),
    ).toEqual({
      name: "TypeError",
      code: "ERR_AMBIGUOUS_ARGUMENT",
      message: 'The "error/message" argument is ambiguous. The error message "" is identical to the message.',
    });
    expect(
      failureOf(() =>
        assert.throws(() => {
          throw "";
        }, ""),
      ),
    ).toEqual({
      name: "TypeError",
      code: "ERR_AMBIGUOUS_ARGUMENT",
      message: 'The "error/message" argument is ambiguous. The error "" is identical to the message.',
    });
  });
});
