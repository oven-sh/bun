import { spawn } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

// Every test here spawns a bun subprocess (debug+ASAN startup is ~3s each).
setDefaultTimeout(isDebug ? 30_000 : 10_000);

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

test("run(): an uncaught exception during a pending body fails that test instead of hanging", async () => {
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
  // The shim must fail the test as soon as the error is attributed, not wait
  // for a timeout rescue. Debug+ASAN pays ~3s per nested spawn, so size the
  // hang guard to clear two spawns there while staying tight on release.
  const hangGuard = isDebug ? 20_000 : 4_000;
  const exited = await Promise.race([proc.exited, Bun.sleep(hangGuard).then(() => "timeout" as const)]);
  if (exited === "timeout") proc.kill();
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  expect({ exited, stderr }).not.toMatchObject({ exited: "timeout" });
  const fails = JSON.parse(stdout.trim() || "[]");
  expect(fails).toContainEqual({ name: "pending body uncaught", failureType: "uncaughtException" });
}, 30_000);

test("NODE_TEST_CONTEXT does not leak node:test uncaught handling into spawned grandchildren", async () => {
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
}, 30_000);

test.each([
  ["process", ""],
  ["none", ", isolation: 'none'"],
] as const)(
  "run() with %s isolation reports suite hook failures like node",
  async (_label, isolationArg) => {
    // node: a failing after() fails the suite with hookFailed; a failing
    // before() additionally cancels the declared children (cancelledByParent).
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
  },
  30_000,
);

test("run({isolation:'none'}): a suite's duration spans all of its children", async () => {
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
  // node reports the full span (>=200ms for two 100ms tests); a clock started
  // at the first child's completion sees only the second test (~100ms).
  expect(suiteDuration).toBeGreaterThan(180);
  expect(exitCode).toBe(0);
}, 30_000);

test("run({isolation:'none'}): .only inside describe.only narrows to the inner test", async () => {
  // node's rule: an only suite runs all its tests unless it has only-marked
  // descendants, in which case only those run.
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
  expect(JSON.parse(stdout.trim() || "null")).toEqual({ passed: ["b", "s"], failed: [] });
  expect(exitCode).toBe(0);
}, 30_000);

test.skipIf(isWindows)("--test runs the named file when bun is invoked as node", async () => {
  // exec_as_if_node's eval branch must merge positionals into passthrough so
  // the eval driver sees the file in process.argv; without that it silently
  // falls back to default-glob discovery in cwd.
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
