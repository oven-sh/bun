import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

// run() starts one `bun test` process for each file. That process ends as a Node.js process
// does, when its event loop has nothing left to do. With forceExit it gets node's
// --test-force-exit, and ends when its tests do.
//
// Each test here starts a bun process that starts another one. On a debug+ASAN build one of
// them takes several seconds to start, so the tests have more than the 5 seconds a test has by
// default, as the first tests of this file do.
describe("run() with forceExit", () => {
  // Gives file.test.mjs to run() and prints what came back: the tests that passed and failed,
  // the lines the file printed that start with "CHILD ", and the summary of the run.
  const runner = `
    import { existsSync } from "node:fs";
    import { run } from "node:test";

    const [options, reader] = process.argv.slice(2);
    const file = "file.test.mjs";
    // The report-delivery files give their tests names of many kilobytes.
    const name = data =>
      data.name === file ? "<file>" : data.name.length > 99 ? data.name.slice(0, data.name.indexOf(" ")) : data.name;
    const result = { pass: [], fail: [], stdout: [], summary: null, readLate: false };
    for await (const { type, data } of run({ files: [file], ...JSON.parse(options) })) {
      if (reader === "late" && !result.readLate && type === "test:pass") {
        // Read no more until the process of the file is at its exit. Its report is larger than
        // its stdout takes, so most of it is then still inside that process.
        const deadline = Date.now() + 20_000;
        const cell = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync("at-exit")) {
          if (Date.now() > deadline) throw new Error("the process of the file did not reach its exit");
          Atomics.wait(cell, 0, 0, 5);
        }
        result.readLate = true;
      }
      if (type === "test:pass") {
        result.pass.push(name(data));
      } else if (type === "test:fail") {
        result.fail.push([name(data), data.details.error.failureType]);
      } else if (type === "test:stdout") {
        for (const line of data.message.split("\\n")) if (line.startsWith("CHILD ")) result.stdout.push(line);
      } else if (type === "test:summary" && data.file === undefined) {
        const { tests, passed, failed } = data.counts;
        result.summary = { success: data.success, tests, passed, failed };
      }
    }
    // The option ends the process of a file, not the process that called run().
    await new Promise(resolve => setImmediate(resolve));
    console.log("RESULT " + JSON.stringify(result));
  `;

  // A test file that itself runs under run() has NODE_TEST_CONTEXT, and run() starts nothing there.
  const { NODE_TEST_CONTEXT: _, ...env } = bunEnv;

  async function runFile(source: string, options: object = {}, reader: "prompt" | "late" = "prompt") {
    using dir = tempDir("node-test-run-force-exit", { "runner.mjs": runner, "file.test.mjs": source });
    await using proc = spawn({
      cmd: [bunExe(), "runner.mjs", JSON.stringify(options), reader],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const line = stdout.split("\n").find(line => line.startsWith("RESULT "));
    if (line === undefined)
      throw new Error(`no RESULT line\nexit code: ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`);
    // signalCode is null when the process ended by itself: a run() that never ends is killed by the test's timeout.
    return { ...JSON.parse(line.slice("RESULT ".length)), exitCode, signalCode: proc.signalCode };
  }

  const passed = (tests: number) => ({ success: true, tests, passed: tests, failed: 0 });
  const ended = { readLate: false, exitCode: 0, signalCode: null };
  // 'exit' listeners run at a forced exit, as for process.exit(). 'beforeExit' is for an event
  // loop that ran dry, so a file that prints it was not forced.
  const listeners = `
    process.on("beforeExit", () => console.log("CHILD beforeExit"));
    process.on("exit", code => console.log("CHILD exit " + code));
  `;

  test.concurrent.each([
    [{ forceExit: true }, ["--test-force-exit"]],
    [{ forceExit: true, execArgv: ["--smol"] }, ["--test-force-exit", "--smol"]],
    // Node.js reads the flag in the process of the file, so the execArgv option can carry it too.
    [{ execArgv: ["--test-force-exit"] }, ["--test-force-exit"]],
  ])(
    "%j: a file that keeps its event loop active ends when its tests do",
    async (options, execArgv) => {
      const file = `
        import { test } from "node:test";
        setInterval(() => {}, 1000);
        ${listeners}
        test("x", () => console.log("CHILD execArgv " + JSON.stringify(process.execArgv)));
      `;
      expect(await runFile(file, options)).toEqual({
        pass: ["x"],
        fail: [],
        stdout: ["CHILD execArgv " + JSON.stringify(execArgv), "CHILD exit 0"],
        summary: passed(1),
        ...ended,
      });
    },
    30_000,
  );

  test.concurrent(
    "every test that is known runs to its end, and so do the root after() hooks",
    async () => {
      const file = `
        import { after, test } from "node:test";
        import { createServer } from "node:http";
        createServer(() => {}).listen(0);
        ${listeners}
        after(() => console.log("CHILD root after"));
        test("async", async () => {
          await new Promise(resolve => setImmediate(resolve));
          console.log("CHILD async done");
        });
        test("parent", async t => {
          await t.test("sub", async () => {
            await new Promise(resolve => setImmediate(resolve));
          });
        });
        // A handle that would add a test later. The exit does not wait for it.
        setTimeout(() => test("late", () => {}), 2 ** 31 - 1);
      `;
      expect(await runFile(file, { forceExit: true })).toEqual({
        pass: ["async", "sub", "parent"],
        fail: [],
        stdout: ["CHILD async done", "CHILD root after", "CHILD exit 0"],
        summary: passed(3),
        ...ended,
      });
    },
    30_000,
  );

  test.concurrent(
    "a failed test fails the run, and what it scheduled for later does not run",
    async () => {
      // test/fixtures/test-runner/throws_sync_and_async.js of Node.js, with a timer that is further away.
      const file = `
        import { test } from "node:test";
        ${listeners}
        test("passes", () => {});
        test("fails and schedules more work", () => {
          setTimeout(() => {
            console.log("CHILD this should not have a chance to be thrown");
          }, 2 ** 31 - 1);
          throw new Error("fails");
        });
      `;
      expect(await runFile(file, { forceExit: true })).toEqual({
        pass: ["passes"],
        fail: [["fails and schedules more work", "testCodeFailure"]],
        stdout: ["CHILD exit 1"],
        summary: { success: false, tests: 2, passed: 1, failed: 1 },
        ...ended,
      });
    },
    30_000,
  );

  test.concurrent(
    "the exit code of the file is kept",
    async () => {
      const file = `
        import { test } from "node:test";
        setInterval(() => {}, 1000);
        ${listeners}
        process.exitCode = 7;
        test("x", () => {});
      `;
      expect(await runFile(file, { forceExit: true })).toEqual({
        pass: ["x"],
        // A file whose tests pass and that still exits with an error is itself the failed test.
        fail: [["<file>", "testCodeFailure"]],
        stdout: ["CHILD exit 7"],
        summary: { success: false, tests: 2, passed: 1, failed: 1 },
        ...ended,
      });
    },
    30_000,
  );

  test.concurrent(
    "a file with only skipped and todo tests ends too",
    async () => {
      const file = `
        import { test } from "node:test";
        setInterval(() => {}, 1000);
        ${listeners}
        test.skip("skipped", () => {});
        test.todo("todo");
      `;
      expect(await runFile(file, { forceExit: true })).toEqual({
        pass: ["skipped", "todo"],
        fail: [],
        stdout: ["CHILD exit 0"],
        summary: { success: true, tests: 2, passed: 0, failed: 0 },
        ...ended,
      });
    },
    30_000,
  );

  // Node.js ends the process from its root test, when the last test of the file is done. A file
  // without a test has no such moment, and ends as without the option: after its event loop.
  describe("a file without a test is not forced", () => {
    test.concurrent.each([
      [
        "a timer",
        `setTimeout(() => {
          console.log("CHILD timer");
          process.exitCode = 1;
        }, 1);`,
        ["CHILD timer"],
      ],
      // As common.mustCall() of the Node.js tests does.
      [
        "an 'exit' listener",
        `process.on("exit", () => {
          console.log("CHILD exit check");
          process.exitCode = 1;
        });`,
        ["CHILD exit check"],
      ],
    ])(
      "it still fails from %s",
      async (_, failure, stdout) => {
        expect(await runFile(failure, { forceExit: true })).toEqual({
          pass: [],
          fail: [["<file>", "testCodeFailure"]],
          stdout,
          summary: { success: false, tests: 1, passed: 0, failed: 1 },
          ...ended,
        });
      },
      30_000,
    );

    test.concurrent(
      "root hooks alone run, and the file ends",
      async () => {
        const file = `
          import { after, before } from "node:test";
          before(() => console.log("CHILD before"));
          after(() => console.log("CHILD after"));
          process.on("exit", code => console.log("CHILD exit " + code));
        `;
        expect(await runFile(file, { forceExit: true })).toEqual({
          pass: ["<file>"],
          fail: [],
          stdout: ["CHILD before", "CHILD after", "CHILD exit 0"],
          summary: passed(1),
          ...ended,
        });
      },
      30_000,
    );
  });

  test.concurrent.each([[{}], [{ forceExit: false }]])(
    "%j: a file waits for its event loop",
    async options => {
      const file = `
        import { test } from "node:test";
        process.on("exit", code => console.log("CHILD exit " + code));
        test("x", () => {
          setTimeout(() => console.log("CHILD timer"), 1);
        });
      `;
      expect(await runFile(file, options)).toEqual({
        pass: ["x"],
        fail: [],
        stdout: ["CHILD timer", "CHILD exit 0"],
        summary: passed(1),
        ...ended,
      });
    },
    30_000,
  );

  // The file reports each test on its stdout, and its report is larger than that stdout takes
  // at once. A process that ends without the event loop wait must still write all of it.
  describe("the whole report arrives", () => {
    const count = 64;
    const names = Array.from({ length: count }, (_, i) => String(i));
    const tests = `
      import { writeFileSync } from "node:fs";
      import { test } from "node:test";
      process.on("exit", () => writeFileSync("at-exit", ""));
      const pad = Buffer.alloc(16 * 1024, "x").toString();
      for (let i = 0; i < ${count}; i++) test(i + " " + pad, () => {});
    `;
    // A Windows pipe is written synchronously: the file cannot get to its exit before all of
    // its report is read, so there the reader keeps up.
    const reader = isWindows ? "prompt" : "late";
    const delivered = { stdout: [], readLate: !isWindows, exitCode: 0, signalCode: null };

    test.concurrent(
      "from a file that forceExit ends",
      async () => {
        const file = `
          ${tests}
          setInterval(() => {}, 1000);
        `;
        expect(await runFile(file, { forceExit: true }, reader)).toEqual({
          pass: names,
          fail: [],
          summary: passed(count),
          ...delivered,
        });
      },
      30_000,
    );

    test.concurrent(
      "from a file whose event loop wait an unhandled rejection cuts short",
      async () => {
        const file = `
          ${tests}
          Promise.reject(new Error("unhandled"));
        `;
        expect(await runFile(file, {}, reader)).toEqual({
          pass: names,
          fail: [["<file>", "testCodeFailure"]],
          summary: { success: false, tests: count + 1, passed: count, failed: 1 },
          ...delivered,
        });
      },
      30_000,
    );
  });

  // The forceExit cases of test/parallel/test-runner-run.mjs of Node.js.
  test("forceExit is a boolean, and not for watch mode", () => {
    for (const forceExit of [Symbol(), {}, 0, 1, "1", Promise.resolve([])] as unknown[]) {
      expect(() => run({ forceExit: forceExit as boolean })).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: expect.stringMatching(/The "options\.forceExit" property must be of type boolean\./),
        }),
      );
    }
    expect(() => run({ forceExit: true, watch: true })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: expect.stringMatching(/The property 'options\.forceExit' is not supported with watch mode\./),
      }),
    );
  });
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
