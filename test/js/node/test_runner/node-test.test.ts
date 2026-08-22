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

// Drives node:test's run() over the given files and digests its stream: every
// test:pass/test:fail verdict in order (name, details.type, directive, error),
// the `suites N` diagnostic, the per-file and run-level test:summary (the fields
// suite reporting affects) and the children's stdout.
const kRunDriver = `
  import { basename } from "node:path";
  import { run } from "node:test";

  const out = { verdicts: [], suitesDiagnostic: undefined, summaries: {}, stdout: "" };
  for await (const { type, data } of run({ files: process.argv.slice(2) })) {
    if (type === "test:pass" || type === "test:fail") {
      const verdict = { type, name: data.name, kind: data.details.type };
      if (data.skip !== undefined) verdict.skip = data.skip;
      if (data.todo !== undefined) verdict.todo = data.todo;
      const { error } = data.details;
      if (error !== undefined) {
        verdict.error = error.message;
        if (error.failureType !== undefined) verdict.failureType = error.failureType;
        if (error.cause !== undefined) verdict.cause = error.cause.message;
      }
      out.verdicts.push(verdict);
    } else if (type === "test:diagnostic" && data.message.startsWith("suites ")) {
      out.suitesDiagnostic = data.message;
    } else if (type === "test:summary") {
      const { tests, suites, passed, failed, skipped, todo } = data.counts;
      out.summaries[data.file === undefined ? "<run>" : basename(data.file)] = {
        success: data.success,
        tests,
        suites,
        passed,
        failed,
        skipped,
        todo,
      };
    } else if (type === "test:stdout") {
      out.stdout += data.message;
    }
  }
  console.log(JSON.stringify(out));
`;

type RunVerdict = {
  type: "test:pass" | "test:fail";
  name: string;
  kind: "test" | "suite";
  skip?: boolean | string;
  todo?: boolean | string;
  error?: string;
  failureType?: string;
  cause?: string;
};

type RunDigest = {
  verdicts: RunVerdict[];
  suitesDiagnostic: string | undefined;
  summaries: Record<string, Record<string, number | boolean>>;
  stdout: string;
};

async function digestRun(files: Record<string, string>): Promise<RunDigest> {
  using dir = tempDir("node-test-run", { ...files, "driver.mjs": kRunDriver });
  await using proc = spawn({
    cmd: [bunExe(), "driver.mjs", ...Object.keys(files)],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

describe("node:test run()", () => {
  // Unless a comment says otherwise, every expectation below is what node
  // v26.3.0 reports for the same file. Two shape differences hold throughout:
  // bun's child does not label test code failures with failureType
  // "testCodeFailure", and it attaches the first failure as the cause of a
  // "N subtests failed" error where node repeats the message.
  //
  // Each case spawns a driver process that in turn spawns one debug+ASAN
  // `bun test` child (about 4.5s locally), hence the generous timeouts.
  test.concurrent(
    "reports a verdict for every suite registered with bun:test, after its children, and counts it in suites",
    async () => {
      const { verdicts, suitesDiagnostic, summaries } = await digestRun({
        "suites.js": `
          const { describe, it, test, suite } = require("node:test");

          describe.skip("skipped suite", () => {
            it("never declared", () => {});
          });

          describe("outer", () => {
            it("ok", () => {});
            describe("inner", () => {
              it("bad", () => {
                throw new Error("bad child");
              });
            });
            it("ok2", () => {});
          });

          suite("empty suite", () => {});

          describe.todo("todo suite", () => {
            it("fails inside a todo suite", () => {
              throw new Error("x");
            });
          });

          describe("suite with directives", () => {
            it.todo("todo child", () => {
              throw new Error("y");
            });
            it("skipped child", { skip: "why" }, () => {});
          });

          test("parent test", () => {
            describe("inline suite", () => {
              it("inline child", () => {});
            });
          });
        `,
      });

      expect(verdicts).toEqual([
        { type: "test:pass", name: "skipped suite", kind: "suite", skip: true },
        { type: "test:pass", name: "ok", kind: "test" },
        { type: "test:fail", name: "bad", kind: "test", error: "bad child" },
        // A failing child fails its suite, and that failure the enclosing suite.
        {
          type: "test:fail",
          name: "inner",
          kind: "suite",
          error: "1 subtest failed",
          failureType: "subtestsFailed",
          cause: "bad child",
        },
        { type: "test:pass", name: "ok2", kind: "test" },
        {
          type: "test:fail",
          name: "outer",
          kind: "suite",
          error: "1 subtest failed",
          failureType: "subtestsFailed",
          cause: "1 subtest failed",
        },
        { type: "test:pass", name: "empty suite", kind: "suite" },
        // Children of a todo suite are todo themselves, so their failures do
        // not fail it; the suite reports after them, carrying the directive.
        { type: "test:fail", name: "fails inside a todo suite", kind: "test", todo: true, error: "x" },
        { type: "test:pass", name: "todo suite", kind: "suite", todo: true },
        { type: "test:fail", name: "todo child", kind: "test", todo: true, error: "y" },
        { type: "test:pass", name: "skipped child", kind: "test", skip: "why" },
        { type: "test:pass", name: "suite with directives", kind: "suite" },
        { type: "test:pass", name: "inline child", kind: "test" },
        { type: "test:pass", name: "inline suite", kind: "suite" },
        { type: "test:pass", name: "parent test", kind: "test" },
      ]);
      expect(suitesDiagnostic).toBe("suites 7");
      const counts = { success: false, tests: 8, suites: 7, passed: 4, failed: 1, skipped: 1, todo: 2 };
      expect(summaries).toEqual({ "suites.js": counts, "<run>": counts });
    },
    60_000,
  );

  test.concurrent(
    "a failing after() hook fails its suite and the run, and is not mistaken for a file-level failure",
    async () => {
      const { verdicts, summaries, stdout } = await digestRun({
        "after-hook.js": `
          const { describe, it, after } = require("node:test");

          describe("suite", () => {
            after(() => {
              throw new Error("after boom");
            });
            after(() => {
              console.log("SECOND_AFTER_HOOK_RAN");
            });
            it("ok", () => {});
          });
        `,
      });

      // The child exits nonzero over the hook, but the suite's own verdict
      // accounts for that: no synthesized verdict for after-hook.js itself.
      expect(verdicts).toEqual([
        { type: "test:pass", name: "ok", kind: "test" },
        {
          type: "test:fail",
          name: "suite",
          kind: "suite",
          error: "failed running after hook",
          failureType: "hookFailed",
          cause: "after boom",
        },
      ]);
      // `failed` counts tests only; the failed suite still makes the run fail.
      const counts = { success: false, tests: 1, suites: 1, passed: 1, failed: 0, skipped: 0, todo: 0 };
      expect(summaries).toEqual({ "after-hook.js": counts, "<run>": counts });
      // node stops at the first failing hook.
      expect(stdout).not.toContain("SECOND_AFTER_HOOK_RAN");
    },
    60_000,
  );

  test.concurrent(
    "a todo suite's own failures are reported on the suite but do not fail the run",
    async () => {
      const { verdicts, summaries } = await digestRun({
        "todo-suites.js": `
          const { describe, it, before, after } = require("node:test");

          describe.todo("before fails", () => {
            before(() => {
              throw new Error("before boom");
            });
            it("child of before-fails", () => {});
          });

          describe("after fails", { todo: "later" }, () => {
            after(() => {
              throw new Error("after boom");
            });
            it("child of after-fails", () => {});
          });

          describe.todo("callback throws", () => {
            it("child of callback-throws", () => {});
            throw new Error("todo build boom");
          });
        `,
      });

      expect(verdicts).toEqual([
        // node cancels the children of the first and third suite instead
        // (test:fail, still todo); bun:test has no way to cancel a test yet, so
        // they run. Either way they are counted as todo.
        { type: "test:pass", name: "child of before-fails", kind: "test", todo: true },
        {
          type: "test:fail",
          name: "before fails",
          kind: "suite",
          todo: true,
          error: "failed running before hook",
          failureType: "hookFailed",
          cause: "before boom",
        },
        { type: "test:pass", name: "child of after-fails", kind: "test", todo: true },
        {
          type: "test:fail",
          name: "after fails",
          kind: "suite",
          todo: "later",
          error: "failed running after hook",
          failureType: "hookFailed",
          cause: "after boom",
        },
        { type: "test:pass", name: "child of callback-throws", kind: "test", todo: true },
        { type: "test:fail", name: "callback throws", kind: "suite", todo: true, error: "todo build boom" },
      ]);
      // Nothing here makes the child process exit nonzero, so the file gets no
      // synthesized verdict and the run succeeds, as in node.
      const counts = { success: true, tests: 3, suites: 3, passed: 0, failed: 0, skipped: 0, todo: 3 };
      expect(summaries).toEqual({ "todo-suites.js": counts, "<run>": counts });
    },
    60_000,
  );

  test.concurrent(
    "a failing before() hook fails its suite",
    async () => {
      const { verdicts, summaries, stdout } = await digestRun({
        "before-hook.js": `
          const { describe, it, before, after } = require("node:test");

          describe("suite", () => {
            before(() => {
              throw new Error("before boom");
            });
            after(() => {
              console.log("AFTER_HOOK_RAN");
            });
            it("child", () => {});
          });
        `,
      });

      // What becomes of the child is bun:test's call (node cancels it), so only
      // the suite's own verdict is pinned here.
      expect(verdicts.filter(verdict => verdict.kind === "suite")).toEqual([
        {
          type: "test:fail",
          name: "suite",
          kind: "suite",
          error: "failed running before hook",
          failureType: "hookFailed",
          cause: "before boom",
        },
      ]);
      expect(verdicts.map(verdict => verdict.name)).not.toContain("before-hook.js");
      expect(summaries["before-hook.js"]).toMatchObject({ success: false, suites: 1, failed: 0 });
      expect(summaries["<run>"]).toMatchObject({ success: false, suites: 1, failed: 0 });
      // node runs the after hooks of a suite whose before hook failed.
      expect(stdout).toContain("AFTER_HOOK_RAN");
    },
    60_000,
  );

  test.concurrent(
    "a describe() callback that throws or rejects fails its suite, which fails the enclosing suite",
    async () => {
      const { verdicts, suitesDiagnostic, summaries } = await digestRun({
        "build-failures.js": `
          const { describe, it, test } = require("node:test");

          describe("outer", () => {
            it("ok", () => {});
            describe("inner", () => {
              throw new Error("build boom");
            });
          });

          describe("async", async () => {
            await Promise.resolve();
            throw new Error("async build boom");
          });

          test("sibling", () => {});
        `,
      });

      // bun:test drops a scope whose callback threw, so such a suite is reported
      // as soon as it is declared rather than in node's execution order; compare
      // by name.
      const expected: RunVerdict[] = [
        { type: "test:fail", name: "async", kind: "suite", error: "async build boom" },
        { type: "test:fail", name: "inner", kind: "suite", error: "build boom" },
        { type: "test:pass", name: "ok", kind: "test" },
        {
          type: "test:fail",
          name: "outer",
          kind: "suite",
          error: "1 subtest failed",
          failureType: "subtestsFailed",
          cause: "build boom",
        },
        { type: "test:pass", name: "sibling", kind: "test" },
      ];
      const byName = (a: RunVerdict, b: RunVerdict) => a.name.localeCompare(b.name);
      expect(verdicts.toSorted(byName)).toEqual(expected.toSorted(byName));
      expect(suitesDiagnostic).toBe("suites 3");
      const counts = { success: false, tests: 2, suites: 3, passed: 2, failed: 0, skipped: 0, todo: 0 };
      expect(summaries).toEqual({ "build-failures.js": counts, "<run>": counts });
    },
    60_000,
  );
});

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
