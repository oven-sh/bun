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

describe.concurrent("node:test root before() timing", () => {
  // In Node a root-level before() hook runs synchronously at the call site
  // because the root test is already executing while the module body runs.
  // Suite-level before() (inside a describe) is deferred in both runtimes.
  test("runs a root before() synchronously so generated tests are registered", async () => {
    using dir = tempDir("node-test-root-before", {
      "rootbefore.test.mjs": `
        import { test, describe, before } from 'node:test';

        let cases = null;
        before(() => { cases = ['a', 'b']; console.log('LOG:before-ran'); });
        console.log('LOG:module-continues cases=' + JSON.stringify(cases));

        describe('generated', () => {
          console.log('LOG:describe-body cases=' + JSON.stringify(cases));
          for (const c of (cases ?? [])) test('case ' + c, () => {});
        });

        test('control', () => {});
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "rootbefore.test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const logs = stdout
      .split("\n")
      .filter(l => l.startsWith("LOG:"))
      .join("\n");
    expect({ logs, stderr, exitCode }).toMatchObject({
      logs: ["LOG:before-ran", 'LOG:module-continues cases=["a","b"]', 'LOG:describe-body cases=["a","b"]'].join("\n"),
      stderr: expect.stringContaining("3 pass"),
      exitCode: 0,
    });
  });

  test("a throwing root before() fails the run but does not abort module evaluation", async () => {
    using dir = tempDir("node-test-root-before-throw", {
      "rootbefore.test.mjs": `
        import { test, before } from 'node:test';
        before(() => { console.log('LOG:before-ran'); throw new Error('before failed'); });
        console.log('LOG:module-continues');
        test('control', () => {});
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "rootbefore.test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const logs = stdout
      .split("\n")
      .filter(l => l.startsWith("LOG:"))
      .join("\n");
    expect({ logs, stderr, exitCode }).toMatchObject({
      logs: "LOG:before-ran\nLOG:module-continues",
      stderr: expect.stringContaining("before failed"),
      exitCode: 1,
    });
  });

  test("an async root before() runs its sync prefix now and tests await its completion", async () => {
    using dir = tempDir("node-test-root-before-async", {
      "rootbefore.test.mjs": `
        import assert from 'node:assert';
        import { test, before } from 'node:test';
        let x = 0;
        before(async () => {
          x = 1;
          await new Promise(r => setImmediate(r));
          x = 2;
        });
        console.log('LOG:module-continues x=' + x);
        test('control', () => { console.log('LOG:test x=' + x); assert.strictEqual(x, 2); });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "rootbefore.test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const logs = stdout
      .split("\n")
      .filter(l => l.startsWith("LOG:"))
      .join("\n");
    expect({ logs, stderr, exitCode }).toMatchObject({
      logs: "LOG:module-continues x=1\nLOG:test x=2",
      stderr: expect.stringContaining("1 pass"),
      exitCode: 0,
    });
  });

  test("a suite-level before() inside describe() is still deferred", async () => {
    using dir = tempDir("node-test-suite-before", {
      "suitebefore.test.mjs": `
        import { test, describe, before } from 'node:test';
        describe('suite', () => {
          let x = 0;
          before(() => { x = 1; console.log('LOG:suite-before-ran'); });
          console.log('LOG:describe-body x=' + x);
          test('t', () => { console.log('LOG:test x=' + x); });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "suitebefore.test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const logs = stdout
      .split("\n")
      .filter(l => l.startsWith("LOG:"))
      .join("\n");
    expect({ logs, stderr, exitCode }).toMatchObject({
      logs: "LOG:describe-body x=0\nLOG:suite-before-ran\nLOG:test x=1",
      stderr: expect.stringContaining("1 pass"),
      exitCode: 0,
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
