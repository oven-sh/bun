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

describe.concurrent("node:test done callback", () => {
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

  test("passes when done() is called synchronously, asynchronously, or with a falsy value", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      test('sync done', (t, done) => { done(); });
      test('async done', (t, done) => { setImmediate(done); });
      test('falsy argument passes', (t, done) => { setImmediate(() => done(0)); });
    `);
    // Without done support every test here throws "done is not a function".
    expect(stderr).toContain("(pass) sync done");
    expect(stderr).toContain("(pass) async done");
    expect(stderr).toContain("(pass) falsy argument passes");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("done() passes a test while done(error) or a truthy value fails others", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      test('resolves with done', (t, done) => { done(); });
      test('rejects with an error', (t, done) => { done(new Error('boom-error')); });
      test('rejects with a truthy value', (t, done) => { setImmediate(() => done('string-failure')); });
    `);
    // Without the fix 'resolves with done' throws instead of passing.
    expect(stderr).toContain("(pass) resolves with done");
    expect(stderr).toContain("(fail) rejects with an error");
    expect(stderr).toContain("(fail) rejects with a truthy value");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("2 fail");
    expect(exitCode).not.toBe(0);
  });

  test("a failure reported through done(error) from a timer fails the test", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      test('async callback test that should FAIL', (t, done) => {
        setTimeout(() => {
          if (1 + 1 !== 3) return done(new Error('expected 3, got 2'));
          done();
        }, 20);
      });
    `);
    // Without the fix the test passes before the timer fires and the process
    // exits 0 with "1 pass".
    expect(stderr).toContain("expected 3, got 2");
    expect(stderr).toContain("1 fail");
    expect(exitCode).not.toBe(0);
  });

  test("an exception thrown from an async callback while the test is pending fails it", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      import assert from 'node:assert';
      test('throws before done', (t, done) => {
        setTimeout(() => {
          assert.ok(false, 'boom-async-throw');
          done();
        }, 1);
      });
    `);
    // Without the fix the test completes synchronously and the process exits
    // before the timer runs, reporting "1 pass".
    expect(stderr).toContain("boom-async-throw");
    expect(stderr).toContain("1 fail");
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

  test("a function declaring more than two parameters is not callback style", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      import assert from 'node:assert';
      test('arity 3', (t, done, extra) => {
        assert.strictEqual(done, undefined);
        assert.strictEqual(extra, undefined);
      });
    `);
    // Node only enables callback mode for exactly two parameters.
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("calling done() a second time throws like Node", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import test from 'node:test';
      import assert from 'node:assert';
      test('second done throws', (t, done) => {
        done();
        assert.throws(() => done(), /callback invoked multiple times/);
      });
    `);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("hooks receive a context object and a done callback", async () => {
    const { stderr, exitCode } = await runInlineTest(`
      import { test, before, beforeEach } from 'node:test';
      import assert from 'node:assert';
      const order = [];
      before((ctx, done) => {
        if (typeof ctx !== 'object' || ctx === null) return done(new Error('expected a hook context'));
        setImmediate(() => { order.push('before'); done(); });
      });
      beforeEach((ctx, done) => { setImmediate(() => { order.push('beforeEach'); done(); }); });
      test('runs after the hooks completed', () => {
        assert.deepStrictEqual(order, ['before', 'beforeEach']);
      });
    `);
    // Without the fix the hooks complete before their setImmediate callbacks
    // run, so the test observes an empty order array and fails.
    expect(stderr).toContain("(pass) runs after the hooks completed");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
