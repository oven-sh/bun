import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// Runs `bun test` on one file. `reported` has an entry for each error that the runner printed and for each timeout.
async function runDoneFixture(source: string) {
  using dir = tempDir("done-error", { "a.test.js": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter=junit", "--reporter-outfile=junit.xml"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const junit = await Bun.file(path.join(String(dir), "junit.xml"))
    .text()
    .catch(() => "");
  return {
    log: stdout.match(/^> ([^\r\n]*)/m)?.[1],
    reported: stderr.match(/^error: [^\r\n]*|timed out/gm),
    junitFailures: junit.match(/<failure[^>]*>/g),
    exitCode,
  };
}

test.concurrent("a test's done(error) reports once when a getter of the error calls done() again", async () => {
  const result = await runDoneFixture(`
    import { test } from "bun:test";

    // The runner reads "message" to print the error. The first read calls done() again.
    const calledAgain = [];
    function errorThatCallsDone(name, again) {
      return Object.defineProperty(new Error(), "message", {
        get() {
          if (!calledAgain.includes(name)) {
            calledAgain.push(name);
            again();
          }
          return "first";
        },
      });
    }

    test("before the callback returns", done => {
      done(errorThatCallsDone("test", () => done(new Error("second"))));
    });
    test("after the callback returned", done => {
      setImmediate(() => done(errorThatCallsDone("later", () => done(new Error("second")))));
    });
    test("with the same error", done => {
      const error = errorThatCallsDone("same error", () => done(error));
      done(error);
    });
    test("the getters ran", () => console.log("> " + calledAgain.join(", ")));
  `);
  expect(result).toEqual({
    log: "test, later, same error",
    reported: ["error: first", "error: first", "error: first"],
    junitFailures: new Array(3).fill(`<failure type="Error" message="first">`),
    exitCode: 1,
  });
});

test.concurrent("a hook's done(error) is reported when a Bun.ModuleGraph onError gives it back to done()", async () => {
  const { reported, exitCode } = await runDoneFixture(`
    import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from "bun:test";

    // The onError of a graph takes an error that a hook gives to done() in the context of the graph.
    // This one calls done() with it, inside the first call. That call must still report the error.
    function graphOf(done) {
      return new Bun.ModuleGraph({ onError: error => done(error) });
    }

    for (const [name, hook] of Object.entries({ beforeAll, beforeEach, afterEach, afterAll })) {
      describe(name, () => {
        hook(done => {
          graphOf(done).run(() => done(new Error(name + " failed")));
        });
        test("has a hook", () => {});
      });
      describe(name + ", later", () => {
        hook(done => {
          graphOf(done).run(() => setImmediate(() => done(new Error(name + " failed later"))));
        });
        test("has a hook", () => {});
      });
    }
    // The test of this hook already has its result, so the hook cannot fail it.
    describe("afterEach of a test that is expected to fail", () => {
      afterEach(done => {
        graphOf(done).run(() => done(new Error("afterEach of a failing test failed")));
      });
      test.failing("has a hook", () => {
        throw new Error("expected");
      });
    });
  `);
  expect({ reported, exitCode }).toEqual({
    reported: [
      "error: beforeAll failed",
      "error: beforeAll failed later",
      "error: beforeEach failed",
      "error: beforeEach failed later",
      "error: afterEach failed",
      "error: afterEach failed later",
      "error: afterAll failed",
      "error: afterAll failed later",
      "error: afterEach of a failing test failed",
    ],
    exitCode: 1,
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
