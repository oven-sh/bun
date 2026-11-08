import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import path from "path";

test("done(error) ends a test that returns a promise that never settles", async () => {
  using dir = tempDir("done-error", {
    "a.test.ts": `
      import { test } from "bun:test";
      test("ends", done => {
        done(new Error("reported"));
        return new Promise(() => {});
      });
      test("next", () => {});
    `,
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "test"], env: bunEnv, cwd: String(dir), stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: reported");
  expect(stderr).not.toContain("timed out");
  expect(stderr.match(/^\((pass|fail)\) \w+/gm)).toEqual(["(fail) ends", "(pass) next"]);
  expect(exitCode).toBe(1);
});

test("verify we print error messages passed to done callbacks", () => {
  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "test", path.resolve(import.meta.dir, "test-error-done-callback-fixture.ts")],
    env: { ...bunEnv, BUN_JSC_showPrivateScriptsInStackTraces: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  let stdoutStr = stdout
    .toString()
    .replaceAll("\\", "/")
    .replaceAll(import.meta.dir.replaceAll("\\", "/"), "<dir>")
    .replace(/\d+(\.\d+)?ms/g, "<time>ms")
    .replace(/\d+(\.\d+)?s/g, "<time>s")
    .replaceAll(Bun.version_with_sha, "<version>")
    .replaceAll("[<time>s]", "")
    .replaceAll("[<time>ms]", "")
    .split("\n")
    .map(line => line.trim())
    .join("\n");
  let stderrStr = stderr
    .toString()
    .replaceAll("\\", "/")
    .replaceAll(import.meta.dir.replaceAll("\\", "/"), "<dir>")
    .replace(/\d+(\.\d+)?ms/g, "<time>ms")
    .replace(/\d+(\.\d+)?s/g, "<time>s")
    .replaceAll(Bun.version_with_sha, "<version>")
    .replaceAll("[<time>s]", "")
    .replaceAll("[<time>ms]", "")
    .split("\n")
    .map(line => line.trim())
    .join("\n");

  expect(stdoutStr).toMatchInlineSnapshot(`
    "bun test <version>
    "
  `);
  expect(stderrStr).toMatchInlineSnapshot(`
    "
    test/js/bun/test/test-error-done-callback-fixture.ts:
    22 |   105,
    23 |   115,
    24 | );
    25 |
    26 | test("error done callback (sync)", done => {
    27 |   done(new Error(msg + "(sync)"));
    ^
    error: you should see this(sync)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:27:12)
    (fail) error done callback (sync)
    27 |   done(new Error(msg + "(sync)"));
    28 | });
    29 |
    30 | test("error done callback (async with await)", async done => {
    31 |   await 1;
    32 |   done(new Error(msg + "(async with await)"));
    ^
    error: you should see this(async with await)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:32:12)
    (fail) error done callback (async with await)
    32 |   done(new Error(msg + "(async with await)"));
    33 | });
    34 |
    35 | test("error done callback (async with Bun.sleep)", async done => {
    36 |   await Bun.sleep(0);
    37 |   done(new Error(msg + "(async with Bun.sleep)"));
    ^
    error: you should see this(async with Bun.sleep)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:37:12)
    (fail) error done callback (async with Bun.sleep)
    37 |   done(new Error(msg + "(async with Bun.sleep)"));
    38 | });
    39 |
    40 | test("error done callback (async)", done => {
    41 |   Promise.resolve().then(() => {
    42 |     done(new Error(msg + "(async)"));
    ^
    error: you should see this(async)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:42:14)
    (fail) error done callback (async)
    43 |   });
    44 | });
    45 |
    46 | test("error done callback (async, setTimeout)", done => {
    47 |   setTimeout(() => {
    48 |     done(new Error(msg + "(async, setTimeout)"));
    ^
    error: you should see this(async, setTimeout)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:48:14)
    (fail) error done callback (async, setTimeout)
    49 |   }, 0);
    50 | });
    51 |
    52 | test("error done callback (async, setImmediate)", done => {
    53 |   setImmediate(() => {
    54 |     done(new Error(msg + "(async, setImmediate)"));
    ^
    error: you should see this(async, setImmediate)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:54:14)
    (fail) error done callback (async, setImmediate)
    55 |   });
    56 | });
    57 |
    58 | test("error done callback (async, nextTick)", done => {
    59 |   process.nextTick(() => {
    60 |     done(new Error(msg + "(async, nextTick)"));
    ^
    error: you should see this(async, nextTick)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:60:14)
    (fail) error done callback (async, nextTick)
    62 | });
    63 |
    64 | test("error done callback (async, setTimeout, Promise.resolve)", done => {
    65 |   setTimeout(() => {
    66 |     Promise.resolve().then(() => {
    67 |       done(new Error(msg + "(async, setTimeout, Promise.resolve)"));
    ^
    error: you should see this(async, setTimeout, Promise.resolve)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:67:16)
    (fail) error done callback (async, setTimeout, Promise.resolve)
    70 | });
    71 |
    72 | test("error done callback (async, setImmediate, Promise.resolve)", done => {
    73 |   setImmediate(() => {
    74 |     Promise.resolve().then(() => {
    75 |       done(new Error(msg + "(async, setImmediate, Promise.resolve)"));
    ^
    error: you should see this(async, setImmediate, Promise.resolve)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:75:16)
    (fail) error done callback (async, setImmediate, Promise.resolve)

    0 pass
    9 fail
    Ran 9 tests across 1 file.
    "
  `);
});

test("an error passed to the done callback of a concurrent test fails that test", async () => {
  using dir = tempDir("done-callback-concurrent", {
    "a.test.js": `
      import { describe, test } from "bun:test";
      describe.concurrent("concurrent", () => {
        test("at once", done => done(new Error("at once")));
        test("later", done => void setImmediate(() => done(new Error("later"))));
        test("beside them", () => new Promise(resolve => setImmediate(() => setImmediate(resolve))));
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect({
    lines: stderr.match(/^(\((pass|fail)\) [a-z >]+[a-z]|error: .*|# Unhandled.*)/gm)?.sort(),
    exitCode,
  }).toEqual({
    lines: [
      "(fail) concurrent > at once",
      "(fail) concurrent > later",
      "(pass) concurrent > beside them",
      "error: at once",
      "error: later",
    ],
    exitCode: 1,
  });
});

// `files` is the source of one test file, or several files by name. A fixture prints "ran: <what>" from each
// callback that the test wants to see run. `results` are the lines that say what each error was charged to.
async function runFixture(files: string | Record<string, string>, args: string[] = []) {
  using dir = tempDir("done-err", typeof files === "string" ? { "done-err.test.ts": files } : files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    ran: stdout
      .split(/\r?\n/)
      .filter(line => line.startsWith("ran: "))
      .map(line => line.slice("ran: ".length)),
    results: normalizeBunSnapshot(stderr)
      .split("\n")
      .map(line => line.trim().replace(/^\^ .*timed out.*$/, "^ timed out"))
      .filter(line =>
        /^(\((pass|fail|skip|todo)\) |error: |# Unhandled error|\^ timed out$|Bailed out |\d+ (pass|fail|errors?)$)/.test(
          line,
        ),
      ),
    exitCode,
  };
}

describe("an error passed to a hook's done() fails that hook, like a throw from it", () => {
  // The source of a hook callback that fails with `message` when the expression `when` is true.
  type Hook = (message: string, when?: string) => string;
  const failed = (message: string, when = "true") => `${when} ? new Error("${message}") : undefined`;
  const hooks: Record<string, Hook> = {
    // The control: each way to call done(err) must give what a throw gives.
    "a throw": (message, when = "true") => `() => { if (${when}) throw new Error("${message}"); }`,
    "done(err) before the hook returns": (message, when) => `done => { done(${failed(message, when)}); }`,
    "done(err) from a later macrotask": (message, when) =>
      `done => { setImmediate(() => done(${failed(message, when)})); }`,
    "done(err) from an async hook whose promise is still pending": (message, when) =>
      `async done => { await new Promise(resolve => setImmediate(resolve)); done(${failed(message, when)}); }`,
  };

  // Runs `files(hook)` with hooks that call done(err) and with hooks that throw. Returns the first run.
  async function likeAThrow(files: (hook: Hook) => string | Record<string, string>, args: string[] = []) {
    const [done, control] = await Promise.all([
      runFixture(files(hooks["done(err) before the hook returns"]), args),
      runFixture(files(hooks["a throw"]), args),
    ]);
    expect(done).toEqual(control);
    return done;
  }

  // `suffix` is "" or ".concurrent". The beforeAll case is the last one: in a concurrent group a failed beforeAll
  // also skips the tests after its describe, whatever way it fails (https://github.com/oven-sh/bun/pull/39199).
  const eachKindOfHook = (hook: Hook, suffix: string, withOnTestFinished: boolean) => `
    import { afterAll, afterEach, beforeAll, beforeEach, describe, it, onTestFinished } from "bun:test";
    describe${suffix}("beforeEach", () => {
      beforeEach(${hook("beforeEach failed")});
      it("does not run", () => console.log("ran: beforeEach"));
    });
    describe${suffix}("afterEach", () => {
      afterEach(${hook("afterEach failed")});
      it("runs and fails", () => console.log("ran: afterEach"));
    });
    ${
      withOnTestFinished
        ? `describe("onTestFinished", () => {
             it("runs and fails", () => {
               onTestFinished(${hook("onTestFinished failed")});
               console.log("ran: onTestFinished");
             });
           });`
        : ""
    }
    describe${suffix}("afterAll", () => {
      afterAll(${hook("afterAll failed")});
      it("runs and passes", () => console.log("ran: afterAll"));
    });
    describe${suffix}("beforeAll", () => {
      beforeAll(${hook("beforeAll failed")});
      it("does not run", () => console.log("ran: beforeAll"));
    });
  `;

  describe.each([
    { mode: "serial", suffix: "", args: [] },
    { mode: "bun test --concurrent", suffix: "", args: ["--concurrent"] },
    { mode: "describe.concurrent", suffix: ".concurrent", args: [] },
  ])("$mode", ({ mode, suffix, args }) => {
    // onTestFinished() is not available in a concurrent test, and the tests of a concurrent group end in any order.
    const serial = mode === "serial";
    const inOrder = (lines: string[]) => (serial ? lines : [...lines].sort());
    const expected = {
      ran: inOrder(["afterEach", ...(serial ? ["onTestFinished"] : []), "afterAll"]),
      results: inOrder([
        "error: beforeEach failed",
        "(fail) beforeEach > does not run",
        "error: afterEach failed",
        "(fail) afterEach > runs and fails",
        ...(serial ? ["error: onTestFinished failed", "(fail) onTestFinished > runs and fails"] : []),
        "(pass) afterAll > runs and passes",
        "error: afterAll failed",
        "(fail) afterAll > (unnamed)",
        "error: beforeAll failed",
        "(fail) beforeAll > (unnamed)",
        "1 pass",
        serial ? "5 fail" : "4 fail",
      ]),
      exitCode: 1,
    };

    test.concurrent.each(Object.keys(hooks))("%s", async form => {
      const { ran, results, exitCode } = await runFixture(eachKindOfHook(hooks[form], suffix, serial), args);
      expect({ ran: inOrder(ran), results: inOrder(results), exitCode }).toEqual(expected);
    });
  });

  test.concurrent("through @jest/globals, test.beforeEach(), and a hook that a running test registers", async () => {
    const run = await likeAThrow(
      hook => `
        import { afterAll, afterEach, describe, it, onTestFinished, test } from "bun:test";
        import { beforeEach as jestBeforeEach } from "@jest/globals";
        describe("@jest/globals", () => {
          jestBeforeEach(${hook("jest beforeEach failed")});
          it("does not run", () => console.log("ran: @jest/globals"));
        });
        describe("test.beforeEach", () => {
          test.beforeEach(${hook("test.beforeEach failed")});
          it("does not run", () => console.log("ran: test.beforeEach"));
        });
        describe("registered by a running test", () => {
          it("afterEach", () => void afterEach(${hook("registered afterEach failed")}));
          it("afterAll", () => void afterAll(${hook("registered afterAll failed")}));
          it("onTestFinished", () => {
            onTestFinished(${hook("first onTestFinished failed")});
            onTestFinished(() => console.log("ran: the onTestFinished after the failed one"));
          });
        });
        describe("before a test.failing test", () => {
          test.beforeEach(${hook("beforeEach of test.failing failed")});
          it.failing("does not run", () => {
            console.log("ran: the test.failing body");
            throw new Error("the expected failure");
          });
        });
      `,
    );
    expect(run).toEqual({
      ran: [],
      results: [
        "error: jest beforeEach failed",
        "(fail) @jest/globals > does not run",
        "error: test.beforeEach failed",
        "(fail) test.beforeEach > does not run",
        "error: registered afterEach failed",
        "(fail) registered by a running test > afterEach",
        "error: registered afterAll failed",
        "(fail) registered by a running test > afterAll",
        "error: first onTestFinished failed",
        "(fail) registered by a running test > onTestFinished",
        "error: beforeEach of test.failing failed",
        "(fail) before a test.failing test > does not run",
        "0 pass",
        "6 fail",
      ],
      exitCode: 1,
    });
  });

  test.concurrent("in a hook of a preload file", async () => {
    const run = await likeAThrow(
      hook => ({
        "preload.ts": `
          import { beforeEach } from "bun:test";
          beforeEach(${hook("preload beforeEach failed")});
        `,
        "a.test.ts": `
          import { it } from "bun:test";
          it("does not run", () => console.log("ran: a"));
        `,
      }),
      ["--preload", "./preload.ts"],
    );
    expect(run).toEqual({
      ran: [],
      results: ["error: preload beforeEach failed", "(fail) does not run", "0 pass", "1 fail"],
      exitCode: 1,
    });
  });

  // A preload beforeAll runs before the first file, so it guards the tests of that file.
  test.concurrent("in a beforeAll hook of a preload file, with two test files", async () => {
    const run = await likeAThrow(
      hook => ({
        "preload.ts": `
          import { beforeAll } from "bun:test";
          beforeAll(${hook("preload beforeAll failed")});
        `,
        "a.test.ts": `
          import { it } from "bun:test";
          it("does not run", () => console.log("ran: a"));
        `,
        "b.test.ts": `
          import { it } from "bun:test";
          it("runs", () => console.log("ran: b"));
        `,
      }),
      ["--preload", "./preload.ts", "./a.test.ts", "./b.test.ts"],
    );
    expect(run).toEqual({
      ran: ["b"],
      results: ["error: preload beforeAll failed", "(fail) (unnamed)", "(pass) runs", "1 pass", "1 fail"],
      exitCode: 1,
    });
  });

  test.concurrent("--bail counts the failed hook", async () => {
    const run = await likeAThrow(
      hook => `
        import { beforeEach, describe, it } from "bun:test";
        describe("first", () => {
          beforeEach(${hook("first failed")});
          it("does not run", () => console.log("ran: first"));
        });
        it("is not reached", () => console.log("ran: second"));
      `,
      ["--bail=1"],
    );
    expect(run).toEqual({
      ran: [],
      results: ["error: first failed", "(fail) first > does not run", "Bailed out after 1 failure"],
      exitCode: 1,
    });
  });

  // A retry runs the hooks again. For test.fails a failed hook is the failure that the test expects.
  test.concurrent("a retry or test.fails absorbs it, as after a throw", async () => {
    const run = await likeAThrow(
      hook => `
        import { afterEach, beforeEach, describe, it, onTestFinished } from "bun:test";
        const attempts = { beforeEach: 0, afterEach: 0, onTestFinished: 0 };
        describe("beforeEach", () => {
          beforeEach(${hook("beforeEach failed in attempt 1", "++attempts.beforeEach === 1")});
          it("passes in attempt 2", () => console.log("ran: after beforeEach " + attempts.beforeEach), { retry: 1 });
        });
        describe("afterEach", () => {
          afterEach(${hook("afterEach failed in attempt 1", "++attempts.afterEach === 1")});
          it("passes in attempt 2", () => console.log("ran: before afterEach"), { retry: 1 });
        });
        it("onTestFinished passes in attempt 2", () => {
          onTestFinished(${hook("onTestFinished failed in attempt 1", "++attempts.onTestFinished === 1")});
          console.log("ran: before onTestFinished");
        }, { retry: 1 });
        describe("test.fails", () => {
          describe("beforeEach", () => {
            beforeEach(${hook("beforeEach failed before test.fails")});
            it.fails("passes", () => console.log("ran: the test.fails body"));
          });
          describe("afterEach", () => {
            afterEach(${hook("afterEach failed after test.fails")});
            it.fails("passes", () => console.log("ran: before the afterEach of test.fails"));
          });
        });
      `,
    );
    expect(run).toEqual({
      ran: [
        "after beforeEach 2",
        "before afterEach",
        "before afterEach",
        "before onTestFinished",
        "before onTestFinished",
        "before the afterEach of test.fails",
      ],
      results: [
        "error: beforeEach failed in attempt 1",
        "(pass) beforeEach > passes in attempt 2 (attempt 2)",
        "error: afterEach failed in attempt 1",
        "(pass) afterEach > passes in attempt 2 (attempt 2)",
        "error: onTestFinished failed in attempt 1",
        "(pass) onTestFinished passes in attempt 2 (attempt 2)",
        "(pass) test.fails > beforeEach > passes",
        "(pass) test.fails > afterEach > passes",
        "5 pass",
        "0 fail",
      ],
      exitCode: 0,
    });
  });

  // Once the test has a result that is not a failure, the runner keeps it when a hook of that test fails. A throw
  // from the hook is printed and fails nothing. The error of done() stays an unhandled error there, which fails the
  // run. When a throw fails the test in these rows, ExecutionSequence::active_entry_can_fail() has to say so too.
  test.concurrent("after the callback of a test.failing or todo test threw, it stays an unhandled error", async () => {
    const files = (hook: Hook) => `
      import { afterEach, describe, it, onTestFinished } from "bun:test";
      const fail = () => {
        throw new Error("the expected failure");
      };
      describe("test.failing", () => {
        describe("afterEach", () => {
          afterEach(${hook("afterEach failed after test.failing")});
          it.failing("passes", fail);
        });
        it.failing("onTestFinished passes", () => {
          onTestFinished(${hook("onTestFinished failed after test.failing")});
          fail();
        });
      });
      describe("test.todo", () => {
        afterEach(${hook("afterEach failed after test.todo")});
        it.todo("is todo", fail);
      });
    `;
    const [done, thrown] = await Promise.all([
      runFixture(files(hooks["done(err) before the hook returns"]), ["--todo"]),
      runFixture(files(hooks["a throw"]), ["--todo"]),
    ]);
    expect(thrown).toEqual({
      ran: [],
      results: [
        "error: afterEach failed after test.failing",
        "(pass) test.failing > afterEach > passes",
        "error: onTestFinished failed after test.failing",
        "(pass) test.failing > onTestFinished passes",
        "error: the expected failure",
        "error: afterEach failed after test.todo",
        "(todo) test.todo > is todo",
        "2 pass",
        "0 fail",
      ],
      exitCode: 0,
    });
    expect(done).toEqual({
      ran: [],
      results: [
        "# Unhandled error between tests",
        "error: afterEach failed after test.failing",
        "(pass) test.failing > afterEach > passes",
        "# Unhandled error between tests",
        "error: onTestFinished failed after test.failing",
        "(pass) test.failing > onTestFinished passes",
        "error: the expected failure",
        "# Unhandled error between tests",
        "error: afterEach failed after test.todo",
        "(todo) test.todo > is todo",
        "2 pass",
        "0 fail",
        "3 errors",
      ],
      exitCode: 1,
    });
  });

  // The runner takes the error before the handlers that see an uncaught error: toThrow() does not get it.
  test.concurrent("inside expect(fn).toThrow(), as in a test", async () => {
    const run = await runFixture(`
      import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "bun:test";
      const inToThrow = message => done => {
        expect(() => {
          done(new Error(message));
        }).toThrow(message);
      };
      describe("beforeEach", () => {
        beforeEach(inToThrow("beforeEach failed"));
        it("does not run", () => console.log("ran: beforeEach"));
      });
      describe("afterEach", () => {
        afterEach(inToThrow("afterEach failed"));
        it("runs and fails", () => console.log("ran: afterEach"));
      });
      describe("onTestFinished", () => {
        it("runs and fails", () => {
          onTestFinished(inToThrow("onTestFinished failed"));
          console.log("ran: onTestFinished");
        });
      });
      describe("test", () => {
        it("fails", inToThrow("test failed"));
      });
      describe("afterAll", () => {
        afterAll(inToThrow("afterAll failed"));
        it("runs and passes", () => console.log("ran: afterAll"));
      });
      describe("beforeAll", () => {
        beforeAll(inToThrow("beforeAll failed"));
        it("does not run", () => console.log("ran: beforeAll"));
      });
    `);
    const didNotThrow = "error: expect(received).toThrow(expected)";
    expect(run).toEqual({
      ran: ["afterEach", "onTestFinished", "afterAll"],
      results: [
        "error: beforeEach failed",
        didNotThrow,
        "(fail) beforeEach > does not run",
        "error: afterEach failed",
        didNotThrow,
        "(fail) afterEach > runs and fails",
        "error: onTestFinished failed",
        didNotThrow,
        "(fail) onTestFinished > runs and fails",
        "error: test failed",
        didNotThrow,
        "(fail) test > fails",
        "(pass) afterAll > runs and passes",
        "error: afterAll failed",
        didNotThrow,
        "(fail) afterAll > (unnamed)",
        "error: beforeAll failed",
        didNotThrow,
        "(fail) beforeAll > (unnamed)",
        "1 pass",
        "6 fail",
      ],
      exitCode: 1,
    });
  });

  // Nor does the onError of a Bun.ModuleGraph, or an uncaughtException listener while a Vitest test runs.
  test.concurrent("inside a Bun.ModuleGraph, and beside a Vitest test with an uncaughtException listener", async () => {
    const run = await runFixture(`
      import { beforeAll, beforeEach, describe, it } from "bun:test";
      import { it as vitestIt } from "vitest";

      describe("Bun.ModuleGraph", () => {
        const graph = new Bun.ModuleGraph({ onError: error => console.log("ran: onError with " + error.message) });
        beforeAll(done => {
          graph.run(() => done(new Error("inside graph.run()")));
        });
        it("does not run", () => console.log("ran: under the graph"));
      });

      describe.concurrent("listener", () => {
        process.on("uncaughtException", error => console.log("ran: the listener with " + error.message));
        describe("hooked", () => {
          beforeEach(done => {
            setImmediate(() => done(new Error("while a Vitest test runs")));
          });
          it("does not run", () => console.log("ran: the hooked test"));
        });
        vitestIt("runs beside the hook", () => new Promise(resolve => setImmediate(() => setImmediate(resolve))));
      });
    `);
    expect(run).toEqual({
      ran: [],
      results: [
        "error: inside graph.run()",
        "(fail) Bun.ModuleGraph > (unnamed)",
        "error: while a Vitest test runs",
        "(fail) listener > hooked > does not run",
        "(pass) listener > runs beside the hook",
        "1 pass",
        "2 fail",
      ],
      exitCode: 1,
    });
  });

  test.concurrent("--reporter=junit records a failure of the hook's test, not an unhandled error", async () => {
    // `testcases` has one line for each <testcase>: its suite, its name, and the message of its <failure>.
    async function junit(hook: Hook) {
      using dir = tempDir("done-err-junit", { "done-err.test.ts": eachKindOfHook(hook, "", true) });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--reporter=junit", "--reporter-outfile=./junit.xml"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = await proc.exited;
      const xml = await Bun.file(path.join(String(dir), "junit.xml")).text();
      const testcase =
        /<testcase name="([^"]*)" classname="([^"]*)"[^>]*>(?:\s*<failure type="[^"]*" message="([^"]*)")?/g;
      return {
        testcases: [...xml.matchAll(testcase)].map(
          ([, name, suite, failure]) => `${suite} > ${name}: ${failure ?? "no failure"}`,
        ),
        exitCode,
      };
    }
    const [done, control] = await Promise.all([
      junit(hooks["done(err) before the hook returns"]),
      junit(hooks["a throw"]),
    ]);
    expect(done).toEqual(control);
    expect(done).toEqual({
      testcases: [
        "beforeEach > does not run: beforeEach failed",
        "afterEach > runs and fails: afterEach failed",
        "onTestFinished > runs and fails: onTestFinished failed",
        "afterAll > runs and passes: no failure",
        "afterAll > (unnamed): afterAll failed",
        "beforeAll > (unnamed): beforeAll failed",
      ],
      exitCode: 1,
    });
  });

  // done(err) ends the hook. The runner does not wait for the promise that the hook returned, and a throw
  // after done(err) is one more error of the same failed hook. The 500 ms only bound a run that does wait.
  test.concurrent("ends the hook at once, whatever the hook does next", async () => {
    const run = await runFixture(`
      import { beforeEach, describe, it } from "bun:test";
      describe("returns a promise that never settles", () => {
        beforeEach(done => {
          done(new Error("before the promise"));
          return new Promise(() => {});
        }, 500);
        it("does not run", () => console.log("ran: never settles"));
      });
      describe("returned a promise that never settles", () => {
        beforeEach(done => {
          setImmediate(() => done(new Error("after the promise")));
          return new Promise(() => {});
        }, 500);
        it("does not run", () => console.log("ran: returned"));
      });
      describe("throws", () => {
        beforeEach(done => {
          done(new Error("before the throw"));
          throw new Error("the throw");
        });
        it("does not run", () => console.log("ran: throws"));
      });
    `);
    expect(run).toEqual({
      ran: [],
      results: [
        "error: before the promise",
        "(fail) returns a promise that never settles > does not run",
        "error: after the promise",
        "(fail) returned a promise that never settles > does not run",
        "error: before the throw",
        "error: the throw",
        "(fail) throws > does not run",
        "0 pass",
        "3 fail",
      ],
      exitCode: 1,
    });
  });

  test.concurrent("done() and an error passed to a second done() call fail nothing", async () => {
    const run = await runFixture(`
      import { afterEach, beforeAll, beforeEach, it } from "bun:test";
      beforeAll(done => {
        done();
      });
      beforeEach(done => {
        done();
        done(new Error("the second call"));
      });
      afterEach(done => {
        setImmediate(() => {
          done();
          done(new Error("the second call, later"));
        });
      });
      it("runs", () => console.log("ran: it"));
    `);
    expect(run).toEqual({ ran: ["it"], results: ["(pass) runs", "1 pass", "0 fail"], exitCode: 0 });
  });

  // The preload hook runs once for each run of the file. The first run keeps its done and fails with a throw.
  // The second run calls that done: it belongs to no hook of the second run, so it must not fail one.
  test.concurrent("a done() kept from an earlier run of the file does not fail the hook of the next run", async () => {
    const run = await runFixture(
      {
        "preload.ts": `
          import { beforeAll } from "bun:test";
          let runs = 0;
          let kept;
          beforeAll(done => {
            globalThis.runs = ++runs;
            if (runs === 1) {
              kept = done;
              throw new Error("run 1 failed");
            }
            kept(new Error("from the done() of run 1"));
            done();
          });
        `,
        "a.test.ts": `
          import { it } from "bun:test";
          it("runs", () => console.log("ran: run " + globalThis.runs));
        `,
      },
      ["--preload", "./preload.ts", "--rerun-each", "2"],
    );
    expect(run).toEqual({
      ran: ["run 2"],
      results: [
        "error: run 1 failed",
        "(fail) (unnamed)",
        "# Unhandled error between tests",
        "error: from the done() of run 1",
        "(pass) runs",
        "1 pass",
        "1 fail",
        "1 error",
      ],
      exitCode: 1,
    });
  });
});
