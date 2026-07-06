import assert, { AssertionError } from "assert";
import { beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("assert(expr)", () => {
  // https://github.com/oven-sh/bun/issues/941
  it.each([true, 1, "foo"])(`assert(%p) does not throw`, expr => {
    expect(() => assert(expr)).not.toThrow();
  });

  it.each([false, 0, "", null, undefined])(`assert(%p) throws`, expr => {
    expect(() => assert(expr)).toThrow(AssertionError);
  });

  it("is an alias for assert.ok", () => {
    expect(assert as Function).toBe(assert.ok);
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

// node v26 removed the end-of-life DEP0094 multi-argument behaviour of
// assert.fail: only the first argument is used (as the message, or thrown if
// it is an Error), operator is always "fail", actual/expected are undefined.
describe("assert.fail", () => {
  const capture = (fn: () => void) => {
    try {
      fn();
    } catch (e: any) {
      return {
        message: e.message,
        actual: e.actual,
        expected: e.expected,
        operator: e.operator,
        generatedMessage: e.generatedMessage,
      };
    }
    throw new Error("assert.fail did not throw");
  };

  it("with no arguments uses the default generated message", () => {
    expect(capture(() => assert.fail())).toEqual({
      message: "Failed",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: true,
    });
  });

  it("uses the first argument as the message", () => {
    expect(capture(() => assert.fail("boom"))).toEqual({
      message: "boom",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: false,
    });
  });

  it("ignores extra arguments (no legacy actual/expected synthesis)", () => {
    expect(capture(() => assert.fail(1 as any, 2 as any))).toEqual({
      message: "1",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: false,
    });
    expect(capture(() => assert.fail(1 as any, 2 as any, undefined, "==" as any))).toEqual({
      message: "1",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: false,
    });
    expect(capture(() => assert.fail("a" as any, "b" as any, "m" as any))).toEqual({
      message: "a",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: false,
    });
  });

  it("throws the first argument when it is an Error", () => {
    const err = new Error("custom");
    expect(() => assert.fail(err)).toThrow(err);
  });

  it("does not emit a DEP0094 deprecation warning for multi-argument calls", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const assert = require("node:assert");
         process.on("warning", w => { console.error("WARNING", w.name, w.code); process.exit(2); });
         try { assert.fail(1, 2); } catch {}
         setImmediate(() => process.exit(0));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("DEP0094");
    expect(stderr).not.toContain("WARNING");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });
});
