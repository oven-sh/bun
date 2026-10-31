// @ts-nocheck
import { spawn, spawnSync } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { copyFileSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { tmpdir } from "os";
import { dirname, join } from "path";

const tmp = realpathSync(tmpdir());

it("shouldn't crash when async test runner callback throws", async () => {
  console.log("it(shouldn't crash when async test runner callback throws)");
  const code = `
  beforeEach(async () => {
    await 1;
    throw "##123##";
  });

  afterEach(async () => {
    await 1;
    console.error("#[Test passed successfully]");
  });

  it("current", async () => {
    await 1;
    throw "##456##";
  })
`;

  const test_dir = tmpdirSync();
  try {
    await writeFile(join(test_dir, "bad.test.js"), code);
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test", "bad.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const err = await stderr.text();
    expect(err).toContain("Test passed successfully");
    expect(err).toContain("error: ##123##");
    expect(err).not.toContain("error: ##456##"); // Because the beforeEach failed, we do not expect the test to run.
    expect(stdout).toBeDefined();
    expect(await stdout.text()).toBe(`bun test ${Bun.version_with_sha}\n`);
    expect(await exited).toBe(1);
  } finally {
    await rm(test_dir, { force: true, recursive: true });
  }
  console.log("it(shouldn't crash when async test runner callback throws) - done");
});

test("testing Bun.deepEquals() using isEqual()", () => {
  const t = new Uint8Array([1, 2, 3, 4, 5]);
  expect(t).toEqual(t.slice());

  expect(t.subarray(1)).toEqual(t.slice(1));
  expect(t.subarray(1, 9)).toEqual(t.slice().subarray(1, 9));

  var a = { foo: 1, bar: 2, baz: null };
  var b = { foo: 1, bar: 2, baz: null };
  a.baz = a;
  b.baz = b;
  expect(a).toEqual(b);

  var a = { car: 1, cdr: { car: 2, cdr: null } };
  var b = { car: 1, cdr: { car: 2, cdr: null } };
  a.cdr.cdr = a;
  b.cdr.cdr = b.cdr;
  expect(a).not.toEqual(b);

  expect(1n).not.toEqual(1);
  expect(1).not.toEqual(1n);
  expect(1n).toEqual(1n);
  expect(undefined).not.toEqual([]);

  var a = [1, 2, 3, null];
  var b = [1, 2, 3, null];
  a[3] = b;
  b[3] = a;
  expect(a).toEqual(b);

  var a = [1, 2, 3, null];
  var b = [1, 2, 3, null];
  a[3] = a;
  b[3] = a;
  expect(a).toEqual(b);

  var a = [1, [2, [3, null]]];
  var b = [1, [2, [3, null]]];
  a[1][1][1] = a;
  b[1][1][1] = b[1][1];
  expect(a).not.toEqual(b);

  const foo = [1];
  foo[1] = foo;

  expect(foo).toEqual([1, foo]);

  expect(1).toEqual(1);
  expect([1]).toEqual([1]);

  // expect(a).toEqual(a);
  expect([1, 2, 3]).toEqual([1, 2, 3]);

  let o = { a: 1, b: 2 };
  expect(o).toEqual(o);
  expect(o).toEqual({ a: 1, b: 2 });
  expect(o).toEqual({ b: 2, a: 1 });
  expect({ a: 1, b: 2 }).toEqual(o);
  expect({ b: 2, a: 1 }).toEqual(o);
  expect(o).not.toEqual({ a: 1, b: 2, c: 3 });
  expect({ a: 1, b: 2, c: 3, d: 4 }).not.toEqual(o);
  expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });
  expect({ a: 1, b: 2 }).not.toEqual({ a: 1 });

  expect("a").toEqual("a");
  expect("aaaa").toEqual("aaaa");
  expect("aaaa").not.toEqual("aaaaa");
  expect("aaaa").not.toEqual("aaba");
  expect("a").not.toEqual("b");

  expect(undefined).not.toEqual(null);
  expect(null).not.toEqual(undefined);
  expect(undefined).not.toEqual(0);
  expect(0).not.toEqual(undefined);
  expect(null).not.toEqual(0);
  expect(0).not.toEqual(null);
  expect(undefined).not.toEqual("");
  expect("").not.toEqual(undefined);
  expect(null).not.toEqual("");
  expect("").not.toEqual(null);
  expect(undefined).not.toEqual(false);
  expect(false).not.toEqual(undefined);
  expect(null).not.toEqual(false);
  expect(false).not.toEqual(null);
  expect(undefined).not.toEqual(true);
  expect(true).not.toEqual(undefined);
  expect(null).not.toEqual(true);
  expect(true).not.toEqual(null);
  expect([]).not.toEqual(undefined);
  expect(null).not.toEqual([]);
  expect([]).not.toEqual(null);

  expect(0).toEqual(0);
  expect(-0).toEqual(-0);
  expect(0).not.toEqual(-0);
  expect(-0).not.toEqual(0);

  expect(NaN).toEqual(NaN);

  expect(null).toEqual(null);
  expect(undefined).toEqual(undefined);

  expect(1).toEqual(1);
  expect(1).not.toEqual(2);

  expect(NaN).toEqual(NaN);
  expect(NaN).toEqual(0 / 0);
  expect(Infinity).toEqual(Infinity);
  expect(Infinity).toEqual(1 / 0);
  expect(-Infinity).toEqual(-Infinity);
  expect(-Infinity).toEqual(-1 / 0);

  expect(Error("foo")).toEqual(Error("foo"));
  expect(Error("foo")).not.toEqual(Error("bar"));
  expect(Error("foo")).not.toEqual("foo");

  class CustomError extends Error {
    constructor(message) {
      super(message);
    }
  }
  expect(new CustomError("foo")).not.toEqual(new CustomError("bar"));
  expect(new CustomError("foo")).toEqual(new CustomError("foo"));
});

try {
  test("test this doesnt crash");
} catch (e) {}

try {
  test();
} catch (e) {}

test("describe scope throwing doesn't block other tests from running", async () => {
  const code = `
  describe("throw in describe scope doesn't enqueue tests after thrown", () => {
    it("test enqueued before a describe scope throws is never run", () => {
      throw new Error("This test failed");
    });

    throw "This test passed. Ignore the error message";

    it("test enqueued after a describe scope throws is never run", () => {
      throw new Error("This test failed");
    });
  });

  it("a describe scope throwing doesn't cause all other tests in the file to fail", () => {
    console.log(
      String.fromCharCode(...[73, 32, 104, 97, 118, 101, 32, 98, 101, 101, 110, 32, 114, 101, 97, 99, 104, 101, 100, 33]),
    );
  });
`;

  const dir = tmpdirSync();
  const filepath = join(dir, "test-i-have-been-reached.test.js");
  rmSync(filepath, {
    force: true,
  });

  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {}
  writeFileSync(filepath, code);

  const { stdout, stderr, exitCode } = spawnSync([bunExe(), "test", "test-i-have-been-reached.test.js"], {
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(stdout.toString()).toContain("I have been reached!");
  expect(stderr.toString()).toContain("1 error");
});

test("test async exceptions fail tests", () => {
  const code = `
  import {test, expect} from 'bun:test';
  import {EventEmitter} from 'events';
  test('test throwing inside an EventEmitter fails the test', () => {
    const emitter = new EventEmitter();
    emitter.on('event', () => {
      throw new Error('test throwing inside an EventEmitter #FAIL001');
    });
    emitter.emit('event');
  });

  test('test throwing inside a queueMicrotask callback fails', async () => {

    queueMicrotask(() => {
      throw new Error('test throwing inside an EventEmitter #FAIL002');
    });

    await 1;
  });

  test('test throwing inside a process.nextTick callback fails', async () => {

    process.nextTick(() => {
      throw new Error('test throwing inside an EventEmitter #FAIL003');
    });

    await 1;
  });



  `;
  const dir = tmpdirSync();
  const filepath = join(dir, "test-throwing-eventemitter.test.js");
  rmSync(filepath, {
    force: true,
  });

  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {}
  writeFileSync(filepath, code);

  const { stderr, exitCode } = spawnSync([bunExe(), "test", "test-throwing-eventemitter"], {
    cwd: dir,
    env: bunEnv,
  });

  const str = stderr!.toString();
  expect(str).toContain("#FAIL001");
  expect(str).toContain("#FAIL002");
  expect(str).toContain("#FAIL003");
  expect(str).toContain("3 fail");
  expect(str).toContain("0 pass");

  expect(exitCode).toBe(1);
});

it("should return non-zero exit code for invalid syntax", async () => {
  const test_dir = tmpdirSync();
  try {
    await writeFile(join(test_dir, "bad.test.js"), "!!!");
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test", "bad.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const err = (await stderr.text()).replaceAll("\\", "/");
    expect(err.replaceAll(test_dir.replaceAll("\\", "/"), "<dir>").replaceAll(/\[[\d.]+m?s\]/g, "[xx ms]"))
      .toMatchInlineSnapshot(`
      "
      bad.test.js:

      # Unhandled error between tests
      -------------------------------
      1 | !!!
            ^
      error: Unexpected end of file
          at <dir>/bad.test.js:1:3
      -------------------------------


       0 pass
       1 fail
       1 error
      Ran 1 test across 1 file. [xx ms]
      "
    `);
    expect(stdout).toBeDefined();
    expect(await stdout.text()).toBe(`bun test ${Bun.version_with_sha}\n`);
    expect(await exited).toBe(1);
  } finally {
    await rm(test_dir, { force: true, recursive: true });
  }
});

it("invalid syntax counts towards bail", async () => {
  const test_dir = tmpdirSync();
  try {
    await writeFile(join(test_dir, "bad1.test.js"), "!!!");
    await writeFile(join(test_dir, "bad2.test.js"), "!!!");
    await writeFile(join(test_dir, "bad3.test.js"), "!!!");
    await writeFile(join(test_dir, "bad4.test.js"), "!!!");
    await writeFile(join(test_dir, "bad5.test.js"), "!!!");
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test", "--bail=3"],
      cwd: test_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const err = await stderr.text();
    expect(err).toContain("Bailed out after 3 failures");
    expect(err).not.toContain("DO NOT RUN ME");
    expect(err).toContain("Ran 3 tests across 3 files");
    expect(stdout).toBeDefined();
    expect(await stdout.text()).toBe(`bun test ${Bun.version_with_sha}\n`);
    expect(await exited).toBe(1);
  } finally {
    // await rm(test_dir, { force: true, recursive: true });
  }
});

describe("skip test inner", () => {
  it("should pass", () => {
    expect(2 + 2).toBe(4);
  });

  describe.skip("skip", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });

    describe("skip non-skipped inner", () => {
      it("should throw", () => {
        throw new Error("This should not throw. `.skip` is broken");
      });
    });
  });
});

describe.skip("skip test outer", () => {
  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });

  describe("skip non-skipped inner", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });

  describe("skip nested non-skipped inner", () => {
    describe("skip", () => {
      it("should throw", () => {
        throw new Error("This should not throw. `.skip` is broken");
      });
    });
  });
});

describe("skip test inner 2", () => {
  it("should pass", () => {
    expect(2 + 2).toBe(4);
  });

  describe.skip("skip", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });
});

describe.skip("skip beforeEach", () => {
  beforeEach(() => {
    throw new Error("should not run `beforeEach`");
  });

  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

describe("nested beforeEach and afterEach", () => {
  let value = 0;

  beforeEach(() => {
    value += 1;
  });

  afterEach(() => {
    value += 1;
  });

  describe("runs beforeEach", () => {
    it("should update value", () => {
      expect(value).toBe(1);
    });
  });

  describe.skip("skips", () => {
    it("should throw", async () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });

  describe.skip("skips async", () => {
    it("should throw", async () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });

  describe("runs beforeEach again", () => {
    it("should have value as 3", () => {
      expect(value).toBe(3);
    });
  });
});

describe.skip("skip afterEach", () => {
  afterEach(() => {
    throw new Error("should not run `afterEach`");
  });

  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

describe.skip("skip beforeAll", () => {
  beforeAll(() => {
    throw new Error("should not run `beforeAll`");
  });

  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

describe.skip("skip afterAll", () => {
  afterAll(() => {
    throw new Error("should not run `afterAll`");
  });

  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

// no labels

describe.skip(() => {
  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

describe(() => {
  it("should pass", () => {
    expect(2 + 2).toBe(4);
  });

  describe.skip("skip", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });
});

it("test.todo", () => {
  const path = join(tmp, "todo-test.test.js");
  copyFileSync(join(import.meta.dir, "todo-test-fixture.js"), path);
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "test", path, "--todo"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: dirname(path),
  });
  const err = stderr!.toString();
  expect(err).toContain("this test is marked as todo but passes");
  expect(err).toContain("this async error is shown");
  expect(err).toContain("this async error with an await is shown");
  expect(err).toContain("this error is shown");
  expect(err).toContain("4 todo");
  expect(err).toContain("0 pass");
  expect(err).toContain("3 fail");
  expect(exitCode).toBe(1);
});

it("test.todo doesnt cause exit code 1", () => {
  const path = join(tmp, "todo-test.test.js");
  copyFileSync(join(import.meta.dir, "todo-test-fixture-2.js"), path);
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "test", path, "--todo"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: dirname(path),
  });

  const err = stderr!.toString();
  expect(exitCode).toBe(0);
});

it("test timeouts when expected", () => {
  const path = join(tmp, "test-timeout.test.js");
  copyFileSync(join(import.meta.dir, "timeout-test-fixture.js"), path);
  const { stderr } = spawnSync({
    cmd: [bunExe(), "test", path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: dirname(path),
  });

  const err = stderr!.toString();
  expect(err).toHaveTestTimedOutAfter(10);
  expect(err).not.toContain("unreachable code");
});

test("jest.setTimeout will change default timeout", () => {
  const path = join(tmp, "jest-setTimeout-test.test.js");
  copyFileSync(join(import.meta.dir, "setTimeout-test-fixture.js"), path);
  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "test", path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: dirname(path),
  });

  const err = stderr!.toString();
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
});

it("expect().toEqual() on objects with property indices doesn't print undefined", () => {
  const path = join(tmp, "test-fixture-diff-indexed-properties.test.js");
  copyFileSync(join(import.meta.dir, "test-fixture-diff-indexed-properties.js"), path);
  const { stderr } = spawnSync({
    cmd: [bunExe(), "test", path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: dirname(path),
  });

  let err = stderr!.toString();
  err = err.substring(err.indexOf("expect(received).toEqual(expected)"), err.indexOf("at ")).trim();

  expect(err).toMatchSnapshot();
  expect(err).not.toContain("undefined");
});

it("test --preload supports global lifecycle hooks", () => {
  const preloadedPath = join(tmp, "test-fixture-preload-global-lifecycle-hook-preloaded.js");
  const path = join(tmp, "test-fixture-preload-global-lifecycle-hook-test.test.js");
  copyFileSync(join(import.meta.dir, "test-fixture-preload-global-lifecycle-hook-test.js"), path);
  copyFileSync(join(import.meta.dir, "test-fixture-preload-global-lifecycle-hook-preloaded.js"), preloadedPath);
  const { stdout } = spawnSync({
    cmd: [bunExe(), "test", "--preload=" + preloadedPath, path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: dirname(path),
  });
  expect(stdout.toString().trim()).toBe(
    `
bun test ${Bun.version_with_sha}
beforeAll: #1
beforeAll: #2
beforeAll: TEST-FILE
beforeAll: one describe scope
beforeEach: #1
beforeEach: #2
beforeEach: TEST-FILE
beforeEach: one describe scope
-- inside one describe scope --
afterEach: one describe scope
afterEach: TEST-FILE
afterEach: #1
afterEach: #2
afterAll: one describe scope
beforeEach: #1
beforeEach: #2
beforeEach: TEST-FILE
-- the top-level test --
afterEach: TEST-FILE
afterEach: #1
afterEach: #2
afterAll: TEST-FILE
afterAll: #1
afterAll: #2
`.trim(),
  );
});

it("skip() and skipIf()", () => {
  const path = join(tmp, "skip-test-fixture.test.js");
  copyFileSync(join(import.meta.dir, "skip-test-fixture.js"), path);
  const { stdout } = spawnSync({
    cmd: [bunExe(), "test", path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: dirname(path),
  });
  const result = stdout!.toString();
  expect(result).not.toContain("unreachable");
  expect(result).toMatch(/reachable/);
  expect(result.match(/reachable/g)).toHaveLength(6);
});

it("should run beforeAll() & afterAll() even without tests", async () => {
  const test_dir = tmpdirSync();
  try {
    await writeFile(
      join(test_dir, "empty.test.js"),
      `
beforeAll(() => console.log("before all"));
beforeEach(() => console.log("before each"));
afterEach(() => console.log("after each"));
afterAll(() => console.log("after all"));

describe("empty", () => {
  beforeAll(() => console.log("before all scoped"));
  beforeEach(() => console.log("before each scoped"));
  afterEach(() => console.log("after each scoped"));
  afterAll(() => console.log("after all scoped"));
});
    `,
    );
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test", "empty.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(stderr).toBeDefined();
    const err = await stderr.text();
    expect(err).toContain("0 pass");
    expect(err).toContain("0 fail");
    expect(stdout).toBeDefined();
    const out = await stdout.text();
    expect(out.split(/\r?\n/)).toEqual([
      `bun test ${Bun.version_with_sha}`,
      "before all",
      "before all scoped",
      "after all scoped",
      "after all",
      "",
    ]);
    expect(await exited).toBe(0);
  } finally {
    await rm(test_dir, { force: true, recursive: true });
  }
});

describe("unhandled errors between tests are reported", () => {
  const stages = ["beforeAll", "beforeEach", "afterEach", "afterAll", "describe"];

  for (const stage of stages) {
    test("in " + stage, () => {
      const code = /*js*/ `
import {test, beforeAll, expect, beforeEach, afterEach, afterAll, describe} from "bun:test";

${stage}(async () => {
  Promise.resolve().then(() => {
    throw new Error('## stage ${stage} ##');
  });
  await Bun.sleep(1);
});

test("my-test", () => {
  expect(1).toBe(1);
});
    `.trim();

      using test_dir = tempDir("unhandled-" + stage, {
        "my-test.test.js": code,
        "package.json": "{}",
      });

      const { stderr, exited } = spawnSync({
        cmd: [bunExe(), "test", "my-test.test.js"],
        cwd: test_dir,
        stdout: "inherit",
        stderr: "pipe",
        env: bunEnv,
      });
      const output = stderr.toString();

      expect(output).toContain(`## stage ${stage} ##`);

      expect(output).toContain("1 | import {test, beforeAll, expect, beforeEach, afterEach, afterAll, describe}");

      const stackLines = output.split("\n").filter(line => line.trim().startsWith("at "));
      expect(stackLines.length).toBeGreaterThan(0);
      if (process.platform === "win32") {
        expect(stackLines[0]).toContain(`<dir>\\my-test.test.js:5:15`.replace("<dir>", test_dir));
      }
      if (process.platform !== "win32") {
        expect(stackLines[0]).toContain(`<dir>/my-test.test.js:5:15`.replace("<dir>", test_dir));
      }

      expect(output).toContain("1 pass"); // since the error is unhandled and in a hook, the error does not get attributed to the hook and the test is still allowed to run
      expect(output).toContain("0 fail");
      expect(output).toContain("1 error");

      expect(output).toContain("Ran 1 test across 1 file");
    });
  }
});

// https://github.com/oven-sh/bun/issues/14644
describe("an error that reaches a test while its async body still runs", () => {
  async function run(source: string) {
    using dir = tempDir("error-during-async-body", { "a.test.js": source });
    await using proc = spawn({
      cmd: [bunExe(), "test", "a.test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      log: stdout.split("\n").filter(line => line !== "" && !line.startsWith("bun test ")),
      errors: stderr.match(/^error: .*$/gm) ?? [],
      results: stderr.match(/^\((pass|fail)\) [^[\n]*[^[\n ]/gm) ?? [],
      stderr,
      exitCode,
    };
  }

  test.concurrent("afterEach and the next test wait for the body", async () => {
    const { log, errors, results, exitCode } = await run(`
      import { beforeEach, afterEach, test } from "bun:test";

      beforeEach(() => { console.log("beforeEach"); });
      afterEach(() => { console.log("afterEach"); });

      test("a", async () => {
        console.log("test a start");
        ;(async () => { throw 123; })();
        await Bun.sleep(1);
        console.log("test a end");
      });

      test("b", async () => {
        console.log("test b");
        await Bun.sleep(1);
      });
    `);
    expect({ log, errors, results, exitCode }).toEqual({
      log: ["beforeEach", "test a start", "test a end", "afterEach", "beforeEach", "test b", "afterEach"],
      errors: ["error: 123"],
      results: ["(fail) a", "(pass) b"],
      exitCode: 1,
    });
  });

  test.concurrent("however the error is reported", async () => {
    const { log, results, exitCode } = await run(`
      import { afterEach, test } from "bun:test";
      const tick = () => new Promise(resolve => setImmediate(resolve));
      afterEach(() => console.log("afterEach"));

      const reports = {
        "floating rejection": () => void (async () => { throw new Error("floating rejection"); })(),
        "reportError": () => reportError(new Error("reportError")),
        "throwing event listener": () => {
          const target = new EventTarget();
          target.addEventListener("event", () => { throw new Error("throwing event listener"); });
          target.dispatchEvent(new Event("event"));
        },
        "throwing microtask": () => queueMicrotask(() => { throw new Error("throwing microtask"); }),
        "throwing nextTick": () => process.nextTick(() => { throw new Error("throwing nextTick"); }),
        "throwing timer": () => new Promise(resolve => setTimeout(() => { resolve(); throw new Error("throwing timer"); })),
      };
      for (const [name, report] of Object.entries(reports)) {
        test(name, async () => {
          console.log(name + ": start");
          await report();
          await tick();
          console.log(name + ": end");
        });
      }
      test("next", () => { console.log("next"); });
    `);
    const failed = [
      "floating rejection",
      "reportError",
      "throwing event listener",
      "throwing microtask",
      "throwing nextTick",
      "throwing timer",
    ];
    expect({ log, results, exitCode }).toEqual({
      log: [...failed.flatMap(name => [`${name}: start`, `${name}: end`, "afterEach"]), "next", "afterEach"],
      results: [...failed.map(name => `(fail) ${name}`), "(pass) next"],
      exitCode: 1,
    });
  });

  test.concurrent("a later failure in the body is reported on the same test", async () => {
    const { errors, results, stderr, exitCode } = await run(`
      import { expect, test } from "bun:test";
      const tick = () => new Promise(resolve => setImmediate(resolve));

      test("fails twice", async () => {
        Promise.reject(new Error("first failure"));
        await tick();
        expect("second").toBe("failure");
      });
      test("next", () => {});
    `);
    expect(stderr).not.toContain("Unhandled error between tests");
    expect({ errors, results, exitCode }).toEqual({
      errors: ["error: first failure", "error: expect(received).toBe(expected)"],
      results: ["(fail) fails twice", "(pass) next"],
      exitCode: 1,
    });
  });

  test.concurrent("a retry starts after the attempt's body, and a stale completion does not end it", async () => {
    const { log, results, exitCode } = await run(`
      import { afterEach, describe, expect, test } from "bun:test";
      const tick = () => new Promise(resolve => setImmediate(resolve));

      describe("attempts", () => {
        afterEach(() => console.log("afterEach"));
        let attempts = 0;
        test("do not overlap", { retry: 1 }, async () => {
          const attempt = ++attempts;
          console.log("attempt " + attempt + ": start");
          Promise.reject(new Error("attempt " + attempt));
          await tick();
          console.log("attempt " + attempt + ": end");
        });
      });

      // In each of these, attempt 1 leaves a completion behind. Attempt 2 fails on its own, later.
      let synchronous = 0;
      test("a synchronous attempt", { retry: 1 }, async () => {
        if (++synchronous === 1) return reportError(new Error("attempt 1"));
        await tick();
        expect("attempt 2").toBe("a failure");
      });
      let doneOnly = 0;
      test("an attempt that called done(err)", { retry: 1 }, done => {
        if (++doneOnly === 1) return done(new Error("attempt 1"));
        setImmediate(() => {
          try {
            expect("attempt 2").toBe("a failure");
            done();
          } catch (error) {
            done(error);
          }
        });
      });
      let timedOut = 0;
      let settleAttempt1;
      test("an attempt that timed out", { retry: 1, timeout: 50 }, async () => {
        if (++timedOut === 1) return await new Promise(resolve => (settleAttempt1 = resolve));
        settleAttempt1();
        await tick();
        await tick();
        expect("attempt 2").toBe("a failure");
      });
    `);
    expect({ log, results, exitCode }).toEqual({
      log: ["attempt 1: start", "attempt 1: end", "afterEach", "attempt 2: start", "attempt 2: end", "afterEach"],
      results: [
        "(fail) attempts > do not overlap (attempt 2)",
        "(fail) a synchronous attempt (attempt 2)",
        "(fail) an attempt that called done(err) (attempt 2)",
        "(fail) an attempt that timed out (attempt 2)",
      ],
      exitCode: 1,
    });
  });

  test.concurrent("with a done callback", async () => {
    const { log, results, stderr, exitCode } = await run(`
      import { afterEach, test } from "bun:test";
      const tick = () => new Promise(resolve => setImmediate(resolve));
      afterEach(() => console.log("afterEach"));

      test("the promise ends a failed test, done() is not awaited too", async done => {
        console.log("1: start");
        Promise.reject(new Error("1"));
        await tick();
        console.log("1: end");
      });
      test("done() first, then the error", async done => {
        console.log("2: start");
        done();
        Promise.reject(new Error("2"));
        await tick();
        console.log("2: end");
      });
      test("the next test does not start inside done(err)", async done => {
        console.log("3: start");
        await tick();
        done(new Error("3"));
        console.log("3: after done(err)");
      });
      test("done(err) ends a test whose promise never settles", done => {
        console.log("4: start");
        done(new Error("4"));
        return new Promise(() => {});
      });
      test("a late done(err) ends a test whose promise never settles", done => {
        console.log("5: start");
        setImmediate(() => done(new Error("5")));
        return new Promise(() => {});
      });
      test("a test that only waits for done() still ends at the error", done => {
        console.log("6: start");
        setImmediate(() => { throw new Error("6"); });
      });
      test("next", () => { console.log("next"); });
    `);
    expect(stderr).not.toContain("timed out");
    expect({ log, results, exitCode }).toEqual({
      log: [
        ...["1: start", "1: end", "afterEach"],
        ...["2: start", "2: end", "afterEach"],
        ...["3: start", "3: after done(err)", "afterEach"],
        ...["4: start", "afterEach"],
        ...["5: start", "afterEach"],
        ...["6: start", "afterEach"],
        ...["next", "afterEach"],
      ],
      results: [
        "(fail) the promise ends a failed test, done() is not awaited too",
        "(fail) done() first, then the error",
        "(fail) the next test does not start inside done(err)",
        "(fail) done(err) ends a test whose promise never settles",
        "(fail) a late done(err) ends a test whose promise never settles",
        "(fail) a test that only waits for done() still ends at the error",
        "(pass) next",
      ],
      exitCode: 1,
    });
  });

  test.concurrent("a body that never settles ends at the test's deadline", async () => {
    const { log, results, stderr, exitCode } = await run(`
      import { afterEach, describe, test } from "bun:test";

      // 50 ms: the deadline is the only thing left that ends these tests.
      describe("errored", () => {
        afterEach(() => console.log("afterEach"));
        test("ends at its deadline", async () => {
          console.log("errored: start");
          Promise.reject(new Error("errored"));
          await new Promise(() => {});
        }, 50);
      });
      describe("timed out", () => {
        afterEach(done => {
          console.log("afterEach(done)");
          setImmediate(done);
        });
        test("its promise does not hold the hook's done()", async () => {
          console.log("timed out: start");
          await new Promise(() => {});
        }, 50);
      });
      test("next", () => { console.log("next"); });
    `);
    expect({ log, results, timeouts: stderr.match(/\^ .*timed out.*/g), exitCode }).toEqual({
      log: ["errored: start", "afterEach", "timed out: start", "afterEach(done)", "next"],
      results: [
        "(fail) errored > ends at its deadline",
        "(fail) timed out > its promise does not hold the hook's done()",
        "(pass) next",
      ],
      timeouts: ["^ this test timed out after 50ms.", "^ this test timed out after 50ms."],
      exitCode: 1,
    });
  });

  test.concurrent("hooks and concurrent tests are as before", async () => {
    const { log, errors, results, stderr, exitCode } = await run(`
      import { beforeEach, describe, test } from "bun:test";
      const tick = () => new Promise(resolve => setImmediate(resolve));

      describe("hook", () => {
        beforeEach(async () => {
          console.log("beforeEach: start");
          Promise.reject(new Error("in a hook"));
          await tick();
          console.log("beforeEach: end");
        });
        test("runs after it", () => { console.log("test"); });
      });
      describe("concurrent", () => {
        test.concurrent("a", async () => {
          console.log("a: start");
          Promise.reject(new Error("in a"));
          await tick();
          console.log("a: end");
        });
        test.concurrent("b", async () => {
          console.log("b: start");
          await tick();
          console.log("b: end");
        });
      });
    `);
    expect(stderr.match(/Unhandled error between tests/g)).toHaveLength(2);
    expect({ log, errors, results, exitCode }).toEqual({
      log: ["beforeEach: start", "beforeEach: end", "test", "a: start", "b: start", "a: end", "b: end"],
      errors: ["error: in a hook", "error: in a"],
      results: ["(pass) hook > runs after it", "(pass) concurrent > a", "(pass) concurrent > b"],
      exitCode: 1,
    });
  });
});
