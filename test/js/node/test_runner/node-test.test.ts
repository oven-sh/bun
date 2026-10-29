import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

describe("node:test", () => {
  // These three drive the largest fixtures (01-harness has 32 node:test cases);
  // a debug+ASAN `bun test` child takes several seconds to start, so give them
  // headroom and let them spawn in parallel instead of serially.
  test.concurrent(
    "should run basic tests",
    async () => {
      const { exitCode, stderr } = await runTests(["01-harness.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    30_000,
  );

  test.concurrent(
    "should run hooks in the right order",
    async () => {
      const { exitCode, stderr } = await runTests(["02-hooks.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    30_000,
  );

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

  test.concurrent(
    "should run all tests from multiple files",
    async () => {
      const { exitCode, stderr } = await runTests(["01-harness.js", "02-hooks.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        // 32 from 01-harness + 3 from 02-hooks
        stderr: expect.stringContaining("35 pass"),
      });
    },
    30_000,
  );

  test("should run test() and describe() called inside another test() as subtests", async () => {
    const { exitCode, stderr } = await runTests(["05-test-in-test.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run before hooks created on a running test once and validate hook options", async () => {
    const { exitCode, stderr } = await runTests(["06-hook-semantics.js"]);
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should fail tests whose hooks, bodies, or inline suite callbacks fail", async () => {
    const { exitCode, stdout, stderr } = await runTests(["07-failing-hooks.js"]);
    // The subtest after the failing before hook must not run its body (Node).
    expect(stdout).toContain("SUB_BODY_RAN=false");
    expect(stderr).toContain("0 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("10 fail"),
    });
  });

  test("should support done callbacks in tests and hooks", async () => {
    const { exitCode, stderr } = await runTests(["10-done-callbacks.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should count runtime t.todo()/t.skip() as todo/skip and keep runner timers real under mock timers", async () => {
    const { exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("1 skip");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should count runtime t.todo()/t.skip() as todo/skip under --concurrent too", async () => {
    // markCurrentResult's microtask-drain fallback could not name a sequence
    // inside a concurrent group, so the skip/todo mark was dropped and both
    // tests were reported as pass.
    const { exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"], {}, ["--concurrent"]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("1 skip");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run todo bodies under --todo instead of registering an empty function", async () => {
    const { exitCode, stderr } = await runTests(["13-todo-bodies.js"], {}, ["--todo"]);
    expect(stderr).toContain("2 todo");
    expect(stderr).toContain("1 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should forward Infinity and finite timeouts so they override the runner default", async () => {
    const { exitCode, stderr } = await runTests(["11-timeout-overrides.js"], {}, ["--timeout", "100"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should not leak file-level beforeEach hooks across files in one process", async () => {
    const { exitCode, stderr } = await runTests(["14-root-hooks-a.js", "14-root-hooks-b.js"]);
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should treat only as a no-op instead of using bun:test's CI-banned only()", async () => {
    // bun:test's only() only throws when CI is set; pin the precondition.
    const { exitCode, stderr } = await runTests(["08-only-no-op.js"], { CI: "1" });
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should serialize inline suites and await async describe callbacks like node", async () => {
    const { exitCode, stderr } = await runTests(["09-inline-suites.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should expose the body outcome to afterEach and workerId to the context", async () => {
    const { exitCode, stderr } = await runTests(["15-outcome-in-hooks.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should capture plan at first t.assert access and resolve subtests started after their parent finished", async () => {
    const { exitCode, stderr } = await runTests(["16-plan-and-late-subtest.js"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should bound plan({wait:true}) by the test's own timeout instead of hanging", async () => {
    const { exitCode, stderr } = await runTests(["16b-plan-wait-timeout.js"]);
    expect(stderr).toContain("test timed out after 100ms");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should fail the parent when a t.test() that fulfills plan({wait}) throws", async () => {
    const { exitCode, stderr } = await runTests(["24-plan-wait-late-subtest.js"]);
    // The error message from makeTestFailure — must not be satisfied by the
    // fixture's own source lines echoed in the failure context.
    expect(stderr).toContain("error: 1 subtest failed");
    expect(stderr).toContain("boom");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should treat a failing expectFailure test as a pass", async () => {
    const { exitCode, stderr } = await runTests(["25-expect-failure.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should fail an expectFailure test that passes", async () => {
    const { exitCode, stderr } = await runTests(["27-expect-failure-but-passes.js"]);
    expect(stderr).toContain("test was expected to fail but passed");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should fail an expectFailure test whose error does not match the validator", async () => {
    const { exitCode, stderr } = await runTests(["29-expect-failure-mismatch.js"]);
    expect(stderr).toContain("the error did not match the expected validation");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should inherit expectFailure into subtests", async () => {
    // Matches node v26.3.0: the subtest inherits the expectation and passes, so
    // the parent is the one that fails for not failing.
    const { exitCode, stderr } = await runTests(["28-expect-failure-inherited.js"]);
    expect(stderr).toContain("test was expected to fail but passed");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should not run a skipped suite's callback", async () => {
    const { exitCode, stdout, stderr } = await runTests(["26-skipped-suite-body.js"]);
    expect(stdout).not.toContain("[suite body ran: skip-only]");
    // { skip: true, todo: true } is a skip in Node, so this body is skipped too.
    expect(stdout).not.toContain("[suite body ran: both-flags]");
    // A todo suite's callback does run.
    expect(stdout).toContain("[suite body ran: pending-only]");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should reset the module-level mock tracker between --rerun-each iterations", async () => {
    // ESM entry: --rerun-each currently only re-evaluates ESM entry files.
    const { exitCode, stderr } = await runTests(["17-rerun-mock-reset.mjs"], {}, ["--rerun-each=3"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should keep node's zero-delay mock interval semantics", async () => {
    const { exitCode, stderr } = await runTests(["18-mock-timers-interval-zero.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should apply the plan option before beforeEach so a hook cannot snapshot a null plan", async () => {
    const { exitCode, stderr } = await runTests(["19-plan-option-order.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should enforce a hook-level signal and install t.assert.ok separately", async () => {
    const { exitCode, stderr } = await runTests(["20-hook-signal-and-assert-ok.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should let a registered ok assertion override the built-in one", async () => {
    const { exitCode, stderr } = await runTests(["21-register-ok.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should gate a nested inline subtest on every ancestor suite's before hooks", async () => {
    const { exitCode, stderr } = await runTests(["22-nested-suite-before.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should resolve the promise of a test that a name pattern filters out", async () => {
    const { exitCode, stderr } = await runTests(["23-filtered-test-promise.js"], {}, ["-t", "should resolve"]);
    expect(stderr).not.toContain("timed out");
    expect(stderr).toContain("1 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });
});

async function runTests(filenames: string[], env: Record<string, string> = {}, args: string[] = []) {
  const testPaths = filenames.map(filename => join(import.meta.dirname, "fixtures", filename));
  const {
    exited,
    stdout: stdoutStream,
    stderr: stderrStream,
  } = spawn({
    cmd: [bunExe(), "test", ...args, ...testPaths],
    env: { ...bunEnv, ...env },
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

test("mock.property/mock.method survive a polluted Object.prototype", async () => {
  // The defineProperty descriptors must carry __proto__:null so an inherited
  // `value` on Object.prototype does not turn the accessor descriptor into a
  // TypeError (nodejs/node lib/internal/test_runner/mock/mock.js does this).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        Object.prototype.value = 1;
        const { mock } = require("node:test");
        const obj = { x: 1, get p() { return 5; } };
        mock.property(obj, "x");
        mock.getter(obj, "p");
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({ stdout: "ok", exitCode: 0 });
});

// node runs each test file in a process of its own. `bun test` runs the files of a run in one
// realm, so node:test undoes the mocks that a file left before the next file is loaded.
describe("node:test between the files of one run", () => {
  // A debug+ASAN `bun test` child takes several seconds, and most of these run at the same time.
  // The tests of the files get the same time.
  const timeout = 30_000;

  // Every fixture loads this first. `bun test` loads a module once for a run, so the files of a
  // run share these objects, and mocked() compares them with what the first file of the run found.
  const shared = `
    const path = require("node:path");
    const timers = require("node:timers");
    const timersPromises = require("node:timers/promises");
    const { Writable } = require("node:stream");

    const target = {
      method() {
        return "real";
      },
      rootHookMethod() {
        return "real";
      },
      get accessor() {
        return "real";
      },
      set accessor(value) {},
      property: "real",
    };
    class Model {
      static find() {
        return "real";
      }
    }
    class User extends Model {}

    // Every own property of these, so a slot that a mock adds or replaces shows up by itself.
    const watched = {
      target,
      Model,
      User,
      path,
      timers,
      "timers/promises": timersPromises,
      scheduler: timersPromises.scheduler,
      AbortSignal,
    };
    const globals = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "Date"];

    function held() {
      const all = new Map();
      const add = (name, object, key) => {
        const { value, get, set } = Object.getOwnPropertyDescriptor(object, key);
        all.set(name, [value, get, set]);
      };
      for (const [name, object] of Object.entries(watched)) {
        for (const key of Reflect.ownKeys(object)) add(name + "." + String(key), object, key);
      }
      for (const key of globals) add(key, globalThis, key);
      return all;
    }
    const heldAtFirst = held();

    module.exports = {
      target,
      Model,
      User,
      // What a file leaves here: a bare mock.fn(), one of a file-level hook, and a stream with a mocked getter.
      spy: undefined,
      rootSpy: undefined,
      stream: new Writable(),
      // The names of what does not hold the function or the value that it held at first.
      mocked() {
        const now = held();
        const names = [];
        for (const name of new Set([...heldAtFirst.keys(), ...now.keys()])) {
          const [first, current] = [heldAtFirst.get(name), now.get(name)];
          if (!first || !current || first.some((part, i) => part !== current[i])) names.push(name);
        }
        if (this.spy !== undefined && this.spy() !== "original") names.push("mock.fn");
        if (this.rootSpy !== undefined && this.rootSpy() !== "original") names.push("t.mock.fn of a file-level hook");
        if (this.stream.destroyed !== false) names.push("stream.destroyed");
        return names.sort();
      },
    };
  `;

  // A file that looks at what the file before it left, before it touches the test module.
  const follower = (label: string, testModule: "node:test" | "bun:test" = "node:test", options = "") => `
    const shared = require("./shared.js");
    const atLoad = shared.mocked();
    const { test } = require("${testModule}");
    const assert = require("node:assert");
    test("${label}: nothing is mocked when the file loads", ${options}() => assert.deepStrictEqual(atLoad, []));
    test("${label}: nothing is mocked in a test", ${options}() => assert.deepStrictEqual(shared.mocked(), []));
  `;
  const nothingIsMocked = (label: string) => [
    `(pass) ${label}: nothing is mocked when the file loads`,
    `(pass) ${label}: nothing is mocked in a test`,
  ];

  // Mocks made on top of mocks. As in node, each mock writes back what it found, so undoing them
  // first mock first does not put the real function back.
  const mocksOnMocks = (moreMocks: string, afterHook: string) => `
    const shared = require("./shared.js");
    const { test, mock, beforeEach, after } = require("node:test");
    const assert = require("node:assert");
    const path = require("node:path");

    let count = 0;
    // One slot is mocked again before each test and never restored.
    beforeEach(() => {
      mock.method(path, "basename", () => "mocked " + ++count);
    });
    // A mock for every class. A test mocks the method again, in a class that inherits it.
    mock.method(shared.Model, "find", () => "mocked");
    ${moreMocks}

    test("a module-level mock over the mock of a test", t => {
      assert.strictEqual(path.basename("/x/y"), "mocked 1");
      // The end of the test restores the mocks of the test. The module-level ones found those.
      t.mock.method(shared.target, "method", () => "of the test");
      mock.method(shared.target, "method", () => "module-level");
      t.mock.method(shared.User, "find", () => "of the test");
      t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "setImmediate", "AbortSignal.timeout", "scheduler.wait"] });
      mock.timers.enable({ apis: ["setTimeout", "setInterval", "setImmediate", "AbortSignal.timeout", "scheduler.wait"] });
    });

    test("a slot that is mocked twice", () => {
      assert.strictEqual(path.basename("/x/y"), "mocked 2");
    });
    ${afterHook}
  `;

  /** Runs `bun test` on the files, in this order. */
  async function runFiles(dir: string, files: string[], args: string[] = [], hangGuard?: number) {
    await using proc = spawn({
      cmd: [bunExe(), "test", "--timeout", String(timeout), ...args, ...files.map(file => "./" + file)],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: hangGuard,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const tests = stderr
      .split(/\r?\n/)
      .filter(line => /^\((pass|fail)\) /.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
    // What the files printed: the first line of stdout is the version of `bun test`.
    const printed = stdout.split(/\r?\n/).filter(line => line !== "" && !line.startsWith("bun test v"));
    return { tests, printed, stderr, exitCode, signalCode: proc.signalCode, pid: proc.pid };
  }

  // Not one of the concurrent tests below: a time limit is what tells it that the second file hangs.
  test(
    "mock timers that a file leaves are gone when the next file awaits a timer as it loads",
    async () => {
      using dir = tempDir("node-test-files-timers", {
        "a-timers.test.js": `
          const { test, mock } = require("node:test");
          test("a1", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
          });
        `,
        "b-timers.test.mjs": `
          await new Promise(resolve => setTimeout(resolve, 10));
          const { test } = await import("node:test");
          test("b1", () => {});
        `,
      });
      // A mocked setTimeout never calls back, and the second file would never finish loading.
      const hangGuard = timeout / 2;
      const { tests, exitCode, signalCode, stderr } = await runFiles(
        String(dir),
        ["a-timers.test.js", "b-timers.test.mjs"],
        [],
        hangGuard,
      );
      expect({ tests, exitCode, signalCode }, stderr).toEqual({
        tests: ["(pass) a1", "(pass) b1"],
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  describe.concurrent("the mocks that a file leaves", () => {
    test(
      "a method mock that a file leaves is gone when the next file loads",
      async () => {
        using dir = tempDir("node-test-files-method", {
          "a-method.test.js": `
            const { test, mock } = require("node:test");
            const assert = require("node:assert");
            const path = require("node:path");
            mock.method(path, "basename", () => "mocked");
            test("a1", () => {
              assert.equal(path.basename("/x/y"), "mocked");
            });
          `,
          "b-method.test.js": `
            const got = require("node:path").basename("/x/y");
            const { test } = require("node:test");
            test("b1", () => {
              require("node:assert").equal(got, "y");
            });
          `,
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["a-method.test.js", "b-method.test.js"]);
        expect({ tests, exitCode }, stderr).toEqual({ tests: ["(pass) a1", "(pass) b1"], exitCode: 0 });
      },
      timeout,
    );

    test(
      "every kind of mock that a file leaves is gone when the next file loads",
      async () => {
        using dir = tempDir("node-test-files-kinds", {
          "shared.js": shared,
          "leaves-every-kind.js": `
            const shared = require("./shared.js");
            const { test, mock, before, after } = require("node:test");
            const assert = require("node:assert");
            const path = require("node:path");

            mock.method(path, "basename", () => "mocked");
            mock.method(shared.target, "method", () => "mocked");
            mock.getter(shared.target, "accessor", () => "mocked");
            mock.property(shared.target, "property", "mocked");
            shared.spy = mock.fn(
              () => "original",
              () => "mocked",
            );
            // The tracker of the file itself, not the module-level one.
            before(t => {
              t.mock.method(shared.target, "rootHookMethod", () => "mocked");
              shared.rootSpy = t.mock.fn(
                () => "original",
                () => "mocked",
              );
            });

            test("leaves every kind of mock installed", () => {
              mock.timers.enable();
              assert.deepStrictEqual(shared.mocked(), [
                "AbortSignal.timeout",
                "Date",
                "clearImmediate",
                "clearInterval",
                "clearTimeout",
                "mock.fn",
                "path.basename",
                "scheduler.wait",
                "setImmediate",
                "setInterval",
                "setTimeout",
                "t.mock.fn of a file-level hook",
                "target.accessor",
                "target.method",
                "target.property",
                "target.rootHookMethod",
                "timers.clearImmediate",
                "timers.clearInterval",
                "timers.clearTimeout",
                "timers.setImmediate",
                "timers.setInterval",
                "timers.setTimeout",
                "timers/promises.setImmediate",
                "timers/promises.setInterval",
                "timers/promises.setTimeout",
              ]);
            });

            // The mocks stay for all of the file: its own last hook still finds them.
            after(() => assert.strictEqual(path.basename("/x/y"), "mocked"));
          `,
          "follower.js": follower("next file"),
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["leaves-every-kind.js", "follower.js"]);
        expect({ tests, exitCode }, stderr).toEqual({
          tests: ["(pass) leaves every kind of mock installed", ...nothingIsMocked("next file")],
          exitCode: 0,
        });
      },
      timeout,
    );

    test(
      "mocks on mocks that a file leaves are gone when a bun:test file loads next",
      async () => {
        using dir = tempDir("node-test-files-stacked", {
          "shared.js": shared,
          "mocks-on-mocks.js": mocksOnMocks(
            // The second mock goes through the proxy that the first one returns. In node too,
            // mock.reset() throws for these two.
            `mock.property(mock.property(shared.target, "property", "mocked"), "property", "mocked twice");`,
            "",
          ),
          "follower.js": follower("bun:test file", "bun:test"),
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["mocks-on-mocks.js", "follower.js"]);
        expect({ tests, exitCode }, stderr).toEqual({
          tests: [
            "(pass) a module-level mock over the mock of a test",
            "(pass) a slot that is mocked twice",
            ...nothingIsMocked("bun:test file"),
          ],
          exitCode: 0,
        });
      },
      timeout,
    );

    test(
      "the earlier mock of each slot, which mock.reset() leaves as in node, is gone when the next file loads",
      async () => {
        using dir = tempDir("node-test-files-stacked-reset", {
          "shared.js": shared,
          "mocks-on-mocks.js": mocksOnMocks(
            "",
            `
            after(() => {
              mock.reset();
              assert.deepStrictEqual(shared.mocked(), [
                "AbortSignal.timeout",
                "User.find",
                "clearImmediate",
                "clearInterval",
                "clearTimeout",
                "path.basename",
                "scheduler.wait",
                "setImmediate",
                "setInterval",
                "setTimeout",
                "target.method",
                "timers.clearImmediate",
                "timers.clearInterval",
                "timers.clearTimeout",
                "timers.setImmediate",
                "timers.setInterval",
                "timers.setTimeout",
                "timers/promises.setImmediate",
                "timers/promises.setInterval",
                "timers/promises.setTimeout",
              ]);
            });
          `,
          ),
          "follower.js": follower("next file"),
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["mocks-on-mocks.js", "follower.js"]);
        expect({ tests, exitCode }, stderr).toEqual({
          tests: [
            "(pass) a module-level mock over the mock of a test",
            "(pass) a slot that is mocked twice",
            ...nothingIsMocked("next file"),
          ],
          exitCode: 0,
        });
      },
      timeout,
    );

    test(
      "a mock that cannot be restored calls the original, and the mocks after it are gone, when the next file loads",
      async () => {
        using dir = tempDir("node-test-files-unrestorable", {
          "shared.js": shared,
          "leaves-unrestorable.js": `
            const shared = require("./shared.js");
            const { test, mock } = require("node:test");
            const assert = require("node:assert");
            const path = require("node:path");

            // "destroyed" is an accessor of Writable.prototype that is not configurable. The mock gives
            // the stream a copy that is not configurable either, so nothing can put the first one back.
            mock.getter(shared.stream, "destroyed", () => true);
            mock.method(path, "basename", () => "mocked");

            test("leaves a mock that cannot be restored, and one made after it", () => {
              assert.throws(() => mock.restoreAll(), TypeError);
              assert.strictEqual(shared.stream.destroyed, true);
              assert.strictEqual(path.basename("/x/y"), "mocked");
            });
          `,
          "follower.js": follower("next file"),
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["leaves-unrestorable.js", "follower.js"]);
        expect({ tests, exitCode, errors: stderr.match(/^ *\d+ errors?$/m) }, stderr).toEqual({
          tests: [
            "(pass) leaves a mock that cannot be restored, and one made after it",
            ...nothingIsMocked("next file"),
          ],
          exitCode: 0,
          errors: null,
        });
      },
      timeout,
    );

    test(
      "mock timers whose reset throws do not stay enabled for the next file",
      async () => {
        using dir = tempDir("node-test-files-timers-throw", {
          "pins-date.js": `
            const { test, mock } = require("node:test");
            mock.timers.enable({ apis: ["setTimeout", "Date"] });
            // The reset cannot give Date the descriptor it had, and throws.
            Object.defineProperty(globalThis, "Date", { configurable: false });
            test("leaves mock timers whose reset throws", () => {});
          `,
          "enables-again.js": `
            const atLoad = setTimeout.name;
            const { test, mock } = require("node:test");
            const assert = require("node:assert");
            test("the next file has the real setTimeout and can mock timers", () => {
              assert.strictEqual(atLoad, "setTimeout");
              mock.timers.enable({ apis: ["setTimeout"] });
              mock.timers.reset();
            });
          `,
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["pins-date.js", "enables-again.js"]);
        expect({ tests, exitCode, errors: stderr.match(/^ *\d+ errors?$/m) }, stderr).toEqual({
          tests: [
            "(pass) leaves mock timers whose reset throws",
            "(pass) the next file has the real setTimeout and can mock timers",
          ],
          exitCode: 0,
          errors: null,
        });
      },
      timeout,
    );

    test(
      "mocks of a file that throws as it loads are gone when the next file loads",
      async () => {
        using dir = tempDir("node-test-files-load-error", {
          "shared.js": shared,
          "throws-as-it-loads.js": `
            require("./shared.js");
            const { mock } = require("node:test");
            mock.method(require("node:path"), "basename", () => "mocked");
            mock.timers.enable({ apis: ["setTimeout"] });
            throw new Error("thrown while the file loads");
          `,
          "follower.js": follower("next file"),
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["throws-as-it-loads.js", "follower.js"]);
        expect(stderr).toContain("error: thrown while the file loads");
        expect({ tests, exitCode }, stderr).toEqual({ tests: nothingIsMocked("next file"), exitCode: 1 });
      },
      timeout,
    );

    test(
      "mocks of a file that runs no test are gone when the next file loads",
      async () => {
        using dir = tempDir("node-test-files-no-test-runs", {
          "shared.js": shared,
          "leaves-in-a-test-that-is-left-out.js": `
            require("./shared.js");
            const { test, mock } = require("node:test");
            mock.method(require("node:path"), "basename", () => "mocked");
            mock.timers.enable({ apis: ["setTimeout"] });
            test("the name filter leaves this test out", () => {});
          `,
          "follower.js": follower("kept by the name filter"),
        });
        const { tests, exitCode, stderr } = await runFiles(
          String(dir),
          ["leaves-in-a-test-that-is-left-out.js", "follower.js"],
          ["-t", "kept by the name filter"],
        );
        expect({ tests, exitCode }, stderr).toEqual({
          tests: nothingIsMocked("kept by the name filter"),
          exitCode: 0,
        });
      },
      timeout,
    );

    test(
      "mocks of a test that never ends, and of the context of a test that is over, are gone when the next file loads",
      async () => {
        using dir = tempDir("node-test-files-no-reset", {
          "shared.js": shared,
          "nothing-resets-these.js": `
            const shared = require("./shared.js");
            const { test } = require("node:test");
            const path = require("node:path");

            let kept;
            test("keeps its context", { timeout: ${timeout} }, t => {
              kept = t;
            });
            // node:test resets the mocks of a test when the test ends. This one is over.
            test("mocks through the context of a test that is over", { timeout: ${timeout} }, () => {
              kept.mock.method(path, "basename", () => "mocked");
              kept.mock.timers.enable({ apis: ["setInterval"] });
            });
            // The timeout of bun test ends this one, so node:test never gets to reset its mocks.
            test("never ends", async t => {
              t.mock.method(shared.target, "method", () => "mocked");
              t.mock.timers.enable({ apis: ["setTimeout"] });
              await new Promise(() => {});
            });
          `,
          "follower.js": follower("next file", "node:test", `{ timeout: ${timeout} }, `),
        });
        const { tests, exitCode, stderr } = await runFiles(
          String(dir),
          ["nothing-resets-these.js", "follower.js"],
          ["--timeout", "300"],
        );
        expect({ tests, exitCode }, stderr).toEqual({
          tests: [
            "(pass) keeps its context",
            "(pass) mocks through the context of a test that is over",
            "(fail) never ends",
            ...nothingIsMocked("next file"),
          ],
          exitCode: 1,
        });
      },
      timeout,
    );

    test(
      "an error that node:test throws between two files fails the run, and the next file runs its tests",
      async () => {
        using dir = tempDir("node-test-files-error", {
          "replaces-restore.js": `
            const { test, mock } = require("node:test");
            // A file can reach the class of the contexts, and node:test calls restore() of each mock.
            Object.getPrototypeOf(mock.fn().mock).restore = () => {
              throw new Error("thrown between two files");
            };
            test("replaces restore() of every mock", () => {});
          `,
          "next-file.js": `
            require("node:test").test("the next file runs its tests", () => {});
          `,
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["replaces-restore.js", "next-file.js"]);
        expect(stderr).toContain("error: thrown between two files");
        expect({ tests, exitCode, errors: stderr.match(/^ *\d+ errors?$/m)?.[0].trim() }, stderr).toEqual({
          tests: ["(pass) replaces restore() of every mock", "(pass) the next file runs its tests"],
          exitCode: 1,
          errors: "1 error",
        });
      },
      timeout,
    );

    // A file is loaded again, or after another one, in the realm that the file before it used.
    // `--parallel` starts a second worker only after the delay, so one worker loads every file.
    test.each([
      ["--rerun-each", ["--rerun-each=3"], 1, 3, false],
      ["--isolate with --rerun-each", ["--isolate", "--rerun-each=3"], 2, 6, false],
      [
        "a --parallel worker with --no-isolate",
        ["--parallel=2", "--parallel-delay=1000000", "--no-isolate"],
        3,
        3,
        true,
      ],
    ] as const)(
      "mocks that a file leaves are gone when %s loads a file",
      async (_, args, files, runs, inWorker) => {
        const again = `
          import { test, mock } from "node:test";
          import assert from "node:assert";
          import path from "node:path";
          import shared from "./shared.js";

          console.log("pid " + process.pid);
          const atLoad = shared.mocked();
          test("nothing is mocked when the file loads", () => {
            assert.deepStrictEqual(atLoad, []);
            mock.method(path, "basename", () => "mocked");
            mock.timers.enable({ apis: ["setTimeout"] });
          });
        `;
        using dir = tempDir("node-test-files-again", {
          "shared.js": shared,
          "again-1.mjs": again,
          "again-2.mjs": again,
          "again-3.mjs": again,
        });
        const { tests, exitCode, stderr, printed, pid } = await runFiles(
          String(dir),
          ["again-1.mjs", "again-2.mjs", "again-3.mjs"].slice(0, files),
          [...args],
        );
        // A worker prints through the stderr of `bun test`.
        const pids = new Set([...printed, ...stderr.split(/\r?\n/)].filter(line => /^pid \d+$/.test(line)));
        expect({ tests, exitCode, processes: pids.size, inWorker: !pids.has("pid " + pid) }, stderr).toEqual({
          tests: Array(runs).fill("(pass) nothing is mocked when the file loads"),
          exitCode: 0,
          processes: 1,
          inWorker,
        });
      },
      timeout,
    );

    // Each write to the property prints a line: two for the two mocks, and one for each restore.
    const mocksAProxy = {
      "mocks-a-proxy.js": `
        const { test, mock } = require("node:test");
        const target = new Proxy(
          { method() {} },
          {
            defineProperty(object, key, descriptor) {
              console.log("defineProperty " + String(key));
              return Reflect.defineProperty(object, key, descriptor);
            },
          },
        );
        mock.method(target, "method", () => {});
        mock.method(target, "method", () => {});
        test("leaves two mocks on a proxy", () => {});
      `,
      "next-file.js": `
        console.log("the next file loads");
        const { test, mock } = require("node:test");
        mock.restoreAll();
        console.log("the next file called mock.restoreAll()");
        test("the next file", () => {});
      `,
      "third-file.js": `
        console.log("the third file loads");
        require("node:test").test("the third file", () => {});
      `,
    };

    test(
      "what a file leaves is restored once, before the first statement of the next file",
      async () => {
        using dir = tempDir("node-test-files-once", mocksAProxy);
        const { printed, exitCode, stderr } = await runFiles(String(dir), Object.keys(mocksAProxy));
        expect({ printed, exitCode }, stderr).toEqual({
          printed: [
            "defineProperty method",
            "defineProperty method",
            "defineProperty method",
            "the next file loads",
            "the next file called mock.restoreAll()",
            "the third file loads",
          ],
          exitCode: 0,
        });
      },
      timeout,
    );

    test(
      "nothing is restored in the realm that --isolate leaves",
      async () => {
        using dir = tempDir("node-test-files-isolate", mocksAProxy);
        const { printed, exitCode, stderr } = await runFiles(String(dir), Object.keys(mocksAProxy), ["--isolate"]);
        expect({ printed, exitCode }, stderr).toEqual({
          printed: [
            "defineProperty method",
            "defineProperty method",
            "the next file loads",
            "the next file called mock.restoreAll()",
            "the third file loads",
          ],
          exitCode: 0,
        });
      },
      timeout,
    );

    test(
      "an 'exit' listener of the last file still finds the mocks of that file, as in node",
      async () => {
        using dir = tempDir("node-test-files-exit", {
          "only-file.js": `
            const { test, mock } = require("node:test");
            const path = require("node:path");
            mock.method(path, "basename", () => "mocked");
            process.on("exit", () => console.log("at exit: " + path.basename("/x/y")));
            test("the only file of the run", () => {});
          `,
        });
        const { printed, exitCode, stderr } = await runFiles(String(dir), ["only-file.js"]);
        expect({ printed, exitCode }, stderr).toEqual({ printed: ["at exit: mocked"], exitCode: 0 });
      },
      timeout,
    );

    test(
      "a spy of bun:test that bun:test restored is not put back when the next file loads",
      async () => {
        using dir = tempDir("node-test-files-bun-test-spy", {
          // A common setup file: no console.error in a test, and the real one again after each test.
          "setup.ts": `
            import { afterEach, beforeEach, mock, spyOn } from "bun:test";
            beforeEach(() => {
              spyOn(console, "error").mockImplementation(() => {});
            });
            afterEach(() => {
              mock.restore();
            });
          `,
          // Its mock finds the spy of the setup file, and bun:test restores that spy over it.
          "mocks-over-the-spy.mjs": `
            import { test, mock } from "node:test";
            import assert from "node:assert";
            test("mocks console.error over the spy", () => {
              const error = mock.method(console, "error", () => {});
              console.error("no output");
              assert.strictEqual(error.mock.callCount(), 1);
            });
          `,
          "bun-test-file.ts": `
            import { expect, test } from "bun:test";
            const atLoad = console.error;
            test("console.error is not a mock when the file loads", () => {
              expect("mockRestore" in atLoad).toBe(false);
            });
          `,
        });
        const { tests, exitCode, stderr } = await runFiles(
          String(dir),
          ["mocks-over-the-spy.mjs", "bun-test-file.ts"],
          ["--preload", "./setup.ts"],
        );
        expect({ tests, exitCode }, stderr).toEqual({
          tests: ["(pass) mocks console.error over the spy", "(pass) console.error is not a mock when the file loads"],
          exitCode: 0,
        });
      },
      timeout,
    );

    test(
      "a callback of the file before, when it runs in the next file, finds the real function",
      async () => {
        using dir = tempDir("node-test-files-late-callback", {
          "shared.js": shared,
          "leaves-a-callback.js": `
            const shared = require("./shared.js");
            const { test, mock } = require("node:test");
            mock.method(shared.target, "method", () => "mocked");
            globalThis.gate = Promise.withResolvers();
            globalThis.late = globalThis.gate.promise.then(() => shared.target.method());
            test("leaves a callback that waits for the next file", () => {});
          `,
          "opens-the-gate.js": `
            const { test, expect } = require("bun:test");
            test("the callback of the file before finds the real function", async () => {
              globalThis.gate.resolve();
              expect(await globalThis.late).toBe("real");
            });
          `,
        });
        const { tests, exitCode, stderr } = await runFiles(String(dir), ["leaves-a-callback.js", "opens-the-gate.js"]);
        expect({ tests, exitCode }, stderr).toEqual({
          tests: [
            "(pass) leaves a callback that waits for the next file",
            "(pass) the callback of the file before finds the real function",
          ],
          exitCode: 0,
        });
      },
      timeout,
    );
  });
});
