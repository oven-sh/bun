// @ts-nocheck
import { spawn, spawnSync } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { copyFileSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir, tmpdirSync } from "harness";
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

describe("a callback that ends after its timeout without a yield", () => {
  // Each late callback passes its timeout inside one call, so the runner gets control back only after the callback
  // ended: Bun.sleepSync() blocks, and Bun.spawnSync() and tick() wait inside the call.
  async function runFixture(name: string, source: string, args: string[] = []) {
    using dir = tempDir("late-" + name, { "late.test.js": source, "package.json": "{}" });
    await using proc = spawn({
      cmd: [bunExe(), "test", ...args, "late.test.js"],
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    // Errors, test lines, the note under a test line, what a fixture reports with "ran:", and the counts.
    const lines = stderr
      .split(/\r?\n/)
      .filter(line => /^(error: |\((pass|fail|todo)\) |  \^ \S|ran: | +\d+ (pass|fail|todo)$)/.test(line));
    const junit = Bun.file(join(String(dir), "junit.xml"));
    return {
      lines: normalizeBunSnapshot(lines.join("\n")),
      junit: (await junit.exists()) ? await junit.text() : "",
      exitCode,
    };
  }

  // Bun.build() waits for an async plugin setup() inside the call, with the main event loop running. So the
  // timeout timer of the test can run under the test callback.
  const tick = /*js*/ `
    function tick(ms) {
      try {
        Bun.build({
          entrypoints: ["./none.ts"],
          plugins: [{ name: "tick", setup: () => new Promise((_, reject) => setTimeout(() => reject(new Error("stop")), ms)) }],
        });
      } catch {}
    }
  `;

  test.concurrent("keeps its own result when it threw", async () => {
    const { lines, junit, exitCode } = await runFixture(
      "throw",
      /*js*/ `
        import { afterAll, afterEach, beforeAll, beforeEach, describe, onTestFinished, test } from "bun:test";
        ${tick}

        test("throws", () => {
          Bun.sleepSync(30);
          throw new Error("thrown by the test");
        }, 10);
        test("rejects", async () => {
          await 0;
          Bun.sleepSync(30);
          throw new Error("rejected by the test");
        }, 10);
        test("returns a rejected promise", () => {
          Bun.sleepSync(30);
          return Promise.reject(new Error("rejected promise"));
        }, 10);
        test("returns an object whose then getter throws", () => {
          Bun.sleepSync(30);
          return {
            get then() {
              throw new Error("thrown by the then getter");
            },
          };
        }, 10);
        test("returns a thenable that rejects", () => {
          Bun.sleepSync(30);
          return {
            then(_, reject) {
              reject(new Error("rejected by the thenable"));
            },
          };
        }, 10);
        test("returns a thenable whose then() throws", () => {
          Bun.sleepSync(30);
          return {
            then() {
              throw new Error("thrown by then()");
            },
          };
        }, 10);
        test("calls done(error)", done => {
          Bun.sleepSync(30);
          done(new Error("passed to done"));
        }, 10);
        test("calls done(error) from a microtask", done => {
          Bun.sleepSync(30);
          queueMicrotask(() => done(new Error("passed to done from a microtask")));
        }, 10);
        test("calls done(error) from an async callback", async done => {
          Bun.sleepSync(30);
          done(new Error("passed to done by an async callback"));
        }, 10);
        test("calls done(error) and returns a thenable", done => {
          Bun.sleepSync(30);
          done(new Error("passed to done before the thenable"));
          return {
            then(resolve) {
              resolve();
            },
          };
        }, 10);
        test("throws after done()", done => {
          done();
          Bun.sleepSync(30);
          throw new Error("thrown after done()");
        }, 10);
        test.failing("test.failing throws", () => {
          Bun.sleepSync(30);
          throw new Error("the expected failure");
        }, 10);
        test.failing("test.failing returns a thenable that rejects", () => {
          Bun.sleepSync(30);
          return {
            then(_, reject) {
              reject(new Error("the expected failure"));
            },
          };
        }, 10);
        test.failing("test.failing with retry throws", () => {
          Bun.sleepSync(30);
          throw new Error("the expected failure");
        }, { timeout: 10, retry: 1 });
        test.todo("test.todo throws", () => {
          Bun.sleepSync(30);
          throw new Error("thrown by the todo test");
        }, 10);
        test.concurrent("test.concurrent throws", () => {
          Bun.sleepSync(30);
          throw new Error("thrown by the concurrent test");
        }, 10);
        test.concurrent("its sibling", () => {});
        describe("beforeAll throws", () => {
          beforeAll(() => {
            Bun.sleepSync(30);
            throw new Error("thrown by beforeAll");
          }, 10);
          test("test", () => {});
        });
        describe("beforeEach throws", () => {
          beforeEach(() => {
            Bun.sleepSync(30);
            throw new Error("thrown by beforeEach");
          }, 10);
          test("test", () => {});
        });
        describe("afterEach throws", () => {
          afterEach(() => {
            Bun.sleepSync(30);
            throw new Error("thrown by afterEach");
          }, 10);
          test("test", () => {});
          test("a test that threw in time", () => {
            throw new Error("thrown in time");
          });
        });
        describe("afterAll throws", () => {
          afterAll(() => {
            Bun.sleepSync(30);
            throw new Error("thrown by afterAll");
          }, 10);
          test("test", () => {});
        });
        test("onTestFinished throws", () => {
          onTestFinished(() => {
            Bun.sleepSync(30);
            throw new Error("thrown by onTestFinished");
          }, 10);
        });

        // The error of a hook cannot fail a test whose body already failed as expected, so these two do not fail.
        describe("a hook throws in time after the body failed as expected late", () => {
          afterEach(() => {
            throw new Error("thrown by afterEach in time");
          });
          test.failing("test.failing", () => {
            Bun.sleepSync(30);
            throw new Error("the expected failure");
          }, 10);
          test.todo("test.todo", () => {
            Bun.sleepSync(30);
            throw new Error("thrown by the todo test");
          }, 10);
        });

        // The timeout timer runs inside tick(), and bun has no process to kill for it.
        test("throws after the timeout timer ran under it", () => {
          Bun.sleepSync(30);
          tick(1);
          throw new Error("thrown after the timer ran");
        }, 10);
      `,
      ["--todo", "--reporter=junit", "--reporter-outfile=junit.xml"],
    );
    expect(lines).toMatchInlineSnapshot(`
      "error: thrown by the test
      (fail) throws
      error: rejected by the test
      (fail) rejects
      error: rejected promise
      (fail) returns a rejected promise
      error: thrown by the then getter
      (fail) returns an object whose then getter throws
      error: rejected by the thenable
      (fail) returns a thenable that rejects
      error: thrown by then()
      (fail) returns a thenable whose then() throws
      error: passed to done
      (fail) calls done(error)
      error: passed to done from a microtask
      (fail) calls done(error) from a microtask
      error: passed to done by an async callback
      (fail) calls done(error) from an async callback
      error: passed to done before the thenable
      (fail) calls done(error) and returns a thenable
      error: thrown after done()
      (fail) throws after done()
      (pass) test.failing throws
      (pass) test.failing returns a thenable that rejects
      (pass) test.failing with retry throws
      error: thrown by the todo test
      (todo) test.todo throws
      error: thrown by the concurrent test
      (fail) test.concurrent throws
      (pass) its sibling
      error: thrown by beforeAll
      (fail) beforeAll throws > (unnamed)
      error: thrown by beforeEach
      (fail) beforeEach throws > test
      error: thrown by afterEach
      (fail) afterEach throws > test
      error: thrown in time
      error: thrown by afterEach
      (fail) afterEach throws > a test that threw in time
      (pass) afterAll throws > test
      error: thrown by afterAll
      (fail) afterAll throws > (unnamed)
      error: thrown by onTestFinished
      (fail) onTestFinished throws
      error: thrown by afterEach in time
      (pass) a hook throws in time after the body failed as expected late > test.failing
      error: thrown by the todo test
      error: thrown by afterEach in time
      (todo) a hook throws in time after the body failed as expected late > test.todo
      error: thrown after the timer ran
      (fail) throws after the timeout timer ran under it
       6 pass
       2 todo
       19 fail"
    `);
    expect(junit).toContain('<failure type="Error" message="thrown by the test">');
    expect(junit).not.toContain("TimeoutError");
    expect(exitCode).toBe(1);
  });

  test.concurrent("is timed out when it returned, or when its error could not fail the test", async () => {
    const { lines, exitCode } = await runFixture(
      "returned",
      /*js*/ `
        import { afterEach, beforeEach, describe, expect, onTestFinished, test } from "bun:test";

        test("returns", () => {
          Bun.sleepSync(30);
        }, 10);
        test("resolves", async () => {
          await 0;
          Bun.sleepSync(30);
        }, 10);
        test.failing("test.failing returns", () => {
          Bun.sleepSync(30);
        }, 10);
        test("calls done()", done => {
          Bun.sleepSync(30);
          done();
        }, 10);
        test("returns after expect.soft() failed", () => {
          expect.soft(1).toBe(2);
          Bun.sleepSync(30);
        }, 10);
        test("returns after a stray rejection", () => {
          Promise.reject(new Error("stray rejection"));
          Bun.sleepSync(30);
        }, 10);

        // The timeout is longer in the next four, because their failure has to come before the timeout.
        test("calls done(error) in time and returns late", done => {
          done(new Error("passed to done in time"));
          Bun.sleepSync(300);
        }, 250);
        test.failing("test.failing calls done(error) in time and returns late", done => {
          done(new Error("the expected failure"));
          Bun.sleepSync(300);
        }, 250);

        // The matcher waits for the promise, fails in a microtask, and the test does not await it.
        function failsUnawaited() {
          const { promise, resolve } = Promise.withResolvers();
          expect(promise).resolves.toBe(2);
          resolve(1);
        }
        test("returns after a matcher it did not await failed", async () => {
          failsUnawaited();
          for (let i = 0; i < 8; i++) await 0;
          Bun.sleepSync(300);
        }, 250);
        test.failing("test.failing returns after a matcher it did not await failed", async () => {
          failsUnawaited();
          for (let i = 0; i < 8; i++) await 0;
          Bun.sleepSync(300);
        }, 250);

        describe("afterEach returns late after a test that threw in time", () => {
          afterEach(() => {
            Bun.sleepSync(30);
          }, 10);
          // bun skips the hooks behind a hook that timed out, so this one does not run.
          afterEach(() => {
            console.error("ran: the afterEach behind the late one");
          });
          test("test", () => {
            throw new Error("thrown in time");
          });
          test.failing("test.failing", () => {
            throw new Error("the expected failure");
          });
        });

        // The error of done(error) in a hook does not fail the test that the hook runs for.
        describe("beforeEach calls done(error)", () => {
          beforeEach(done => {
            Bun.sleepSync(30);
            done(new Error("passed to done by beforeEach"));
          }, 10);
          test("test", () => {});
        });

        // The error of a hook cannot fail a test whose body already failed as expected.
        describe("a hook throws after the body failed as expected in time", () => {
          describe("afterEach", () => {
            afterEach(() => {
              Bun.sleepSync(30);
              throw new Error("thrown by afterEach");
            }, 10);
            test.failing("test.failing", () => {
              throw new Error("the expected failure");
            });
            test.todo("test.todo", () => {
              throw new Error("thrown by the todo test");
            });
          });
          test.failing("onTestFinished, test.failing", () => {
            onTestFinished(() => {
              Bun.sleepSync(30);
              throw new Error("thrown by onTestFinished");
            }, 10);
            throw new Error("the expected failure");
          });
        });
      `,
      ["--todo"],
    );
    expect(lines).toMatchInlineSnapshot(`
      "(fail) returns
        ^ this test timed out after 10ms.
      (fail) resolves
        ^ this test timed out after 10ms.
      (fail) test.failing returns
        ^ this test timed out after 10ms.
      (fail) calls done()
        ^ this test timed out after 10ms, before its done callback was called. If a done callback was not intended, remove the last parameter from the test callback function
      error: expect(received).toBe(expected)
      (fail) returns after expect.soft() failed
        ^ this test timed out after 10ms.
      error: stray rejection
      (fail) returns after a stray rejection
        ^ this test timed out after 10ms.
      error: passed to done in time
      (fail) calls done(error) in time and returns late
        ^ this test timed out after 250ms, before its done callback was called. If a done callback was not intended, remove the last parameter from the test callback function
      (fail) test.failing calls done(error) in time and returns late
        ^ this test timed out after 250ms, before its done callback was called. If a done callback was not intended, remove the last parameter from the test callback function
      error: expect(received).toBe(expected)
      (fail) returns after a matcher it did not await failed
        ^ this test timed out after 250ms.
      (fail) test.failing returns after a matcher it did not await failed
        ^ this test timed out after 250ms.
      error: thrown in time
      (fail) afterEach returns late after a test that threw in time > test
        ^ a beforeEach/afterEach hook timed out for this test.
      (fail) afterEach returns late after a test that threw in time > test.failing
        ^ a beforeEach/afterEach hook timed out for this test.
      error: passed to done by beforeEach
      (fail) beforeEach calls done(error) > test
        ^ a beforeEach/afterEach hook timed out before its done callback was called. If a done callback was not intended, remove the last parameter from the hook callback function
      error: thrown by afterEach
      (fail) a hook throws after the body failed as expected in time > afterEach > test.failing
        ^ a beforeEach/afterEach hook timed out for this test.
      error: thrown by the todo test
      error: thrown by afterEach
      (fail) a hook throws after the body failed as expected in time > afterEach > test.todo
        ^ a beforeEach/afterEach hook timed out for this test.
      error: thrown by onTestFinished
      (fail) a hook throws after the body failed as expected in time > onTestFinished, test.failing
        ^ a beforeEach/afterEach hook timed out for this test.
       0 pass
       16 fail"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("is timed out when bun killed a process for its timeout before it threw", async () => {
    const { lines, exitCode } = await runFixture(
      "killed",
      /*js*/ `
        import { test } from "bun:test";
        ${tick}
        const cmd = [process.execPath, "-e", "setTimeout(() => {}, 60_000)"];

        // This test is the first one, so the timer of the file is set to its deadline. The timer runs inside
        // tick(), and bun kills the child there.
        test("throws after bun killed the process it spawned", () => {
          Bun.spawn({ cmd, stdio: ["ignore", "ignore", "ignore"] });
          tick(100);
          throw new Error("thrown after bun killed the child");
        }, 50);

        // Bun.spawnSync() kills its child when the timeout passes, and the test throws because of that.
        const child = () => Bun.spawnSync({ cmd });
        test("throws after Bun.spawnSync outlived the timeout", () => {
          if (child().exitCode !== 0) throw new Error("the child did not exit with 0");
        }, 100);
        test.failing("test.failing throws after Bun.spawnSync outlived the timeout", () => {
          if (child().exitCode !== 0) throw new Error("the child did not exit with 0");
        }, 100);
        test.failing("test.failing rejects after Bun.spawnSync outlived the timeout", async () => {
          await 0;
          if (child().exitCode !== 0) throw new Error("the child did not exit with 0");
        }, 100);
        test.concurrent("test.concurrent throws after Bun.spawnSync outlived the timeout", () => {
          if (child().exitCode !== 0) throw new Error("the child of the concurrent test did not exit with 0");
        }, 100);
        test.concurrent.failing("test.concurrent.failing throws after Bun.spawnSync outlived the timeout", () => {
          if (child().exitCode !== 0) throw new Error("the child did not exit with 0");
        }, 100);
      `,
    );
    expect(lines).toMatchInlineSnapshot(`
      "error: thrown after bun killed the child
      (fail) throws after bun killed the process it spawned
        ^ this test timed out after 50ms.
      error: the child did not exit with 0
      (fail) throws after Bun.spawnSync outlived the timeout
        ^ this test timed out after 100ms.
      (fail) test.failing throws after Bun.spawnSync outlived the timeout
        ^ this test timed out after 100ms.
      (fail) test.failing rejects after Bun.spawnSync outlived the timeout
        ^ this test timed out after 100ms.
      error: the child of the concurrent test did not exit with 0
      (fail) test.concurrent throws after Bun.spawnSync outlived the timeout
        ^ this test timed out after 100ms.
      (fail) test.concurrent.failing throws after Bun.spawnSync outlived the timeout
        ^ this test timed out after 100ms.
       0 pass
       6 fail"
    `);
    expect(exitCode).toBe(1);
  });
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

describe.concurrent("hooks of a describe block that does not run", () => {
  const fixture = `
    import { afterAll, afterEach, beforeAll, beforeEach, describe, test, xdescribe } from "bun:test";
    function hooks(name) {
      beforeAll(() => console.log(name, "beforeAll"));
      beforeEach(() => console.log(name, "beforeEach"));
      afterEach(() => console.log(name, "afterEach"));
      afterAll(() => console.log(name, "afterAll"));
    }
    function block(name) {
      return [name, () => {
        hooks(name);
        test("outer", () => { throw new Error("not done yet"); });
        describe("nested", () => {
          hooks(name + " nested");
          test("inner", () => { throw new Error("not done yet"); });
        });
      }];
    }
    describe.skip(...block("skip"));
    xdescribe(...block("xdescribe"));
    describe.skipIf(true)(...block("skipIf"));
    describe.if(false)(...block("if"));
    describe.todo(...block("todo"));
    describe.todoIf(true)(...block("todoIf"));
    describe("runs", () => {
      hooks("runs");
      test("outer", () => {});
    });
  `;

  async function run(...args: string[]) {
    using dir = tempDir("hooks-in-skipped-describe", { "hooks.test.js": fixture });
    await using proc = spawn({
      cmd: [bunExe(), "test", "hooks.test.js", "--reporter=junit", "--reporter-outfile=junit.xml", ...args],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const junit = await Bun.file(join(String(dir), "junit.xml")).text();
    return {
      hooks: stdout.split("\n").filter(line => /(All|Each)$/.test(line)),
      reported: stderr
        .split("\n")
        .filter(line => /^\((pass|fail|skip|todo)\) /.test(line))
        .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
      summary: stderr.split("\n").filter(line => /^ \d+ (pass|fail|skip|todo)$|^Ran /.test(line)),
      junit: [
        /<testsuites [^>]*?(tests="\d+").*?(skipped="\d+")/.exec(junit)?.slice(1),
        junit.match(/<testcase /g)?.length,
      ],
      exitCode,
    };
  }
  const ran = ["runs beforeAll", "runs beforeEach", "runs afterEach", "runs afterAll"];
  const skipped = ["skip", "xdescribe", "skipIf", "if"].flatMap(name => [
    `(skip) ${name} > outer`,
    `(skip) ${name} > nested > inner`,
  ]);
  const todo = ["todo", "todoIf"].flatMap(name => [`(todo) ${name} > outer`, `(todo) ${name} > nested > inner`]);

  it("are not reported as tests", async () => {
    const { summary, ...result } = await run();
    expect(result).toEqual({
      hooks: ran,
      reported: [...skipped, ...todo, "(pass) runs > outer"],
      junit: [[`tests="13"`, `skipped="12"`], 13],
      exitCode: 0,
    });
    expect(summary.map(line => line.replace(/ \[.*$/, ""))).toEqual([
      " 1 pass",
      " 8 skip",
      " 4 todo",
      " 0 fail",
      "Ran 13 tests across 1 file.",
    ]);
  });

  it("run in describe.todo() with --todo", async () => {
    const { summary, ...result } = await run("--todo");
    expect(result).toEqual({
      hooks: [
        ...["todo", "todoIf"].flatMap(name => [
          `${name} beforeAll`,
          `${name} beforeEach`,
          `${name} afterEach`,
          `${name} nested beforeAll`,
          `${name} beforeEach`,
          `${name} nested beforeEach`,
          `${name} nested afterEach`,
          `${name} afterEach`,
          `${name} nested afterAll`,
          `${name} afterAll`,
        ]),
        ...ran,
      ],
      reported: [...skipped, ...todo, "(pass) runs > outer"],
      junit: [[`tests="13"`, `skipped="12"`], 13],
      exitCode: 0,
    });
  });
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
