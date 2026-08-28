import { spawn } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// Every test here spawns a bun subprocess (debug+ASAN startup is ~3s each).
setDefaultTimeout(isDebug || isASAN ? 30_000 : 10_000);

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

  test("should treat { todo: '' } as a todo directive like node", async () => {
    // The registration path read options.todo truthily, so an empty message
    // registered an ordinary test and both failing bodies failed the file.
    const { exitCode, stderr } = await runTests(["30-todo-empty-message.js"]);
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

test.concurrent("run(): an uncaught exception during a pending body fails that test instead of hanging", async () => {
  using dir = tempDir("node-test-uncaught-body", {
    "fixture.test.mjs": `
      import test from 'node:test';
      test('pending body uncaught', async () => {
        setTimeout(() => { throw new Error('late boom'); }, 20);
        await new Promise(() => {});
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./fixture.test.mjs', import.meta.url))] });
      const fails = [];
      stream.on('test:fail', d => fails.push({ name: d.name, failureType: d.details?.error?.failureType }));
      for await (const _ of stream);
      console.log(JSON.stringify(fails));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const hangGuard = isDebug || isASAN ? 20_000 : 4_000;
  const exited = await Promise.race([proc.exited, Bun.sleep(hangGuard).then(() => "timeout" as const)]);
  if (exited === "timeout") proc.kill();
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  expect({ exited, stderr }).not.toMatchObject({ exited: "timeout" });
  const fails = JSON.parse(stdout.trim() || "[]");
  expect(fails).toContainEqual({ name: "pending body uncaught", failureType: "uncaughtException" });
});

test.concurrent("run(): a user test writing the run-event marker cannot error the run stream", async () => {
  using dir = tempDir("node-test-marker-inject", {
    "fixture.test.mjs": `
      import test from 'node:test';
      test('writes hostile marker lines', () => {
        process.stdout.write('\\0bun:test:run\\0null\\n');
        process.stdout.write('\\0bun:test:run\\0' + JSON.stringify({ type: 'x' }) + '\\n');
        process.stdout.write('\\0bun:test:run\\0' + JSON.stringify({ type: 'x', data: null }) + '\\n');
        process.stdout.write('\\0bun:test:run\\0' + JSON.stringify({ type: 'test:fail', data: { error: null } }) + '\\n');
        process.stdout.write('\\0bun:test:run\\0' + JSON.stringify({ type: 'test:fail', data: { error: { cause: null } } }) + '\\n');
        process.stdout.write('\\0bun:test:run\\0' + JSON.stringify({ type: 'test:fail', data: { error: { actual: { _bunTag: 'bi', v: 'x' } } } }) + '\\n');
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./fixture.test.mjs', import.meta.url))] });
      const seen = { passes: [], streamError: null };
      stream.on('test:pass', function onPass(d) { seen.passes.push(d.name); });
      stream.on('error', function onError(err) { seen.streamError = String(err); });
      for await (const _ of stream);
      console.log(JSON.stringify(seen));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const seen = JSON.parse(stdout.trim() || "{}");
  expect({ streamError: seen.streamError, passes: seen.passes, stderr, exitCode }).toEqual({
    streamError: null,
    passes: ["writes hostile marker lines"],
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("NODE_TEST_CONTEXT does not leak node:test uncaught handling into spawned grandchildren", async () => {
  using dir = tempDir("node-test-env-leak", {
    "inner.test.js": `
      process.on("uncaughtException", () => {});
      const { test } = require("bun:test");
      test("swallow attempt", async () => {
        setTimeout(() => { throw new Error("boom"); }, 10);
        await new Promise(r => setTimeout(r, 50));
      });
    `,
    "outer.test.mjs": `
      import test from 'node:test';
      import assert from 'node:assert';
      import { spawnSync } from 'node:child_process';
      test('grandchild records the uncaught', () => {
        const r = spawnSync(process.execPath, ['test', process.env.INNER_FIXTURE], { env: { ...process.env } });
        assert.strictEqual(r.status, 1);
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./outer.test.mjs', import.meta.url))] });
      let passed = 0, failed = 0;
      stream.on('test:pass', () => passed++);
      stream.on('test:fail', () => failed++);
      for await (const _ of stream);
      console.log(JSON.stringify({ passed, failed }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: { ...bunEnv, INNER_FIXTURE: join(String(dir), "inner.test.js") },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const counts = JSON.parse(stdout.trim() || "null");
  expect({ counts, stderr, exitCode }).toMatchObject({ counts: { failed: 0 }, exitCode: 0 });
  expect(counts.passed).toBeGreaterThanOrEqual(1);
});

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)("run() with %s isolation reports suite hook failures like node", async (_label, isolationArg) => {
  using dir = tempDir("node-test-hook-failures", {
    "afterfail.test.mjs": `
      import { describe, it, after } from 'node:test';
      describe('s', () => {
        it('a', () => {});
        after(() => { throw new Error('after boom'); });
      });
    `,
    "beforefail.test.mjs": `
      import { describe, it, before } from 'node:test';
      describe('s', () => {
        it('a', () => { throw new Error('a must not run'); });
        before(() => { throw new Error('before boom'); });
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL(process.argv[2], import.meta.url))]${isolationArg} });
      const ev = [];
      stream.on('test:pass', t => ev.push(['pass', t.name]));
      stream.on('test:fail', t => ev.push(['fail', t.name, t.details?.error?.failureType ?? '']));
      for await (const _ of stream);
      console.log(JSON.stringify(ev));
    `,
  });
  async function runDriver(fixture: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "driver.mjs"), fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return JSON.parse(stdout.trim() || "null");
  }
  // Same event streams real node v26.3.0 emits for these fixtures.
  expect(await runDriver("./afterfail.test.mjs")).toEqual([
    ["pass", "a"],
    ["fail", "s", "hookFailed"],
  ]);
  expect(await runDriver("./beforefail.test.mjs")).toEqual([
    ["fail", "a", "cancelledByParent"],
    ["fail", "s", "hookFailed"],
  ]);
});

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)(
  "run() with %s isolation cancels a nested suite under a failed before() like node",
  async (_label, isolationArg) => {
    using dir = tempDir("node-test-nested-hook-cancel", {
      "f.test.mjs": `
      import { describe, it, before, after } from 'node:test';
      import { writeFileSync } from 'node:fs';
      describe('outer', () => {
        before(() => { throw new Error('outer setup broken'); });
        after(() => writeFileSync(new URL('./outer-after.txt', import.meta.url), '1'));
        describe('inner', () => {
          before(() => writeFileSync(new URL('./inner-before.txt', import.meta.url), '1'));
          after(() => writeFileSync(new URL('./inner-after.txt', import.meta.url), '1'));
          it('a', () => {});
        });
      });
    `,
      "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))]${isolationArg} });
      const ev = [];
      stream.on('test:pass', t => ev.push(['pass', t.name]));
      stream.on('test:fail', t => ev.push(['fail', t.name, t.details?.error?.failureType ?? '', t.details?.duration_ms]));
      for await (const _ of stream);
      console.log(JSON.stringify(ev));
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const events = JSON.parse(stdout.trim() || "null");
    // Same event stream real node v26.3.0 emits for this fixture.
    expect(events).toEqual([
      ["fail", "a", "cancelledByParent", 0],
      ["fail", "inner", "cancelledByParent", 0],
      ["fail", "outer", "hookFailed", expect.any(Number)],
    ]);
    expect({
      innerBefore: existsSync(join(String(dir), "inner-before.txt")),
      innerAfter: existsSync(join(String(dir), "inner-after.txt")),
      outerAfter: existsSync(join(String(dir), "outer-after.txt")),
    }).toEqual({ innerBefore: false, innerAfter: false, outerAfter: true });
  },
);

test.concurrent("run(): verdict numbering, file ordinals, causes, and summary keys match node", async () => {
  using dir = tempDir("node-test-run-fidelity", {
    "one.test.mjs": `
      import { test } from 'node:test';
      test('one-a', () => {});
      test('one-b', () => {});
    `,
    "two.test.mjs": `
      import { test } from 'node:test';
      import assert from 'node:assert';
      test('two-a', () => { throw Object.assign(new Error('boom'), { cause: 42 }); });
      test('two-b', () => { assert.strictEqual(1, 2); });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const files = ['./one.test.mjs', './two.test.mjs'].map(f => fileURLToPath(new URL(f, import.meta.url)));
      const stream = run({ files });
      const out = { verdicts: [], completes: [], plans: [], causes: {}, summaryKeys: null };
      stream.on('test:plan', function onPlan(t) { out.plans.push([t.nesting, t.count]); });
      stream.on('test:pass', function onPass(t) { out.verdicts.push([t.name, t.testNumber]); });
      stream.on('test:fail', function onFail(t) {
        out.verdicts.push([t.name.split(/[\\\\/]/).pop(), t.testNumber]);
        const c = t.details?.error?.cause;
        if (c !== undefined && t.name === 'two-a') out.causes.twoA = { type: typeof c?.cause, value: c?.cause };
        if (c !== undefined && t.name === 'two-b') {
          const d = Object.getOwnPropertyDescriptor(c, 'name');
          out.causes.twoB = { name: c.name, nameEnumerable: d?.enumerable ?? null, actual: c.actual, expected: c.expected, operator: c.operator };
        }
      });
      stream.on('test:complete', function onComplete(t) { if (t.nesting === 0) out.completes.push([t.name.split(/[\\\\/]/).pop(), t.testNumber]); });
      stream.on('test:summary', function onSummary(t) { if (t.file === undefined) out.summaryKeys = Object.keys(t.counts); });
      for await (const _ of stream);
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
    result: {
      verdicts: [
        ["one-a", 1],
        ["one-b", 2],
        ["two-a", 3],
        ["two-b", 4],
      ],
      completes: [
        ["one-a", 1],
        ["one-b", 2],
        ["one.test.mjs", 1],
        ["two-a", 1],
        ["two-b", 2],
        ["two.test.mjs", 2],
      ],
      // One run-level plan from the parent; the children send none of their own.
      plans: [[0, 4]],
      causes: {
        twoA: { type: "number", value: 42 },
        twoB: { name: "AssertionError", nameEnumerable: false, actual: 1, expected: 2, operator: "strictEqual" },
      },
      summaryKeys: ["tests", "failed", "passed", "cancelled", "skipped", "todo", "topLevel", "suites"],
    },
  });
});

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)("run() with %s isolation reports a throwing describe body like node", async (_label, isolationArg) => {
  using dir = tempDir("node-test-suite-body-throw", {
    "sync.test.mjs": `
      import { describe, test } from 'node:test';
      describe('s', () => {
        test('declared', () => {});
        throw new Error('body boom');
      });
    `,
    "async.test.mjs": `
      import { describe, test } from 'node:test';
      describe('s', async () => {
        test('declared', () => {});
        throw new Error('async body boom');
      });
    `,
    // A nullish throw must fail the suite and cancel the children the same
    // way; node reports both shapes identically to the Error ones above.
    "sync-null.test.mjs": `
      import { describe, test } from 'node:test';
      describe('s', () => {
        test('declared', () => {});
        throw null;
      });
    `,
    "async-undefined.test.mjs": `
      import { describe, test } from 'node:test';
      describe('s', async () => {
        test('declared', () => {});
        throw undefined;
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL(process.argv[2], import.meta.url))]${isolationArg} });
      const ev = [];
      stream.on('test:pass', function onPass(t) { ev.push(['pass', t.name]); });
      stream.on('test:fail', function onFail(t) { ev.push(['fail', t.name, t.details?.error?.failureType ?? '']); });
      for await (const _ of stream);
      console.log(JSON.stringify(ev));
    `,
  });
  async function runDriver(fixture: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "driver.mjs"), fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return JSON.parse(stdout.trim() || "null");
  }
  // Same event streams real node v26.3.0 emits for all four fixtures.
  const expected = [
    ["fail", "declared", "cancelledByParent"],
    ["fail", "s", "testCodeFailure"],
  ];
  const fixtures = ["./sync.test.mjs", "./async.test.mjs", "./sync-null.test.mjs", "./async-undefined.test.mjs"];
  const results = await Promise.all(fixtures.map(runDriver));
  expect(Object.fromEntries(fixtures.map((f, i) => [f, results[i]]))).toEqual(
    Object.fromEntries(fixtures.map(f => [f, expected])),
  );
});

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)(
  "run() with %s isolation reports a todo suite's own failures as advisory like node",
  async (_label, isolationArg) => {
    // A todo suite's own body or hook failure still fails the suite (reported
    // with the todo directive) and cancels its children, while a failing child
    // leaves the suite passing, and none of it fails the run or a plain parent.
    using dir = tempDir("node-test-todo-suite-own-failures", {
      "f.test.mjs": `
      import { describe, it, before, after } from 'node:test';
      describe.todo('body-sync', () => { it('declared', () => {}); throw new Error('boom'); });
      describe.todo('body-async', async () => { throw new Error('boom'); });
      describe.todo('before-fails', () => { before(() => { throw new Error('b'); }); it('child', () => {}); });
      describe.todo('after-fails', () => { after(() => { throw new Error('a'); }); it('child2', () => {}); });
      describe.todo('child-fails', () => { it('bad', () => { throw new Error('c'); }); });
      describe('plain-parent', () => { describe.todo('todo-child-throws', () => { throw new Error('d'); }); it('sibling', () => {}); });
    `,
      "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))]${isolationArg} });
      const out = { events: [], success: null };
      const tag = t => (t.todo === undefined ? '' : '#todo');
      stream.on('test:fail', t => out.events.push(['fail', t.name + tag(t), t.details?.error?.failureType]));
      stream.on('test:pass', t => out.events.push(['pass', t.name + tag(t)]));
      stream.on('test:summary', t => { if (t.file === undefined) out.success = t.success; });
      for await (const _ of stream);
      console.log(JSON.stringify(out));
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Verbatim node v26.3.0 output for this fixture in both isolation modes.
    expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
      result: {
        events: [
          ["fail", "declared#todo", "cancelledByParent"],
          ["fail", "body-sync#todo", "testCodeFailure"],
          ["fail", "body-async#todo", "testCodeFailure"],
          ["fail", "child#todo", "cancelledByParent"],
          ["fail", "before-fails#todo", "hookFailed"],
          ["pass", "child2#todo"],
          ["fail", "after-fails#todo", "hookFailed"],
          ["fail", "bad#todo", "testCodeFailure"],
          ["pass", "child-fails#todo"],
          ["fail", "todo-child-throws#todo", "testCodeFailure"],
          ["pass", "sibling"],
          ["pass", "plain-parent"],
        ],
        success: true,
      },
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)(
  "run() with %s isolation ignores a test() or describe() declared from a suite's after() like node",
  async (_label, isolationArg) => {
    // Node never runs or reports a child declared once its parent's children
    // are done. The shim used to count it as a pending child of the suite, so
    // neither suite ever reached its verdict and the run reported no suites.
    using dir = tempDir("node-test-late-declaration-from-after", {
      "f.test.mjs": `
      import { describe, it, after } from 'node:test';
      import { writeFileSync } from 'node:fs';
      describe('outer', () => {
        describe('s', () => {
          after(() => {
            it('late', () => {});
            describe('late-suite', () => { it('late-nested', () => {}); });
            writeFileSync(new URL('./after-ran.txt', import.meta.url), '1');
          });
          it('a', () => {});
        });
      });
    `,
      "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))]${isolationArg} });
      const out = { events: [], suites: null, success: null };
      stream.on('test:fail', t => out.events.push(['fail', t.name, t.details?.error?.failureType]));
      stream.on('test:pass', t => out.events.push(['pass', t.name]));
      stream.on('test:summary', t => { if (t.file === undefined) { out.suites = t.counts.suites; out.success = t.success; } });
      for await (const _ of stream);
      console.log(JSON.stringify(out));
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The events are verbatim node v26.3.0 in both isolation modes; the suite
    // count is node's under process isolation (in process, node's own counters
    // also include the late declarations it never reports).
    expect({
      result: JSON.parse(stdout.trim() || "null"),
      afterRan: existsSync(join(String(dir), "after-ran.txt")),
      stderr,
      exitCode,
    }).toEqual({
      result: {
        events: [
          ["pass", "a"],
          ["pass", "s"],
          ["pass", "outer"],
        ],
        suites: 2,
        success: true,
      },
      afterRan: true,
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent(
  "tests declared from a root-level before() register the same way in-process and standalone",
  async () => {
    // run({isolation:'none'}) marks the shared root started (its before() hooks
    // fire at import), which used to make a test declared inside such a hook an
    // inline subtest of the root that nothing awaited or reported. Standalone
    // mode always registered it as a top-level entry. Node's own reporting of
    // this shape is inconsistent, so this pins agreement between bun's modes:
    // the same set in both (in-process earlier, since the hook fires at import),
    // and the after()-declared one dropped in both, as node does.
    using dir = tempDir("node-test-root-hook-declared", {
      "f.test.mjs": `
      import { before, after, test, describe } from 'node:test';
      before(() => {
        test('from-before', () => {});
        describe('suite-from-before', () => { test('nested-from-before', () => {}); });
      });
      before((t) => { t.test('ctx-from-before', () => {}); });
      after(() => { test('from-after', () => {}); });
      test('regular', () => {});
    `,
      "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))], isolation: 'none' });
      const out = { verdicts: [], tests: null, suites: null, success: null };
      stream.on('test:pass', t => out.verdicts.push(['ok', t.name]));
      stream.on('test:fail', t => out.verdicts.push(['not ok', t.name]));
      stream.on('test:summary', t => {
        if (t.file === undefined) { out.tests = t.counts.tests; out.suites = t.counts.suites; out.success = t.success; }
      });
      for await (const _ of stream);
      console.log(JSON.stringify(out));
    `,
    });
    async function spawnAndCollect(cmd: string[]) {
      await using proc = Bun.spawn({ cmd, env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
      return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    }
    const [[inProcessOut, inProcessErr, inProcessExit], [tapOut, tapErr, tapExit]] = await Promise.all([
      spawnAndCollect([bunExe(), "run", join(String(dir), "driver.mjs")]),
      spawnAndCollect([bunExe(), "--test-reporter=tap", join(String(dir), "f.test.mjs")]),
    ]);
    const tapVerdicts = Array.from(tapOut.matchAll(/^ *(ok|not ok) \d+ - (.+)$/gm), m => [m[1], m[2]]);
    const tapCount = (key: string) => Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(tapOut)?.[1]);
    expect({
      inProcess: { result: JSON.parse(inProcessOut.trim() || "null"), stderr: inProcessErr, exitCode: inProcessExit },
      standalone: {
        verdicts: tapVerdicts,
        tests: tapCount("tests"),
        suites: tapCount("suites"),
        fail: tapCount("fail"),
        stderr: tapErr,
        exitCode: tapExit,
      },
    }).toEqual({
      inProcess: {
        result: {
          verdicts: [
            ["ok", "from-before"],
            ["ok", "nested-from-before"],
            ["ok", "suite-from-before"],
            ["ok", "ctx-from-before"],
            ["ok", "regular"],
          ],
          tests: 4,
          suites: 1,
          success: true,
        },
        stderr: "",
        exitCode: 0,
      },
      standalone: {
        verdicts: [
          ["ok", "regular"],
          ["ok", "from-before"],
          ["ok", "nested-from-before"],
          ["ok", "suite-from-before"],
          ["ok", "ctx-from-before"],
        ],
        tests: 4,
        suites: 1,
        fail: 0,
        stderr: "",
        exitCode: 0,
      },
    });
  },
);

test.concurrent(
  "run({isolation:'none'}): a run destroyed by a throwing listener does not leak its tests into the caller",
  async () => {
    // A listener that throws synchronously unwinds executeStandaloneQueue before
    // it clears the queue. restoreAfterInProcessRun used to append the caller's
    // entries behind the run's, so the caller's own standalone pass at beforeExit
    // ran 'inner' a second time.
    using dir = tempDir("node-test-inprocess-destroyed-run", {
      "f.test.mjs": `
      import { test } from 'node:test';
      test('inner', () => { console.log('MARK inner ran'); });
    `,
      "caller.mjs": `
      import { test, run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      test('caller-own', () => { console.log('MARK caller-own ran'); });
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))], isolation: 'none' });
      stream.on('test:pass', () => { throw new Error('listener boom'); });
      try {
        for await (const _ of stream);
        console.log('MARK stream ended');
      } catch (err) {
        console.log('MARK stream error: ' + err.message);
      }
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "caller.mjs")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const marks = stdout.split("\n").filter(line => line.startsWith("MARK "));
    expect({ marks, stderr, exitCode }).toEqual({
      marks: ["MARK inner ran", "MARK stream error: listener boom", "MARK caller-own ran"],
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)("run() with %s isolation wraps hook failures with node's fixed message", async (_label, isolationArg) => {
  using dir = tempDir("node-test-hook-wrapper-msg", {
    "f.test.mjs": `
      import { describe, it, after } from 'node:test';
      describe('s', () => {
        it('a', () => {});
        after(() => { throw new Error('after boom'); });
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))]${isolationArg} });
      const fails = [];
      stream.on('test:fail', function onFail(t) {
        fails.push({ name: t.name, msg: t.details?.error?.message, causeMsg: t.details?.error?.cause?.message });
      });
      for await (const _ of stream);
      console.log(JSON.stringify(fails));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Verbatim node v26.3.0 output for this fixture.
  expect({ fails: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    fails: [{ name: "s", msg: "failed running after hook", causeMsg: "after boom" }],
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("junit reporter escapes attribute quotes exactly like node", async () => {
  using dir = tempDir("node-test-junit-escape", {
    "q.test.mjs": `
      import { test } from 'node:test';
      test('line1\\nline2 "q" & <angle>', () => {});
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--test", "--test-reporter=junit", "q.test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain('name="line1&#10;line2 &amp;quot;q&amp;quot; &amp; &lt;angle>"');
});

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)("run() with %s isolation stops at the first failing before() like node", async (_label, isolationArg) => {
  using dir = tempDir("node-test-multi-before", {
    "f.test.mjs": `
      import { describe, it, before, after } from 'node:test';
      import { writeFileSync } from 'node:fs';
      describe('s', () => {
        before(() => { throw new Error('first boom'); });
        before(() => writeFileSync(new URL('./second-before.txt', import.meta.url), '1'));
        after(() => writeFileSync(new URL('./own-after.txt', import.meta.url), '1'));
        it('a', () => {});
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))]${isolationArg} });
      const ev = [];
      stream.on('test:fail', function onFail(t) { ev.push([t.name, t.details?.error?.failureType ?? '']); });
      for await (const _ of stream);
      console.log(JSON.stringify(ev));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Same events and side effects real node v26.3.0 produces.
  expect({
    events: JSON.parse(stdout.trim() || "null"),
    secondBefore: existsSync(join(String(dir), "second-before.txt")),
    ownAfter: existsSync(join(String(dir), "own-after.txt")),
    stderr,
    exitCode,
  }).toEqual({
    events: [
      ["a", "cancelledByParent"],
      ["s", "hookFailed"],
    ],
    secondBefore: false,
    ownAfter: true,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent.each([
  [
    "[bad, good]",
    "'./bad.test.mjs', './good.test.mjs'",
    [
      ["fail", "bad.test.mjs", 1],
      ["pass", "good-a", 2],
    ],
  ],
  [
    "[good, bad]",
    "'./good.test.mjs', './bad.test.mjs'",
    [
      ["pass", "good-a", 1],
      ["fail", "bad.test.mjs", 2],
    ],
  ],
] as const)(
  "run({isolation:'none'}): a failed import reports at its declaration position %s",
  async (_label, orderLiteral, expected) => {
    using dir = tempDir("node-test-inprocess-numbering", {
      "bad.test.mjs": `throw new Error('load boom');`,
      "good.test.mjs": `
        import { test } from 'node:test';
        test('good-a', () => {});
      `,
      "driver.mjs": `
        import { run } from 'node:test';
        import { fileURLToPath } from 'node:url';
        const files = [${orderLiteral}].map(f => fileURLToPath(new URL(f, import.meta.url)));
        const stream = run({ files, isolation: 'none' });
        const ev = [];
        stream.on('test:pass', t => ev.push(['pass', t.name.split(/[\\\\/]/).pop(), t.testNumber]));
        stream.on('test:fail', t => ev.push(['fail', t.name.split(/[\\\\/]/).pop(), t.testNumber]));
        for await (const _ of stream);
        console.log(JSON.stringify(ev));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Verbatim node v26.3.0 output for this ordering.
    expect({ events: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
      events: expected,
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent.each([
  [
    "top-level",
    `
      import { test } from 'node:test';
      test('first', () => { globalThis.__abort(); });
      test('second', () => { globalThis.__secondRan = true; });
    `,
  ],
  [
    "inside a describe",
    `
      import { describe, test } from 'node:test';
      describe('s', () => {
        test('first', () => { globalThis.__abort(); });
        test('second', () => { globalThis.__secondRan = true; });
      });
    `,
  ],
] as const)("run({isolation:'none'}): opts.signal does not stop %s entries", async (_label, fixture) => {
  using dir = tempDir("node-test-inprocess-signal", {
    "f.test.mjs": fixture,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const ac = new AbortController();
      globalThis.__abort = () => ac.abort();
      globalThis.__secondRan = false;
      const stream = run({
        files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))],
        isolation: 'none',
        signal: ac.signal,
      });
      const seen = { passes: [], interrupted: false, success: null };
      stream.on('test:pass', t => seen.passes.push(t.name));
      stream.on('test:interrupted', () => { seen.interrupted = true; });
      stream.on('test:summary', t => { if (t.file === undefined) seen.success = t.success; });
      for await (const _ of stream);
      console.log(JSON.stringify({ ...seen, secondRan: globalThis.__secondRan }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const expectedPasses = _label === "top-level" ? ["first", "second"] : ["first", "second", "s"];
  expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    result: { passes: expectedPasses, interrupted: false, success: true, secondRan: true },
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("run(): a zero-test file reports a file-level pass numbered by its ordinal like node", async () => {
  // The file node's own verdict carries the file's ordinal (2), not the
  // running child-verdict count, but it still consumes a slot in that
  // counter: nested's children take 1-2, empty's file verdict takes slot 3
  // (reported as ordinal 2), and second's child continues at 4.
  using dir = tempDir("node-test-zero-test-file", {
    "nested.test.mjs": `
      import { test } from 'node:test';
      test('a', () => {});
      test('b', () => {});
    `,
    "empty.test.mjs": `// intentionally registers no tests`,
    "second.test.mjs": `
      import { test } from 'node:test';
      test('second-top', () => {});
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const files = ['./nested.test.mjs', './empty.test.mjs', './second.test.mjs'].map(f => fileURLToPath(new URL(f, import.meta.url)));
      const stream = run({ files });
      const out = { events: [], emptyComplete: null, perFileSummaries: 0, runCounts: null };
      const base = n => n.split(/[\\\\/]/).pop();
      stream.on('test:pass', t => out.events.push(['pass', base(t.name), t.testNumber]));
      stream.on('test:fail', t => out.events.push(['fail', base(t.name), t.testNumber]));
      stream.on('test:complete', t => { if (base(t.name) === 'empty.test.mjs') out.emptyComplete = t.testNumber; });
      stream.on('test:summary', t => {
        if (t.file !== undefined) out.perFileSummaries++;
        else out.runCounts = t.counts;
      });
      for await (const _ of stream);
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Verbatim node v26.3.0 output for this fixture.
  expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    result: {
      events: [
        ["pass", "a", 1],
        ["pass", "b", 2],
        ["pass", "empty.test.mjs", 2],
        ["pass", "second-top", 4],
      ],
      emptyComplete: 2,
      perFileSummaries: 2,
      runCounts: { tests: 4, failed: 0, passed: 4, cancelled: 0, skipped: 0, todo: 0, topLevel: 4, suites: 0 },
    },
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("run({globPatterns}): literal entries follow node's createTestFileList", async () => {
  // Observed on node v26.3.0: an existing literal is taken as-is and a list of
  // only missing literals is the `Could not find` error rather than an empty
  // successful run. A directory literal is discovered like node's; the child
  // is `bun test <dir>`, which runs the tests inside it (node's `node <dir>`
  // fails instead), so that arm pins discovery, not node's child failure.
  using dir = tempDir("node-test-glob-literals", {
    "tests/a.test.mjs": `
      import { test } from 'node:test';
      test('a', () => {});
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      async function runWith(globPatterns) {
        const out = { pass: [], fail: [], success: null, error: null };
        try {
          const stream = run({ globPatterns, cwd: import.meta.dirname });
          stream.on('test:pass', t => out.pass.push(t.name.split(/[\\\\/]/).pop()));
          stream.on('test:fail', t => out.fail.push(t.name.split(/[\\\\/]/).pop()));
          stream.on('test:summary', t => { if (t.file === undefined) out.success = t.success; });
          for await (const _ of stream);
        } catch (err) {
          out.error = err.message;
        }
        return out;
      }
      console.log(JSON.stringify({
        file: await runWith(['./tests/a.test.mjs']),
        directory: await runWith(['./tests']),
        missing: await runWith(['./nope.mjs']),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    result: {
      file: { pass: ["a"], fail: [], success: true, error: null },
      directory: { pass: ["a"], fail: [], success: true, error: null },
      missing: { pass: [], fail: [], success: null, error: "Could not find './nope.mjs'" },
    },
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)("run() with %s isolation restarts testId per run like node", async (_label, isolationArg) => {
  // node keys testId on each run's root (verified on v26.3.0 under process
  // isolation; its isolation 'none' cannot run twice in one process at all).
  // The file node is the root's direct child, so its id is the ordinal; a
  // child test's id restarts at 1 in every run.
  using dir = tempDir("node-test-testid-per-run", {
    "a.test.mjs": `
      import { test } from 'node:test';
      test('a1', () => {});
      test('a2', () => {});
    `,
    "b.test.mjs": `
      import { test } from 'node:test';
      test('b1', () => {});
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      async function ids(file) {
        const seen = [];
        const stream = run({ files: [fileURLToPath(new URL(file, import.meta.url))]${isolationArg} });
        stream.on('test:enqueue', t => seen.push([t.name.split(/[\\\\/]/).pop(), t.testId]));
        for await (const _ of stream);
        return seen;
      }
      console.log(JSON.stringify({ run1: await ids('./a.test.mjs'), run2: await ids('./b.test.mjs') }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const result = JSON.parse(stdout.trim() || "null");
  // Process isolation also enqueues the file node itself; strip it so both
  // modes compare on the per-test ids, then check the file node separately.
  const isFile = (name: string) => name.endsWith(".test.mjs");
  expect({
    run1: result.run1.filter(([n]: [string]) => !isFile(n)),
    run2: result.run2.filter(([n]: [string]) => !isFile(n)),
    fileIds: [...result.run1, ...result.run2].filter(([n]: [string]) => isFile(n)),
    stderr,
    exitCode,
  }).toEqual({
    run1: [
      ["a1", 1],
      ["a2", 2],
    ],
    run2: [["b1", 1]],
    fileIds:
      isolationArg === ""
        ? [
            ["a.test.mjs", 1],
            ["b.test.mjs", 1],
          ]
        : [],
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("--experimental-test-tag-filter without --test-isolation=none fails loudly", async () => {
  // run() only applies tag filters in-process; under the default process
  // isolation the driver must refuse rather than silently run every test.
  using dir = tempDir("node-test-tag-filter-isolation", {
    "a.test.mjs": `
      import { test } from 'node:test';
      test('untagged', () => { throw new Error('must not run'); });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--test", "--experimental-test-tag-filter=db", "a.test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("--experimental-test-tag-filter requires --test-isolation=none");
  expect(stderr).not.toContain("must not run");
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test.concurrent("--test forwards runtime execArgv to each child but not its own flags", async () => {
  // node's getRunArgs forwards process.execArgv minus the runner's flags
  // (filterExecArgv), so --smol reaches the child while --test-reporter and
  // --test-concurrency (a value-taking runner flag) do not.
  using dir = tempDir("node-test-execargv-forward", {
    "a.test.mjs": `
      import { test } from 'node:test';
      test('execArgv', () => { console.log('CHILD=' + JSON.stringify(process.execArgv)); });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--test", "--smol", "--test-reporter=tap", "--test-concurrency=1", "a.test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const child = /CHILD=(\[[^\]]*\])/.exec(stdout)?.[1];
  expect({ child: child === undefined ? child : JSON.parse(child), stderr, exitCode }).toEqual({
    child: ["--smol"],
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("run(): causes JSON cannot encode do not drop the event line", async () => {
  using dir = tempDir("node-test-unencodable-cause", {
    "f.test.mjs": `
      import { test } from 'node:test';
      test('bigint cause', () => { throw Object.assign(new Error('x'), { cause: 42n }); });
      test('circular cause', () => { const c = {}; c.self = c; throw Object.assign(new Error('y'), { cause: c }); });
      test('after', () => {});
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))] });
      const out = { events: [], counts: null };
      stream.on('test:pass', function onPass(t) { out.events.push(['pass', t.name]); });
      stream.on('test:fail', function onFail(t) {
        const c = t.details?.error?.cause?.cause;
        out.events.push(['fail', t.name, typeof c, String(c).includes('Circular') || String(c)]);
      });
      stream.on('test:summary', function onSummary(t) {
        if (t.file === undefined) out.counts = { tests: t.counts.tests, failed: t.counts.failed, passed: t.counts.passed };
      });
      for await (const _ of stream);
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Counts and event order match node v26.3.0; the bigint round-trips intact.
  expect(JSON.parse(stdout.trim() || "null")).toEqual({
    events: [
      ["fail", "bigint cause", "bigint", "42"],
      ["fail", "circular cause", "string", true],
      ["pass", "after"],
    ],
    counts: { tests: 3, failed: 2, passed: 1 },
  });
});

test.concurrent("run(): object actual/expected cross the pipe by value", async () => {
  using dir = tempDir("node-test-object-extras", {
    "f.test.mjs": `
      import { test } from 'node:test';
      import assert from 'node:assert';
      test('objects', () => { assert.deepStrictEqual({ a: 1, b: [1, 2] }, { a: 2, b: [1, 2] }); });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))] });
      stream.on('test:fail', function onFail(t) {
        const c = t.details?.error?.cause;
        console.log(JSON.stringify({ actual: c?.actual, expected: c?.expected, operator: c?.operator }));
      });
      for await (const _ of stream);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Verbatim node v26.3.0 output for this fixture.
  expect(JSON.parse(stdout.trim() || "null")).toEqual({
    actual: { a: 1, b: [1, 2] },
    expected: { a: 2, b: [1, 2] },
    operator: "deepStrictEqual",
  });
});

test.concurrent.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)(
  "run() with %s isolation keeps declaration order when a later describe body throws",
  async (_label, isolationArg) => {
    using dir = tempDir("node-test-throw-order", {
      "f.test.mjs": `
      import { test, describe } from 'node:test';
      test('a', () => {});
      describe('b', () => { throw new Error('body boom'); });
    `,
      "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))]${isolationArg} });
      const ev = [];
      stream.on('test:pass', function onPass(t) { ev.push(['pass', t.name, t.testNumber]); });
      stream.on('test:fail', function onFail(t) { ev.push(['fail', t.name, t.testNumber, t.details?.error?.failureType ?? '']); });
      for await (const _ of stream);
      console.log(JSON.stringify(ev));
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Verbatim node v26.3.0 output for this fixture.
    expect(JSON.parse(stdout.trim() || "null")).toEqual([
      ["pass", "a", 1],
      ["fail", "b", 2, "testCodeFailure"],
    ]);
  },
);

test.concurrent("run(): a child inheriting --bail emits no reporter chrome", async () => {
  using dir = tempDir("node-test-bail-chrome", {
    "f.test.mjs": `
      import { test } from 'node:test';
      test('one', () => { throw new Error('boom1'); });
      test('two', () => { throw new Error('boom2'); });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))], argv: ['--bail'] });
      const out = { stderr: [], fails: 0 };
      stream.on('test:stderr', function onStderr(t) { out.stderr.push(t.message); });
      stream.on('test:fail', function onFail(t) { out.fails++; });
      for await (const _ of stream);
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout.trim() || "null");
  expect({
    bailChrome: out.stderr.filter((l: string) => l.includes("Bailed out")),
    atLeastOneFail: out.fails >= 1,
  }).toEqual({
    bailChrome: [],
    atLeastOneFail: true,
  });
});

test.concurrent("run({isolation:'none'}): the run signal is not consulted for scheduling", async () => {
  using dir = tempDir("node-test-none-signal", {
    "f.test.mjs": `
      import { test } from 'node:test';
      import { writeFileSync } from 'node:fs';
      test('side', () => { writeFileSync(new URL('./ran.txt', import.meta.url), '1'); });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      import { existsSync } from 'node:fs';
      const ac = new AbortController();
      ac.abort();
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))], signal: ac.signal, isolation: 'none' });
      const out = { passes: [], fails: [], success: null, ran: false };
      stream.on('test:pass', function onPass(t) { out.passes.push(t.name); });
      stream.on('test:fail', function onFail(t) { out.fails.push(t.name); });
      stream.on('test:summary', function onSummary(t) { if (t.file === undefined) out.success = t.success; });
      for await (const _ of stream);
      out.ran = existsSync(new URL('./ran.txt', import.meta.url));
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Verbatim node v26.3.0 behavior for this fixture.
  expect(JSON.parse(stdout.trim() || "null")).toEqual({
    passes: ["side"],
    fails: [],
    success: true,
    ran: true,
  });
});

test.concurrent("run({isolation:'none'}): a suite's duration spans all of its children", async () => {
  using dir = tempDir("node-test-suite-duration", {
    "f.test.mjs": `
      import { describe, it } from 'node:test';
      describe('s', () => {
        it('a', async () => { await new Promise(r => setTimeout(r, 100)); });
        it('b', async () => { await new Promise(r => setTimeout(r, 100)); });
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))], isolation: 'none' });
      let suiteDuration = -1;
      stream.on('test:pass', t => { if (t.name === 's') suiteDuration = t.details.duration_ms; });
      for await (const _ of stream);
      console.log(JSON.stringify({ suiteDuration }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { suiteDuration } = JSON.parse(stdout.trim() || "null");
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(suiteDuration).toBeGreaterThan(180);
});

test.concurrent("run({isolation:'none'}): .only inside describe.only narrows to the inner test", async () => {
  using dir = tempDir("node-test-nested-only", {
    "f.test.mjs": `
      import { describe, it } from 'node:test';
      describe.only('s', () => {
        it('a', () => { throw new Error('a should not run'); });
        it.only('b', () => {});
      });
      describe('plain', () => {
        it('c', () => { throw new Error('c should not run'); });
      });
    `,
    "driver.mjs": `
      import { run } from 'node:test';
      import { fileURLToPath } from 'node:url';
      const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))], isolation: 'none' });
      const passed = [], failed = [];
      stream.on('test:pass', t => passed.push(t.name));
      stream.on('test:fail', t => failed.push(t.name));
      for await (const _ of stream);
      console.log(JSON.stringify({ passed, failed }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "driver.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Same event stream real node v26.3.0 emits for this fixture.
  expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    result: { passed: ["b", "s"], failed: [] },
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent.each([
  ["a tag filter", ", testTagFilters: ['db']", "{ tags: ['db'] }, "],
  ["an .only sibling", "", ""],
] as const)(
  "run({isolation:'none'}): a describe whose body failed survives pruning by %s like node",
  async (_label, runArg, suiteOpts) => {
    // Verified on node v26.3.0: a suite that threw (sync or async) is still
    // reported as testCodeFailure, with a child declared before the throw
    // cancelled, even when tag filtering or .only would otherwise drop it.
    // Before the guard both prunes dropped it and the run reported success.
    const onlyKeeper = suiteOpts === "" ? "describe.only" : "describe";
    using dir = tempDir("node-test-prune-keeps-failed", {
      "f.test.mjs": `
        import { describe, it } from 'node:test';
        describe('sync-fail', ${suiteOpts}() => { it('declared', () => {}); throw new Error('boom'); });
        describe('async-fail', ${suiteOpts}async () => { throw new Error('async boom'); });
        ${onlyKeeper}('keeper', ${suiteOpts}() => { it('kept', () => {}); });
        describe('dropped', () => { it('never', () => { throw new Error('must be pruned'); }); });
      `,
      "driver.mjs": `
        import { run } from 'node:test';
        import { fileURLToPath } from 'node:url';
        const stream = run({ files: [fileURLToPath(new URL('./f.test.mjs', import.meta.url))], isolation: 'none'${runArg} });
        const out = { events: [], success: null };
        stream.on('test:fail', t => out.events.push(['fail', t.name, t.details?.error?.failureType]));
        stream.on('test:pass', t => out.events.push(['pass', t.name]));
        stream.on('test:summary', t => { if (t.file === undefined) out.success = t.success; });
        for await (const _ of stream);
        console.log(JSON.stringify(out));
      `,
    });
    await using proc = Bun.spawn({
      // Tags emit node's one-shot ExperimentalWarning; silence it so stderr is
      // asserted empty like the other drivers here.
      cmd: [bunExe(), "--no-warnings", "run", join(String(dir), "driver.mjs")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
      result: {
        events: [
          ["fail", "declared", "cancelledByParent"],
          ["fail", "sync-fail", "testCodeFailure"],
          ["fail", "async-fail", "testCodeFailure"],
          ["pass", "kept"],
          ["pass", "keeper"],
        ],
        success: false,
      },
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent.skipIf(isWindows)("--test runs the named file when bun is invoked as node", async () => {
  using dir = tempDir("node-test-as-node", {
    "a.test.mjs": `
      import { test } from 'node:test';
      test('a', () => {});
    `,
    // A glob-matching sibling that must NOT run when a.test.mjs is named.
    "nested/b.test.mjs": `
      import { test } from 'node:test';
      test('b', () => { throw new Error('b should not run'); });
    `,
  });
  const node = join(String(dir), "node");
  symlinkSync(bunExe(), node);
  await using proc = Bun.spawn({
    cmd: [node, "--test", "--test-reporter=tap", "a.test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("ok 1 - a");
  expect(stdout).not.toContain("- b");
  expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
});
