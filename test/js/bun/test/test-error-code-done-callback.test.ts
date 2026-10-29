import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// Only the lines that show what each error was charged to, which entries timed out, and the totals.
function resultLines(stderr: string) {
  return stderr
    .split("\n")
    .map(line =>
      line
        .trim()
        .replace(/ \[[\d.]+m?s\]$/, "")
        .replace(/^\^ (this test|a beforeEach\/afterEach hook) timed out.*/, "^ timed out"),
    )
    .filter(line =>
      /^(\((pass|fail|todo)\) |error: |# Unhandled error|\^ timed out$|\d+ (pass|fail|todo|errors?)$)/.test(line),
    )
    .join("\n");
}

// Runs `source` as a test file. `stdout` is what the file printed, without the banner of `bun test`.
async function runFixture(source: string, args: string[] = []) {
  using dir = tempDir("done-err", { "done-err.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: stdout.split("\n").filter(line => line !== "" && !line.startsWith("bun test v")),
    results: resultLines(stderr),
    exitCode,
  };
}

// `suffix` is "" or ".concurrent". Every case but the last one completes while it is started,
// so serial and concurrent runs report in the same order.
const doneErrFixture = (suffix: string) => `
  import { it } from "bun:test";

  it${suffix}("sync done(err)", done => {
    done(new Error("sync boom"));
  });
  it${suffix}("microtask done(err)", async done => {
    await 1;
    done(new Error("microtask boom"));
  });
  it${suffix}("done() without an error", done => {
    done();
  });
  it${suffix}.failing("failing test whose done() receives an error", done => {
    done(new Error("expected boom"));
  });
  it${suffix}.todo("todo test whose done() receives an error", done => {
    done(new Error("todo boom"));
  });
  const graph = new Bun.ModuleGraph({ onError: error => console.log("the graph's onError got: " + error.message) });
  it${suffix}("done(err) inside the run() of a Bun.ModuleGraph", done => {
    graph.run(() => done(new Error("graph boom")));
  });
  it${suffix}("macrotask done(err)", done => {
    setTimeout(() => done(new Error("macrotask boom")), 1);
  });
`;

// `--todo` runs the body of the todo test.
test.concurrent.each([
  { name: "serial", suffix: "", args: ["--todo"] },
  { name: "bun test --concurrent", suffix: "", args: ["--todo", "--concurrent"] },
  { name: "it.concurrent", suffix: ".concurrent", args: ["--todo"] },
])("done(err) fails the test whose done() received it, $name", async ({ suffix, args }) => {
  expect(await runFixture(doneErrFixture(suffix), args)).toEqual({
    exitCode: 1,
    stdout: [],
    results: [
      "error: sync boom",
      "(fail) sync done(err)",
      "error: microtask boom",
      "(fail) microtask done(err)",
      "(pass) done() without an error",
      "(pass) failing test whose done() receives an error",
      "error: todo boom",
      "(todo) todo test whose done() receives an error",
      "error: graph boom",
      "(fail) done(err) inside the run() of a Bun.ModuleGraph",
      "error: macrotask boom",
      "(fail) macrotask done(err)",
      "2 pass",
      "1 todo",
      "4 fail",
    ].join("\n"),
  });
});

test.concurrent("done(err) fails each attempt of a retried test in a concurrent group", async () => {
  const run = await runFixture(`
    import { it } from "bun:test";
    it.concurrent("retried", done => {
      setImmediate(() => done(new Error("boom")));
    }, { retry: 1 });
    it.concurrent("passes", () => {});
  `);
  expect(run).toEqual({
    exitCode: 1,
    stdout: [],
    results: ["(pass) passes", "error: boom", "error: boom", "(fail) retried (attempt 2)", "1 pass", "1 fail"].join(
      "\n",
    ),
  });
});

// done(err) is called before the callback returns its promise, which only the second test
// settles. done(err) ends the first test without the promise, as it does once the callback has
// returned. The first test is past its timeout by then, and that must not make it a timeout.
test.concurrent("done(err) ends its test at once when the promise of the callback is still pending", async () => {
  const run = await runFixture(`
    import { it, describe } from "bun:test";
    for (const [name, test] of [["it", it], ["it.concurrent", it.concurrent]]) {
      for (const [mode, first] of [["", test], [".failing", test.failing]]) {
        describe(name + mode, () => {
          const settledBySecond = Promise.withResolvers();
          first("first", done => {
            done(new Error("boom"));
            Bun.sleepSync(20);
            return settledBySecond.promise;
          }, 10);
          test("second", () => {
            settledBySecond.resolve();
          });
        });
      }
    }
  `);
  expect(run).toEqual({
    exitCode: 1,
    stdout: [],
    results: [
      "error: boom",
      "(fail) it > first",
      "(pass) it > second",
      "(pass) it.failing > first",
      "(pass) it.failing > second",
      "error: boom",
      "(pass) it.concurrent > second",
      "(pass) it.concurrent.failing > second",
      "(fail) it.concurrent > first",
      "(pass) it.concurrent.failing > first",
      "6 pass",
      "2 fail",
    ].join("\n"),
  });
});

// The first call of done() passed no error, so the error of the second call is ignored and the
// test still waits for its promise.
test.concurrent("done(err) does not end its test when it is the second call of done()", async () => {
  const run = await runFixture(`
    import { it } from "bun:test";
    for (const [name, test] of [["it", it], ["it.concurrent", it.concurrent]]) {
      test(name, async done => {
        done();
        done(new Error("ignored boom"));
        await new Promise(resolve => setImmediate(resolve));
        throw new Error("thrown after both calls");
      });
    }
  `);
  expect(run).toEqual({
    exitCode: 1,
    stdout: [],
    results: [
      "error: thrown after both calls",
      "(fail) it",
      "error: thrown after both calls",
      "(fail) it.concurrent",
      "0 pass",
      "2 fail",
    ].join("\n"),
  });
});

// A hook's done(err) fails nothing, so it must not end the hook either: the test body starts only
// after the promise that the hook returned has settled.
test.concurrent("done(err) of a hook does not end the hook before its promise settles", async () => {
  const run = await runFixture(`
    import { beforeEach, it } from "bun:test";
    beforeEach(done => {
      done(new Error("hook boom"));
      return new Promise(resolve =>
        setTimeout(() => {
          console.log("the promise of the hook settled");
          resolve();
        }, 1),
      );
    });
    it("runs after the hook", () => {
      console.log("the test body ran");
    });
  `);
  expect(run).toEqual({
    exitCode: 1,
    stdout: ["the promise of the hook settled", "the test body ran"],
    results: [
      "# Unhandled error between tests",
      "error: hook boom",
      "(pass) runs after the hook",
      "1 pass",
      "0 fail",
      "1 error",
    ].join("\n"),
  });
});

// toThrow() of a function that returns a pending promise runs the event loop until the promise
// settles, with the VM's unhandled-error handler replaced by one that reports nothing. Each
// done(err) is called inside that wait, and the wait ends only after it.
test.concurrent("done(err) fails its test when it is called while toThrow() waits on a promise", async () => {
  const run = await runFixture(`
    import { it, describe, expect } from "bun:test";
    function waitInToThrow(until) {
      expect(async () => {
        await until;
        throw new Error("thrown");
      }).toThrow("thrown");
    }
    function lateDone(message) {
      const fired = Promise.withResolvers();
      return {
        fired: fired.promise,
        fire: done =>
          setImmediate(() => {
            done(new Error(message));
            fired.resolve();
          }),
      };
    }
    describe("during its own toThrow() wait", () => {
      const late = lateDone("own boom");
      it("fails", done => {
        late.fire(done);
        waitInToThrow(late.fired);
      });
    });
    describe.concurrent("during a sibling's toThrow() wait", () => {
      const late = lateDone("sibling boom");
      it("fails", done => {
        late.fire(done);
      });
      it("waits", () => {
        waitInToThrow(late.fired);
      });
    });
    describe("inside the function given to toThrow()", () => {
      it("fails, and is not what the function threw", done => {
        expect(() => {
          done(new Error("inside boom"));
        }).not.toThrow();
      });
    });
  `);
  expect(run).toEqual({
    exitCode: 1,
    stdout: [],
    results: [
      "error: own boom",
      "(fail) during its own toThrow() wait > fails",
      "error: sibling boom",
      "(pass) during a sibling's toThrow() wait > waits",
      "(fail) during a sibling's toThrow() wait > fails",
      "error: inside boom",
      "(fail) inside the function given to toThrow() > fails, and is not what the function threw",
      "1 pass",
      "3 fail",
    ].join("\n"),
  });
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
