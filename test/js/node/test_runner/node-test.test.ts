import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
});

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

describe("node:test done callback", () => {
  async function runInlineTest(source: string) {
    using dir = tempDir("node-test-done", { "done.test.js": source });
    await using proc = spawn({
      cmd: [bunExe(), "test", join(String(dir), "done.test.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("passes when done() is called synchronously or asynchronously", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      test('sync done', (t, done) => { done(); });
      test('async done', (t, done) => { setImmediate(done); });
    `);
    // Without done support both fixtures throw "done is not a function", so the
    // "2 pass" count is what distinguishes the fix from the bug.
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("done() passes a test while done(error) fails another", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      test('ok', (t, done) => { done(); });
      test('err', (t, done) => { done(new Error('boom-error')); });
    `);
    // The "1 pass" count only happens when done() actually resolves the first
    // test; without the fix both tests throw and nothing passes.
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 fail");
    expect(stderr).toContain("boom-error");
    expect(exitCode).not.toBe(0);
  });

  test("times out when done is never called", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      test('never done', { timeout: 100 }, (t, done) => {});
    `);
    // Without the fix this resolves synchronously and passes (0 fail); with the
    // fix it waits for a done that never arrives and times out.
    expect(stderr).toContain("1 fail");
    expect(exitCode).not.toBe(0);
  });

  test("fails when a callback-style test also returns a Promise", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      test('cb and promise', async (t, done) => { done(); });
    `);
    expect(stderr).toContain("passed a callback but also returned a Promise");
    expect(stderr).toContain("1 fail");
    expect(exitCode).not.toBe(0);
  });

  test("arity-1 tests receive the context, not done", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      test('no done', t => { if (typeof t !== 'object' || t === null) throw new Error('expected a context'); });
    `);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("hooks receive a done callback", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import { test, beforeEach } from 'node:test';
      let ran = false;
      beforeEach((ctx, done) => { setImmediate(() => { ran = true; done(); }); });
      test('uses hook', () => { if (!ran) throw new Error('hook did not run'); });
    `);
    // Without the fix the hook throws "done is not a function" and the test is
    // not reached, so the "1 pass" count only happens once done works.
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
