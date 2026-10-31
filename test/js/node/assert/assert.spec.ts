import assert, { AssertionError } from "assert";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { inheritedErrors, thrownBy } from "../inherited-errors";

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

// The message of a failed comparison shows both operands with util.inspect. Two errors are shown
// as copies, and a copy of a DOMException has `name` and `message` getters that throw.
describe("a comparison that fails, with a value that inherits from Error.prototype", () => {
  // The AssertionError constructor sets the limit to 0 while it builds the message.
  const stackTraceLimit = Error.stackTraceLimit;
  afterEach(() => {
    Error.stackTraceLimit = stackTraceLimit;
  });

  function compare(actual: unknown, expected: unknown) {
    const thrown = thrownBy(() => assert.deepStrictEqual(actual, expected));
    return {
      throws: thrown instanceof AssertionError ? "AssertionError" : thrown,
      stackTraceLimit: Error.stackTraceLimit,
    };
  }

  it.each(inheritedErrors)("%s as an operand or as a cause", (_kind, make) => {
    const asNode = { throws: "AssertionError", stackTraceLimit };
    expect({
      operand: compare(make(), new Error("y")),
      cause: compare(new Error("a", { cause: make() }), new Error("b")),
    }).toEqual({ operand: asNode, cause: asNode });
  });
});
