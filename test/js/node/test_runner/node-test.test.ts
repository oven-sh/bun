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

  // Like the first three tests, these spawn debug+ASAN `bun test` children on large fixtures.
  test.concurrent(
    "should report every failed subtest under its name path with its own error",
    async () => {
      using dir = tempDir("node-test-failed-subtests", {});
      const junit = join(String(dir), "junit.xml");
      const { exitCode, stdout, stderr } = await runTests(["50-failed-subtests-report.js"], {}, [
        "--reporter=junit",
        `--reporter-outfile=${junit}`,
      ]);
      expect(reportLines(stderr)).toEqual([
        "subtest failed: table > row-2",
        'AssertionError: Expected "actual" to be strictly unequal to: 2',
        "(fail) table",
        "subtest failed: two > first",
        "error: first error",
        "subtest failed: two > second",
        "error: second error",
        "(fail) two",
        "subtest failed: own > kid",
        "error: kid error",
        "error: parent error",
        "(fail) own",
        "subtest failed: group > deep > outer > leaf-1",
        "error: leaf-1 error",
        "subtest failed: group > deep > outer > leaf-2",
        "error: leaf-2 error",
        "(fail) group > deep",
        "subtest failed: globals > inner",
        "error: inner error",
        "subtest failed: globals > suite > kid-one",
        "error: kid-one error",
        "subtest failed: globals > suite > kid-two",
        "error: kid-two error",
        "(fail) globals",
        "subtest failed: suite-own > after-suite > kid",
        "error: after-kid error",
        "subtest failed: suite-own > after-suite",
        "error: after boom",
        "subtest failed: suite-own > throwing-suite",
        "error: callback boom",
        "subtest failed: suite-own > rejecting-suite",
        "error: async callback boom",
        "subtest failed: suite-own > before-suite > gated",
        "error: before boom",
        "subtest failed: suite-own > before-suite",
        "error: before boom",
        "(fail) suite-own",
        "subtest failed: before-hook > gated-1",
        "error: hook boom",
        "subtest failed: before-hook > gated-2",
        "error: hook boom",
        "error: hook boom",
        "(fail) before-hook",
        "subtest failed: odd-values > zero",
        "error: 0",
        "subtest failed: odd-values > frozen",
        "error: frozen error",
        "subtest failed: odd-values > getter",
        "error: getter error",
        "subtest failed: odd-values > looks-synthetic",
        "error: user error",
        "subtest failed: odd-values > shared-1",
        "error: shared error",
        "subtest failed: odd-values > shared-2",
        "error: shared error",
        "(fail) odd-values",
        "subtest failed: late > mid > early",
        "error: early error",
        "subtest failed: late > mid",
        "error: mid error",
        "(fail) late",
        "subtest failed: runner-made > plan",
        "error: plan expected 1 assertions but received 0",
        "subtest failed: runner-made > timeout",
        "error: test timed out after 1ms",
        "(fail) runner-made",
        "(pass) todo-kid",
        "(pass) expected-failure",
        "subtest failed: hook-state > kid-1",
        "error: first kid",
        "subtest failed: hook-state > kid-2",
        "error: second kid",
        "(fail) hook-state",
        "subtest failed: hook-state-suite-first > suite > kid",
        "error: suite kid",
        "subtest failed: hook-state-suite-first > kid-2",
        "error: later kid",
        "(fail) hook-state-suite-first",
        "subtest failed: hook-state-one > kid",
        "error: only kid",
        "(fail) hook-state-one",
        "subtest failed: hook-state-nested > mid > leaf",
        "error: nested leaf",
        "(fail) hook-state-nested",
      ]);
      // The errors that the report adds have no stack frames, so the error printer shows no source of node:test for them.
      expect(stderr).not.toMatch(/at (subtestLabel|failureWithSubtests) /);
      // Bun builds the parent's roll-up error before its `after` hook runs. The report must not change it.
      expect(stdout.split("\n").filter(line => line.startsWith("HOOK "))).toEqual([
        'HOOK [false,"2 subtests failed","subtestsFailed",true]',
        'HOOK [false,"2 subtests failed","subtestsFailed",true]',
        'HOOK [false,"1 subtest failed","subtestsFailed",true]',
        'HOOK ["1 subtest failed","1 subtest failed",true]',
      ]);
      // A subtest is not a test of its own for the totals or for the JUnit report.
      const xml = await Bun.file(junit).text();
      expect(xml.match(/<testcase /g)).toHaveLength(16);
      const two = xml.slice(xml.indexOf('<testcase name="two"'));
      expect(two.slice(0, two.indexOf("</testcase>"))).toContain(
        "subtest failed: two &gt; first&#10;&#10;Error: first error&#10;",
      );
      expect(two.slice(0, two.indexOf("</testcase>"))).toContain(
        "subtest failed: two &gt; second&#10;&#10;Error: second error&#10;",
      );
      expect(stderr).toContain("2 pass");
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining("14 fail"),
      });
    },
    30_000,
  );

  test.concurrent(
    "should keep the roll-up error that run() reports for a parent and for an inline suite",
    async () => {
      const fixture = join(import.meta.dirname, "fixtures", "50-failed-subtests-report.js");
      const script = `
        const { run } = require("node:test");
        (async () => {
          for await (const { type, data } of run({ files: [${JSON.stringify(fixture)}] })) {
            if (type !== "test:fail") continue;
            const { error, type: kind } = data.details;
            if (error.failureType !== "subtestsFailed") continue;
            console.log("ROW " + JSON.stringify([data.name, kind, error.message, error.cause?.message]));
          }
        })();
      `;
      await using proc = spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const rows = stdout
        .split("\n")
        .filter(line => line.startsWith("ROW "))
        .map(line => JSON.parse(line.slice(4)));
      // [name, kind, message, message of the cause]. An inline suite reports no cause.
      expect({ rows, stderr }).toEqual({
        rows: [
          ["table", "test", "1 subtest failed", 'Expected "actual" to be strictly unequal to: 2'],
          ["two", "test", "2 subtests failed", "first error"],
          ["outer", "test", "2 subtests failed", "leaf-1 error"],
          ["deep", "test", "1 subtest failed", "2 subtests failed"],
          ["suite", "suite", "2 subtests failed", null],
          ["globals", "test", "2 subtests failed", "inner error"],
          ["after-suite", "suite", "2 subtests failed", null],
          ["throwing-suite", "suite", "1 subtest failed", null],
          ["rejecting-suite", "suite", "1 subtest failed", null],
          ["before-suite", "suite", "2 subtests failed", null],
          ["suite-own", "test", "4 subtests failed", "after-kid error"],
          // A thrown error that carries this failureType itself.
          ["looks-synthetic", "test", "user error", null],
          ["odd-values", "test", "6 subtests failed", "0"],
          ["late", "test", "1 subtest failed", "mid error"],
          ["runner-made", "test", "2 subtests failed", "plan expected 1 assertions but received 0"],
          ["hook-state", "test", "2 subtests failed", "first kid"],
          ["suite", "suite", "1 subtest failed", null],
          ["hook-state-suite-first", "test", "2 subtests failed", "suite kid"],
          ["hook-state-one", "test", "1 subtest failed", "only kid"],
          ["mid", "test", "1 subtest failed", "nested leaf"],
          ["hook-state-nested", "test", "1 subtest failed", "1 subtest failed"],
        ],
        stderr: "",
      });
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "should fail a retried test for a subtest that failed after the first attempt had ended",
    async () => {
      const { exitCode, stderr } = await runTests(["51-failed-subtest-retry.js"], {}, ["--retry=1"]);
      expect(reportLines(stderr)).toEqual([
        "error: own error",
        "subtest failed: flaky-parent > kid",
        "error: kid error",
        "(fail) flaky-parent (attempt 2)",
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  test.concurrent(
    "should report the roll-up error when a subtest name cannot be joined into a name path",
    async () => {
      const { exitCode, stderr } = await runTests(["52-failed-subtest-unnamed.js"]);
      expect(reportLines(stderr)).toEqual(["error: 1 subtest failed", "error: kid error", "(fail) parent"]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

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
    // The runner builds the label, so the fixture's own source lines echoed in
    // the failure context cannot satisfy it.
    expect(stderr).toContain("subtest failed: p > c");
    expect(stderr).toContain("error: boom");
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

// The lines of a failure report that the runner writes itself: echoed fixture source cannot produce them.
function reportLines(stderr: string) {
  return stderr
    .split("\n")
    .map(line => line.trimStart().replace(/ \[[\d.]+m?s\]$/, ""))
    .filter(line => /^(subtest failed: |error: |AssertionError|\((fail|pass)\) )/.test(line));
}

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
