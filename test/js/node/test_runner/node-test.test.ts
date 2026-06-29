import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

describe("node:test", () => {
  test("should run basic tests", async () => {
    const { exitCode, stderr } = await runTests(["01-harness.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run hooks in the right order", async () => {
    const { exitCode, stderr } = await runTests(["02-hooks.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run tests with different variations", async () => {
    const { exitCode, stderr } = await runTests(["03-test-variations.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run async tests", async () => {
    const { exitCode, stderr } = await runTests(["04-async-tests.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run all tests from multiple files", async () => {
    const { exitCode, stderr } = await runTests(["01-harness.js", "02-hooks.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      // 32 from 01-harness + 3 from 02-hooks
      stderr: expect.stringContaining("35 pass"),
    });
  });

  test("should throw NotImplementedError if you call test() or describe() inside another test()", async () => {
    const { exitCode, stderr } = await runTests(["05-test-in-test.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  // Node runs todo bodies and reports the outcome as todo whether it passes or
  // fails; a failing todo never fails the run. The fixture logs one LOG: line
  // per body that executed, and the LOG:MUST-NOT-APPEAR lines sit in bodies
  // that must never run (skip wins over todo, including inside a todo suite).
  test("todo test bodies run and never fail the run", async () => {
    const { exitCode, stdout, stderr } = await runTests(["09-todo.js"]);
    expect({
      exitCode,
      logs: stdout.split("\n").filter(line => line.startsWith("LOG:")),
      summary: summarize(stderr),
    }).toEqual({
      exitCode: 0,
      logs: [
        "LOG:passing-todo-option",
        "LOG:failing-todo-option",
        "LOG:passing-todo-modifier",
        "LOG:failing-todo-modifier",
        "LOG:todo-reason-string",
        "LOG:todo-timeout",
        "LOG:regular",
        "LOG:todo-suite-modifier",
        "LOG:todo-suite-option",
      ],
      summary: { pass: 1, fail: 0, todo: 9, skip: 2 },
    });
  });

  test("describe honors the concurrency option", async () => {
    const { exitCode, stderr } = await runTests(["10-describe-concurrency.js"]);
    expect({ exitCode, summary: summarize(stderr) }).toEqual({
      exitCode: 0,
      summary: { pass: 13, fail: 0, todo: 0, skip: 0 },
    });
  });

  test("describe rejects invalid concurrency values", async () => {
    const { exitCode, stderr } = await runTests(["11-describe-concurrency-invalid.js"]);
    expect({ exitCode, summary: summarize(stderr) }).toEqual({
      exitCode: 0,
      summary: { pass: 1, fail: 0, todo: 0, skip: 0 },
    });
  });

  // Sibling bodies in a concurrent suite settle in arbitrary order; if the
  // module-level "inside a test" context were restored LIFO it would leak, and
  // the next file's top-level test() would throw at registration.
  test("a concurrent suite does not corrupt the next file's registration", async () => {
    const { exitCode, stdout, stderr } = await runTests(["10-describe-concurrency.js", "12-after-concurrent.js"]);
    expect({
      exitCode,
      logs: stdout.split("\n").filter(line => line.startsWith("LOG:")),
      summary: summarize(stderr),
    }).toEqual({
      exitCode: 0,
      logs: ["LOG:after-concurrent"],
      summary: { pass: 14, fail: 0, todo: 0, skip: 0 },
    });
  });

  // The bound function behind node:test's `test.todo` has an internal mode
  // name; the error for using it outside `bun test` must still say `test.todo`.
  test("todo outside the test runner names test.todo in its error", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `require("node:test").todo("x", () => {});`],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Cannot use test.todo outside of the test runner. Run "bun test" to run tests.');
    expect(exitCode).not.toBe(0);
  });
});

/** Extracts the pass/fail/todo/skip counts from a `bun test` summary. */
function summarize(stderr: string) {
  const count = (label: string) => Number(stderr.match(new RegExp(`(\\d+) ${label}\\n`))?.[1] ?? 0);
  return { pass: count("pass"), fail: count("fail"), todo: count("todo"), skip: count("skip") };
}

async function runTests(filenames: string[]) {
  const testPaths = filenames.map(filename => join(import.meta.dirname, "fixtures", filename));
  const {
    exited,
    stdout: stdoutStream,
    stderr: stderrStream,
  } = spawn({
    cmd: [bunExe(), "test", ...testPaths],
    env: bunEnv,
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    exited,
    new Response(stdoutStream).text(),
    new Response(stderrStream).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("node:test mock", () => {
  const { mock } = require("node:test");

  test("mock.getter accepts the (object, methodName, options) overload", () => {
    const obj = {
      get prop() {
        return "original";
      },
    };
    // Passing an options object in the implementation slot must not clobber
    // the getter flag.
    const getter = mock.getter(obj, "prop", {});
    expect(obj.prop).toBe("original");
    expect(getter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.setter accepts the (object, methodName, options) overload", () => {
    let stored = "";
    const obj = {
      set prop(v: string) {
        stored = v;
      },
    };
    const setter = mock.setter(obj, "prop", {});
    obj.prop = "x";
    expect(stored).toBe("x");
    expect(setter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.getter rejects getter: false", () => {
    const obj = {
      get prop() {
        return 1;
      },
    };
    expect(() => mock.getter(obj, "prop", { getter: false })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.method rejects getter and setter together", () => {
    const obj = {
      get prop() {
        return 1;
      },
      set prop(_v) {},
    };
    expect(() => mock.method(obj, "prop", { getter: true, setter: true })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.fn options.times reverts to the original after N calls", () => {
    const original = () => "original";
    const impl = () => "mocked";
    const fn = mock.fn(original, impl, { times: 2 });
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("original");
    expect(fn.mock.callCount()).toBe(3);
    mock.restoreAll();
  });

  test("mock.method options.times restores the method after N calls", () => {
    const obj = {
      value: 5,
      addOne() {
        return this.value + 1;
      },
    };
    mock.method(obj, "addOne", () => 100, { times: 1 });
    expect(obj.addOne()).toBe(100);
    expect(obj.addOne()).toBe(6);
    mock.restoreAll();
  });

  test("mock.fn options.times is validated", () => {
    expect(() => mock.fn(() => {}, { times: 0 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    expect(() => mock.fn(() => {}, { times: 1.5 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
  });

  test("mock.restoreAll makes bare mock.fn mocks call their original again", () => {
    const fn = mock.fn(
      () => "original",
      () => "mocked",
    );
    expect(fn()).toBe("mocked");
    mock.restoreAll();
    expect(fn()).toBe("original");
  });
});

describe("node:test mock tracker semantics", () => {
  const { mock } = require("node:test");

  test("restoreAll keeps mocks associated; reset disassociates", () => {
    // mirrors observed node behavior exactly
    const f = mock.fn(
      () => "orig",
      () => "mocked",
    );
    expect(f()).toBe("mocked");
    mock.restoreAll();
    expect(f()).toBe("orig");
    // still tracked after restoreAll: reset() reverts a re-installed
    // implementation again
    f.mock.mockImplementation(() => "again");
    expect(f()).toBe("again");
    mock.reset();
    expect(f()).toBe("orig");
    // after reset() the context is disassociated: restoreAll no longer
    // touches it
    f.mock.mockImplementation(() => "post-reset");
    mock.restoreAll();
    expect(f()).toBe("post-reset");
    mock.reset();
  });

  test("queued once-implementations survive restoreAll like node", () => {
    const g = mock.fn(
      () => "g-orig",
      () => "g-mocked",
    );
    g.mock.mockImplementationOnce(() => "g-once", 1);
    mock.restoreAll();
    expect([g(), g(), g()]).toEqual(["g-orig", "g-once", "g-orig"]);
    mock.reset();
  });

  test("mock.method validates a non-object options argument", () => {
    const obj = {
      foo() {},
    };
    expect(() => mock.method(obj, "foo", () => {}, 5)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

test("the call record is pushed after the implementation runs, like node", () => {
  const { mock } = require("node:test");
  let inside = -1;
  const f = mock.fn(function () {
    inside = f.mock.callCount();
    return 1;
  });
  f();
  expect(inside).toBe(0);
  expect(f.mock.callCount()).toBe(1);
  mock.reset();
});
