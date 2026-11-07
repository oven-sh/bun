import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { run } from "node:test";

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

  // The fixtures from here on log what they observe, and the tests compare those lines exactly. Where a
  // fixture also runs under Node, the expected lines are what `node <fixture>` (v26.3.0) prints.
  test.concurrent(
    "should abort t.signal and enforce the timeout and signal options of a test like Node",
    async () => {
      const { lines, counts, exitCode } = observed(await runTests(["30-signal-abort.js"]));
      expect(lines).toEqual(
        linesOf(`
          abort event reason=AbortError passed=false error=test timed out after 1ms aborted=true
          afterEach(times out) passed=false error=test timed out after 1ms aborted=true
          t.after passed=false error=test timed out after 1ms aborted=true
          abort event
          afterEach(times out with the timeout it was declared with) passed=false error=test timed out after 1ms aborted=true
          afterEach(passes) passed=true error=null aborted=false
          t.after passed=true error=null aborted=false same=true
          abort event after the hooks
          afterEach(throws) passed=false error=boom aborted=false
          abort event after the hooks
          afterEach(never reads its signal) passed=true error=null aborted=false
          passing aborted=true reason=AbortError
          unread aborted=true same=true
          afterEach(reads them afterwards) passed=true error=null aborted=false
          own signal=true
          abort event reason=AbortError passed=false error=stop right there aborted=true
          afterEach(aborted while running) passed=false error=stop right there aborted=true
          t.after failureType=testAborted error is the reason=true
          afterEach(aborted with a falsy reason) passed=false error=The test was aborted aborted=true
          t.after name=AbortError code=ABORT_ERR
          afterEach(aborted, then throws) passed=false error=the abort came first aborted=true
          afterEach(throws, then aborted in a microtask) passed=false error=the throw came first aborted=false
          afterEach(aborted with a timeout as well) passed=false error=the reason wins aborted=true
          afterEach(aborted, callback style) passed=false error=callback reason aborted=true
          none
          afterEach(hooks of the tests that never started) passed=true error=null aborted=false
          body starts aborted=true
          afterEach(aborted during beforeEach) passed=false error=beforeEach reason aborted=true
          afterEach(aborted during afterEach) passed=false error=afterEach reason aborted=true
          afterEach(aborted during t.after) passed=true error=null aborted=false
          t.after passed=false error=t.after reason aborted=true
          listeners on its signal while it runs: 1
          afterEach(finished) passed=true error=null aborted=false
          listeners on its signal afterwards: 0
          finished passed=true error=null
          afterEach(aborted after it finished) passed=true error=null aborted=false
          body ran
          afterEach(resolves later) passed=false error=aborted while the runner waits for the body aborted=true
          afterEach(rejects later) passed=false error=aborted while the runner waits for the body aborted=true
          afterEach(aborted before its first await, rejects later) passed=false error=aborted before the runner waits for the body aborted=true
          afterEach(calls back later) passed=false error=aborted while the runner waits for the callback aborted=true
          afterEach(times out while the runner waits for its plan) passed=false error=test timed out after 1ms aborted=true
          resolves later: the body goes on
          rejects later: the body goes on
          aborted before its first await, rejects later: the body goes on
          calls back later: the body goes on
          afterEach(every body goes on) passed=true error=null aborted=false
          abort event
          afterEach(subtest aborted while running) passed=false error=subtest reason aborted=true
          abort event
          afterEach(subtest that times out) passed=false error=test timed out after 1ms aborted=true
          t.test() resolved with undefined
          suite signal aborted=false
        `),
      );
      expect({ counts, exitCode }).toEqual({ counts: ["9 pass", "22 fail"], exitCode: 1 });
    },
    30_000,
  );

  test.concurrent(
    "should cancel the subtests that a test did not wait for like Node",
    async () => {
      const { lines, counts, exitCode } = observed(await runTests(["31-cancelled-by-parent.js"]));
      // A cancelled subtest finishes on its own promise chain while the runner moves on, so the order of
      // the lines across tests is not the same in bun and in Node, and is not compared.
      expect(lines.toSorted()).toEqual(
        linesOf(`
          parent t.after the running subtest is aborted=false
          running: abort event passed=false error=test did not finish before its parent and was cancelled aborted=true
          grandchild: abort event
          queued suite: abort event
          afterEach(running) passed=false error=test did not finish before its parent and was cancelled aborted=true
          afterEach(grandchild) passed=false error=test did not finish before its parent and was cancelled aborted=true
          running: t.after failureType=cancelledByParent
          afterEach(running) passed=false error=test did not finish before its parent and was cancelled aborted=true
          child of the parent that throws: abort event
          beforeEach ends
          child of the parent that throws: t.after passed=false error=test did not finish before its parent and was cancelled aborted=true
          running: t.after store=the caller's store
          child body starts
          afterEach(child) passed=false error=test did not finish before its parent and was cancelled aborted=true
          afterEach(first) passed=true error=null aborted=false
          parent t.after ends
          second: abort event
          afterEach(second) passed=false error=test did not finish before its parent and was cancelled aborted=true
          beforeEach(oldest) aborted=true
          oldest body starts
          afterEach(oldest) passed=false error=test did not finish before its parent and was cancelled aborted=true
          afterEach(rejects later) passed=false error=test did not finish before its parent and was cancelled aborted=true
          running suite: after hook
          resolves later: t.after passed=false error=test did not finish before its parent and was cancelled aborted=true
          rejects later: the body goes on
          suite child: the body goes on
          afterEach(planned) passed=false error=test did not finish before its parent and was cancelled aborted=true
          planned: the body goes on
        `).toSorted(),
      );
      expect({ counts, exitCode }).toEqual({ counts: ["3 pass", "10 fail"], exitCode: 1 });
    },
    30_000,
  );

  test.concurrent(
    "should report the subtests and suites that a test cancelled through run()",
    async () => {
      const events = await run({
        files: [join(import.meta.dirname, "fixtures", "31-cancelled-by-parent.js")],
      }).toArray();
      const cancelled = events
        .filter(({ type, data }) => type === "test:fail" && data.details.error.failureType === "cancelledByParent")
        .map(({ data }) => data.name);
      // The names that run() in Node reports with this failureType for the same file.
      expect(cancelled.toSorted()).toEqual([
        "child",
        "grandchild",
        "next",
        "oldest",
        "planned",
        "queued",
        "queued empty suite",
        "queued suite",
        "rejects later",
        "resolves later",
        "running",
        "running",
        "running",
        "running suite",
        "second",
        "suite",
        "suite child",
      ]);
    },
    30_000,
  );

  test.concurrent(
    "should give every --retry attempt of a test its own state",
    async () => {
      const { lines, counts, exitCode } = observed(await runTests(["32-retry.js"], {}, ["--retry", "1"]));
      expect(lines).toEqual(
        linesOf(`
          t.signal: attempt 1 aborted=false previous attempt aborted=undefined
          t.signal: attempt 2 aborted=false previous attempt aborted=true
          subtests: attempt 1 child runs=1
          subtests: attempt 2 child runs=2
          t.after(): hook of attempt 1 runs=1
          t.after(): hook of attempt 2 runs=2
          timeout: abort event of attempt 1
          timeout: the body of attempt 1 goes on aborted=true
          timeout: attempt 2 aborted=false
          timeout: abort event of attempt 2
        `),
      );
      expect({ counts, exitCode }).toEqual({ counts: ["5 pass", "0 fail"], exitCode: 0 });
    },
    30_000,
  );

  test.concurrent(
    "should drop the failure of a --retry attempt that bun:test's own timeout replaced",
    async () => {
      const args = ["--retry", "1", "--timeout", "1"];
      const { lines, counts, exitCode } = observed(await runTests(["33-retry-abandoned-attempt.js"], {}, args));
      expect(lines).toEqual([
        "t.after of the first attempt",
        "runs once: attempts of the other test=2 runs of this test=1",
      ]);
      expect({ counts, exitCode }).toEqual({ counts: ["1 pass", "1 fail"], exitCode: 1 });
    },
    30_000,
  );

  test.concurrent(
    "should abort the t.signal of each test on its own under --concurrent",
    async () => {
      const { lines, counts, exitCode } = observed(await runTests(["34-concurrent.js"], {}, ["--concurrent"]));
      expect(lines.toSorted()).toEqual([
        "first: abort event",
        "first: body ends aborted=false",
        "second: abort event",
        "second: body ends aborted=false",
      ]);
      expect({ counts, exitCode }).toEqual({ counts: ["2 pass", "0 fail"], exitCode: 0 });
    },
    30_000,
  );

  test.concurrent(
    "should make no AbortController for a test that never reads t.signal",
    async () => {
      const { lines, counts, exitCode } = observed(await runTests(["35-unread-signal.js"]));
      expect(lines).toEqual([
        "contexts=8 controllers made=0",
        "controllers made=8 aborted: plain=true, with a timeout=true, with hooks, subtests and a suite=true, " +
          "subtest=true, suite=false, suite child=true, subtest that nothing awaits=true, that times out=true",
      ]);
      expect({ counts, exitCode }).toEqual({ counts: ["5 pass", "1 fail"], exitCode: 1 });
    },
    30_000,
  );
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

// The lines a fixture logged with its "OBS " prefix, and the counts that `bun test` printed at the end.
function observed({ exitCode, stdout, stderr }: Awaited<ReturnType<typeof runTests>>) {
  const lines = linesOf(stdout)
    .filter(line => line.startsWith("OBS "))
    .map(line => line.slice(4));
  const counts = linesOf(stderr).filter(line => /^\d+ (pass|fail|skip|todo|errors?)$/.test(line));
  return { lines, counts, exitCode };
}

function linesOf(text: string) {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "");
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
