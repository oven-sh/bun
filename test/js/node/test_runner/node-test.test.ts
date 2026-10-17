import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { join } from "node:path";

// A fixture that states what Node does is run on Node too. The reference is
// the Node version that bun reports: not any other `node` on PATH, and not
// the `node` shim that `bun run` puts there, which is bun.
const referenceNode = (() => {
  const node = nodeExe();
  if (!node) return null;
  const { stdout, exitCode } = spawnSync({
    cmd: [node, "-p", "process.versions.bun ? '' : process.versions.node"],
    env: bunEnv,
    stderr: "ignore",
  });
  return exitCode === 0 && stdout.toString().trim() === process.versions.node ? node : null;
})();

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

  test("should capture plan at first t.assert access and fail a subtest started after its parent finished", async () => {
    const { exitCode, stderr } = await runTests(["16-plan-and-late-subtest.js"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("1 todo");
    // The late subtest is the one failure. The test that created it passes: its promise resolved.
    expect(stderr).toContain("(fail) late");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
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

async function runTestsOnNode(filenames: string[]) {
  const testPaths = filenames.map(filename => join(import.meta.dirname, "fixtures", filename));
  await using proc = spawn({
    cmd: [referenceNode!, "--test", ...testPaths],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
  return { exitCode, stdout, stderr };
}

// The message of the failure that Node gives a subtest created after its parent finished.
const kLateSubtestMessage = "test could not be started because its parent finished";

// A fixture prints what it observed as one `EVENTS [...]` line when the process exits.
function eventsOf(stdout: string): string[] {
  const line = stdout.split("\n").find(line => line.startsWith("EVENTS "));
  return line === undefined ? [] : JSON.parse(line.slice("EVENTS ".length));
}

// The totals of `node --test`, its exit code, and the events of the fixture.
async function onNode(filename: string) {
  const { stdout, exitCode } = await runTestsOnNode([filename]);
  const counts: Record<string, number> = {};
  for (const [, key, value] of stdout.matchAll(/ (pass|fail|cancelled|skipped|todo) (\d+)$/gm)) {
    counts[key] = Number(value);
  }
  return { counts, exitCode, events: eventsOf(stdout) };
}

// The totals that `bun test` prints, as one string.
function totalsOf(stderr: string) {
  return [...stderr.matchAll(/^ ?(\d+ (?:pass|skip|todo|fail))$/gm)].map(match => match[1]).join(", ");
}

describe.concurrent("a subtest created after its parent finished", () => {
  test("is reported as its own failed test", async () => {
    const { exitCode, stdout, stderr } = await runTests(["30-late-subtest.js"]);
    expect(stderr).toContain(kLateSubtestMessage);
    expect(stderr).toContain("(fail) late\n");
    expect(stderr).toContain("(skip) late skip\n");
    expect(stderr).toContain("(todo) late todo\n");
    expect(stderr).toContain("(fail) late, created last\n");
    expect(totalsOf(stderr)).toBe("3 pass, 1 skip, 1 todo, 2 fail");
    // Each promise resolves at once. bun does not run the body of a late
    // subtest while another test runs. Node runs it after that test.
    expect(eventsOf(stdout)).toEqual([
      "resolved undefined",
      "resolved undefined",
      "resolved undefined",
      "resolved undefined",
      "a later test",
    ]);
    expect(exitCode).toBe(1);
  }, 30_000);

  test.skipIf(!referenceNode)("is a failed test on node", async () => {
    const { counts, exitCode, events } = await onNode("30-late-subtest.js");
    expect(counts).toEqual({ pass: 3, fail: 2, cancelled: 0, skipped: 1, todo: 1 });
    expect(events.filter(event => event.startsWith("resolved"))).toHaveLength(4);
    expect(events.filter(event => event.startsWith("rejected"))).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test("every way to create it reports it", async () => {
    const { exitCode, stdout, stderr } = await runTests(["30b-late-subtest-spellings.js"]);
    expect(stderr).toContain("(fail) late through test()\n");
    // bun:test has no result for a suite, so a late suite is a failed test.
    expect(stderr).toContain("(fail) late suite\n");
    expect(stderr).toContain("(fail) late in a finished suite\n");
    expect(stderr).toContain("(fail) late on a finished subtest\n");
    // Node cancels the child of the late suite. Only the events of run() have a cancelled test.
    expect(stderr).not.toContain("child of late suite");
    expect(totalsOf(stderr)).toBe("4 pass, 4 fail");
    expect(eventsOf(stdout)).toEqual(["callback of late suite"]);
    expect(exitCode).toBe(1);
  }, 30_000);

  test.skipIf(!referenceNode)("every way to create it fails on node", async () => {
    const { counts, exitCode, events } = await onNode("30b-late-subtest-spellings.js");
    // The late suite is a failed suite: it is not in these totals of tests.
    expect(counts).toEqual({ pass: 6, fail: 3, cancelled: 1, skipped: 0, todo: 0 });
    expect(events).toEqual(["callback of late suite"]);
    expect(exitCode).toBe(1);
  });

  test("the example of Node's documentation fails", async () => {
    const { exitCode, stderr } = await runTests(["30c-late-subtest-docs-example.js"]);
    expect(stderr).toContain(kLateSubtestMessage);
    expect(stderr).toContain("(fail) subtest that is created too late\n");
    expect(totalsOf(stderr)).toBe("1 pass, 1 fail");
    expect(exitCode).toBe(1);
  }, 30_000);

  test.skipIf(!referenceNode)("the example of Node's documentation fails on node", async () => {
    const { counts, exitCode } = await onNode("30c-late-subtest-docs-example.js");
    expect(counts).toEqual({ pass: 1, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
    expect(exitCode).toBe(1);
  });

  test("is a failed test case of the JUnit reporter", async () => {
    using dir = tempDir("node-test-late-subtest-junit", {});
    const outfile = join(String(dir), "junit.xml");
    const { exitCode } = await runTests(["30c-late-subtest-docs-example.js"], {}, [
      "--reporter=junit",
      `--reporter-outfile=${outfile}`,
    ]);
    const xml = await Bun.file(outfile).text();
    expect(xml).toMatch(/<testcase name="subtest that is created too late"[^>]*>\s*<failure/);
    expect(xml).toContain(kLateSubtestMessage);
    expect(exitCode).toBe(1);
  }, 30_000);

  test("is a test:fail event of run()", async () => {
    using dir = tempDir("node-test-late-subtest-run", {
      "run.js": `
          const { run } = require("node:test");
          (async () => {
            const failed = [];
            let topLevel = 0;
            for await (const { type, data } of run({ files: [process.argv[2]] })) {
              if (type === "test:pass" && data.name === "parent") topLevel = data.nesting;
              if (type !== "test:fail") continue;
              failed.push([data.name, data.nesting - topLevel, data.details.type, data.details.error.failureType]);
            }
            console.log("FAILED " + JSON.stringify(failed));
          })();
        `,
    });
    const script = join(String(dir), "run.js");
    const fixture = join(import.meta.dirname, "fixtures", "30b-late-subtest-spellings.js");
    async function failedOn(exe: string) {
      await using proc = spawn({ cmd: [exe, script, fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const line = stdout.split("\n").find(line => line.startsWith("FAILED "));
      return { failed: line === undefined ? undefined : JSON.parse(line.slice("FAILED ".length)), exitCode };
    }
    const onBun = await failedOn(bunExe());
    expect(onBun).toEqual({
      failed: [
        ["late on a finished subtest", 0, "test", "parentAlreadyFinished"],
        ["late through test()", 0, "test", "parentAlreadyFinished"],
        ["child of late suite", 1, "test", "cancelledByParent"],
        ["late suite", 0, "suite", "parentAlreadyFinished"],
        ["late in a finished suite", 0, "test", "parentAlreadyFinished"],
      ],
      exitCode: 0,
    });
    if (referenceNode) expect(await failedOn(referenceNode)).toEqual(onBun);
  }, 30_000);
});

describe.concurrent("a subtest created by an afterEach or after hook", () => {
  test("runs as a subtest of the test that the hook belongs to", async () => {
    const { exitCode, stderr } = await runTests(["32-hook-window-subtests.js"]);
    expect(totalsOf(stderr)).toBe("3 pass, 0 fail");
    expect(exitCode).toBe(0);
  }, 30_000);

  test.skipIf(!referenceNode)("runs as a subtest on node", async () => {
    const { counts, exitCode } = await onNode("32-hook-window-subtests.js");
    expect(counts).toEqual({ pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    expect(exitCode).toBe(0);
  });

  test("fails that test when it fails", async () => {
    const { exitCode, stderr } = await runTests(["32b-hook-window-subtest-fails.js"]);
    expect(stderr).toContain("error: 1 subtest failed");
    expect(stderr).toContain("(fail) a failing subtest from an after hook");
    expect(totalsOf(stderr)).toBe("1 pass, 1 fail");
    expect(exitCode).toBe(1);
  }, 30_000);

  test.skipIf(!referenceNode)("fails that test on node", async () => {
    const { counts, exitCode } = await onNode("32b-hook-window-subtest-fails.js");
    expect(counts).toEqual({ pass: 1, fail: 2, cancelled: 0, skipped: 0, todo: 0 });
    expect(exitCode).toBe(1);
  });

  test("--retry gives each attempt its own subtests", async () => {
    const { exitCode, stdout, stderr } = await runTests(["33-retry-subtests.js"], {}, ["--retry", "1"]);
    expect(eventsOf(stdout)).toEqual(["attempt 1", "sub 1", "attempt 2", "sub 2"]);
    expect(totalsOf(stderr)).toBe("1 pass, 0 fail");
    expect(exitCode).toBe(0);
  }, 30_000);
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
