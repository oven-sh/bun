import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast, tempDir } from "harness";
import { dirname, join } from "node:path";
import { inspect } from "node:util";

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

describe("node:test run({ argv })", () => {
  const { run } = require("node:test");

  // The cases that must hold in Node.js too are in the fixture. It passes under `node` as it is.
  test.concurrent(
    "gives argv to each test file and applies none of it",
    async () => {
      const { exitCode, stderr } = await runTests(["32-run-argv.mjs"]);
      expect(stderr).toContain("6 pass");
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    120_000,
  );

  const node = nodeExeAtLeast("26.3.0");
  (node ? test.concurrent : test.skip)("the same cases pass in Node.js", async () => {
    await using proc = Bun.spawn({
      cmd: [node!, join(import.meta.dirname, "fixtures", "32-run-argv.mjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, output: "" });
  });

  /** What the children of one run() reported, as "<event> <test name>". A failure has its error too. */
  async function reported(stream: AsyncIterable<{ type: string; data: any }>) {
    const events: string[] = [];
    for await (const { type, data } of stream) {
      if ((type !== "test:pass" && type !== "test:fail") || data.details.type !== "test") continue;
      events.push(
        type === "test:pass" ? `${type} ${data.name}` : `${type} ${data.name}: ${data.details.error?.message}`,
      );
    }
    return events;
  }

  // A preload from bunfig.toml loads before one from `--preload`, so only the runtime can have set process.argv for it.
  test.concurrent(
    "a preload from bunfig.toml already reads argv",
    async () => {
      using dir = tempDir("node-test-run-argv-bunfig", {
        "bunfig.toml": `[test]\npreload = ["./preload.cjs"]\n`,
        "preload.cjs": `globalThis.preloadArgv = process.argv.slice(2);`,
        "a.test.mjs": `
          import { test } from "node:test";
          test(JSON.stringify(globalThis.preloadArgv), () => {});
        `,
      });
      const argv = ["--timeout", "1"];
      const stream = run({ files: ["a.test.mjs"], argv, cwd: String(dir), env: bunEnv });
      expect(await reported(stream)).toEqual([`test:pass ${JSON.stringify(argv)}`]);
    },
    30_000,
  );

  test.concurrent(
    "the workers of a `--parallel` child give argv to their files and apply none of it",
    async () => {
      // With `--only` applied, a worker does not run this test and the file is not written.
      const record = `
        import { test } from "node:test";
        import { writeFileSync } from "node:fs";
        test("record", () => writeFileSync(import.meta.filename + ".json", JSON.stringify(process.argv.slice(2))));
      `;
      using dir = tempDir("node-test-run-argv-parallel", {
        "tests/one.test.mjs": record,
        "tests/two.test.mjs": record,
      });
      const argv = ["--only", "", "x"];
      const stream = run({ files: ["tests"], argv, execArgv: ["--parallel=2"], cwd: String(dir), env: bunEnv });
      expect(await reported(stream)).not.toContainEqual(expect.stringContaining("test:fail"));
      expect({
        one: await Bun.file(join(String(dir), "tests/one.test.mjs.json")).json(),
        two: await Bun.file(join(String(dir), "tests/two.test.mjs.json")).json(),
      }).toEqual({ one: argv, two: argv });
    },
    30_000,
  );

  // The first argument of Node's command line that has a NUL, with Node's message. Node.js reports the error as the
  // `test:fail` of the file. Bun ends the stream with it, as for every child that it cannot start.
  test.concurrent.each([
    ["argv", { files: ["a.test.mjs"], argv: ["x", "a\0b"] }, "args[4]", "a\0b"],
    ["the file", { files: ["a\0b.test.mjs"], argv: ["x"] }, "args[2]", "a\0b.test.mjs"],
    ["execArgv and argv", { files: ["a.test.mjs"], execArgv: ["e\0e"], argv: ["a\0b"] }, "args[1]", "e\0e"],
  ])("a NUL in %s is the error of that argument of the command line", async (_, options, argument, value) => {
    using dir = tempDir("node-test-run-argv-nul", { "a.test.mjs": `` });
    const received = argument === "args[2]" ? join(String(dir), value) : value;
    const stream = run({ ...options, cwd: String(dir), env: bunEnv });
    await expect(reported(stream)).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_VALUE",
      message: `The argument '${argument}' must be a string without null bytes. Received ${inspect(received)}`,
    });
  });

  // run() hands argv to its child in BUN_INTERNAL_NODE_TEST_ARGV: the file that it starts the child for, then the
  // values, each as "<UTF-8 byte length>:<bytes>". The lines below are a child of run(), written out by hand.
  const kArgv = "BUN_INTERNAL_NODE_TEST_ARGV";
  const encode = (...entries: string[]) => entries.map(entry => `${Buffer.byteLength(entry)}:${entry}`).join("");
  // The name of the one test is what the file read in process.argv, and what it has of the variable.
  const readsArgv = `
    import { test } from "node:test";
    test(JSON.stringify([process.argv.slice(2), process.env.${kArgv} ?? null]), () => {});
  `;
  const asRunChild = { ...bunEnv, BUN_TEST_DRAIN_EVENT_LOOP: "1", NODE_TEST_CONTEXT: "child-v8" };

  /** Runs `bun test <file>` in the directory of the file, with `env`. */
  async function bunTest(file: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", file],
      env,
      cwd: dirname(file),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent(
    "a run() without argv keeps the variable that its own process has out of the child",
    async () => {
      using dir = tempDir("node-test-run-argv-stale", { "a.test.mjs": readsArgv });
      const file = join(String(dir), "a.test.mjs");
      const stream = run({ files: [file], env: { ...bunEnv, [kArgv]: encode(file, "stale") } });
      expect(await reported(stream)).toEqual([`test:pass ${JSON.stringify([[], null])}`]);
    },
    30_000,
  );

  test.concurrent(
    "the variable is for the file that run() names in it",
    async () => {
      using dir = tempDir("node-test-run-argv-bound", { "a.test.mjs": readsArgv, "b.test.mjs": readsArgv });
      const [a, b] = [join(String(dir), "a.test.mjs"), join(String(dir), "b.test.mjs")];
      const value = encode(a, "x", "");
      const [forA, forB] = await Promise.all([
        bunTest(a, { ...asRunChild, [kArgv]: value }),
        bunTest(b, { ...asRunChild, [kArgv]: value }),
      ]);
      expect(forA.stderr).toContain(`(pass) ${JSON.stringify([["x", ""], value])}`);
      expect(forB.stderr).toContain(`(pass) ${JSON.stringify([[], value])}`);
      expect({ a: forA.exitCode, b: forB.exitCode }).toEqual({ a: 0, b: 0 });
    },
    30_000,
  );

  test.concurrent(
    "a `bun test` that run() did not start does not read the variable",
    async () => {
      using dir = tempDir("node-test-run-argv-plain", {
        "a.test.mjs": readsArgv,
        // An env file is not the environment that run() gives its child.
        ".env.test": `BUN_TEST_DRAIN_EVENT_LOOP=1\n${kArgv}=not what run() writes\n`,
      });
      const file = join(String(dir), "a.test.mjs");
      const plain = { ...bunEnv, BUN_TEST_DRAIN_EVENT_LOOP: undefined, [kArgv]: "not what run() writes" };
      const { stderr, exitCode } = await bunTest(file, plain);
      expect(stderr).toContain(`(pass) ${JSON.stringify([[], "not what run() writes"])}`);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  // A worker has no file on its command line to check the variable against. It gets the variable only from a
  // coordinator that took it: not from an env file, and not from a coordinator that was started for another file.
  test.concurrent.each([
    ["from an env file", { ...bunEnv, BUN_TEST_DRAIN_EVENT_LOOP: undefined, [kArgv]: undefined }],
    ["of another file", { ...asRunChild, [kArgv]: encode("/another/file.test.mjs", "x") }],
  ])(
    "the workers of `--parallel` do not read the variable %s",
    async (_, env) => {
      const record = `
        import { test } from "node:test";
        import { writeFileSync } from "node:fs";
        test("record", () => writeFileSync(import.meta.filename + ".json", JSON.stringify(process.argv.slice(2))));
      `;
      using dir = tempDir("node-test-run-argv-workers", {
        "tests/one.test.mjs": record,
        "tests/two.test.mjs": record,
        ".env.test": `BUN_TEST_DRAIN_EVENT_LOOP=1\n${kArgv}=not what run() writes\n`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--parallel=2", join(String(dir), "tests")],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("2 pass");
      expect({
        one: await Bun.file(join(String(dir), "tests/one.test.mjs.json")).json(),
        two: await Bun.file(join(String(dir), "tests/two.test.mjs.json")).json(),
      }).toEqual({ one: [], two: [] });
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "an empty variable is no variable",
    async () => {
      using dir = tempDir("node-test-run-argv-empty", { "a.test.mjs": readsArgv });
      const { stderr, exitCode } = await bunTest(join(String(dir), "a.test.mjs"), { ...asRunChild, [kArgv]: "" });
      expect(stderr).toContain(`(pass) ${JSON.stringify([[], ""])}`);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  // Not a length, a length past the end, no length, a length that is not only digits, bytes left over.
  test.concurrent.each(["x", "2:x", ":x", "0_1:x", "1:xy"])(
    "a child of run() with the variable set to %j fails, and does not run the file",
    async value => {
      using dir = tempDir("node-test-run-argv-invalid", { "a.test.mjs": readsArgv });
      const { stderr, exitCode } = await bunTest(join(String(dir), "a.test.mjs"), { ...asRunChild, [kArgv]: value });
      expect(stderr).toContain(`error: Invalid value for ${kArgv}`);
      expect(stderr).not.toContain("a.test.mjs");
      expect(exitCode).toBe(1);
    },
    30_000,
  );
});
