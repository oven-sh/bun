import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import assert from "node:assert";
import vm from "node:vm";

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

  it("with an explicit undefined message uses the default generated message", () => {
    expect(capture(() => assert.fail(undefined))).toEqual({
      message: "Failed",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: true,
    });
  });

  it("keeps generatedMessage false for an explicit empty-string message", () => {
    expect(capture(() => assert.fail(""))).toEqual({
      message: "",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: false,
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
    expect(capture(() => (assert.fail as any)(1, 2))).toEqual({
      message: "1",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: false,
    });
    expect(capture(() => (assert.fail as any)(1, 2, undefined, "=="))).toEqual({
      message: "1",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: false,
    });
    expect(capture(() => (assert.fail as any)("a", "b", "m"))).toEqual({
      message: "a",
      actual: undefined,
      expected: undefined,
      operator: "fail",
      generatedMessage: false,
    });
  });

  it("throws the first argument when it is an Error", () => {
    const err = new Error("custom");
    try {
      assert.fail(err);
    } catch (e) {
      expect(e).toBe(err);
      return;
    }
    throw new Error("assert.fail did not throw");
  });

  it("throws a cross-realm Error instance directly", () => {
    const err = vm.runInNewContext("new Error('cross-realm')");
    try {
      assert.fail(err);
    } catch (e) {
      expect(e).toBe(err);
      return;
    }
    throw new Error("assert.fail did not throw");
  });

  it("does not emit a DEP0094 deprecation warning for multi-argument calls", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const assert = require("node:assert");
         process.on("warning", w => { console.error("ROBOBUN_PROCESS_WARNING", w.name, w.code); process.exit(2); });
         try { assert.fail(1, 2); } catch {}
         setImmediate(() => process.exit(0));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("DEP0094");
    expect(stderr).not.toContain("ROBOBUN_PROCESS_WARNING");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });
});
