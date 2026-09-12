import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import path from "path";

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

describe("done(err) fails the test or hook whose done() received it", () => {
  // Only the lines that show what each error was attributed to, plus the totals.
  function resultLines(stderr: string) {
    return normalizeBunSnapshot(stderr)
      .split("\n")
      .map(line => line.trim())
      .filter(line => /^(\((pass|fail)\) |error: |# Unhandled error|\d+ (pass|fail|errors?)$)/.test(line))
      .join("\n");
  }

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
    return { stdout: normalizeBunSnapshot(stdout), results: resultLines(stderr), exitCode };
  }

  // `suffix` is "" or ".concurrent". Everything up to the macrotask case completes while being
  // started, so serial and concurrent runs report in the same order. The beforeAll case goes
  // last so that the tests it skips cannot include any of the other cases.
  const fixture = (suffix: string) => `
    import { it, describe, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";

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
    describe${suffix}("beforeEach", () => {
      beforeEach(done => {
        done(new Error("beforeEach boom"));
      });
      it("body is skipped", () => {
        console.log("beforeEach > body ran");
      });
    });
    describe${suffix}("afterEach", () => {
      afterEach(async done => {
        await 1;
        done(new Error("afterEach boom"));
      });
      it("test fails", () => {
        console.log("afterEach > body ran");
      });
    });
    describe${suffix}("afterAll", () => {
      afterAll(async done => {
        await 1;
        done(new Error("afterAll boom"));
      });
      it("test passes", () => {
        console.log("afterAll > body ran");
      });
    });
    it${suffix}("macrotask done(err)", done => {
      setTimeout(() => done(new Error("macrotask boom")), 1);
    });
    describe${suffix}("beforeAll", () => {
      beforeAll(done => {
        done(new Error("beforeAll boom"));
      });
      it("body is skipped", () => {
        console.log("beforeAll > body ran");
      });
    });
  `;

  const expected = {
    exitCode: 1,
    stdout: "bun test <version> (<revision>)\nafterEach > body ran\nafterAll > body ran",
    results: [
      "error: sync boom",
      "(fail) sync done(err)",
      "error: microtask boom",
      "(fail) microtask done(err)",
      "(pass) done() without an error",
      "(pass) failing test whose done() receives an error",
      "error: beforeEach boom",
      "(fail) beforeEach > body is skipped",
      "error: afterEach boom",
      "(fail) afterEach > test fails",
      "(pass) afterAll > test passes",
      "error: afterAll boom",
      "(fail) afterAll > (unnamed)",
      "error: macrotask boom",
      "(fail) macrotask done(err)",
      "error: beforeAll boom",
      "(fail) beforeAll > (unnamed)",
      "3 pass",
      "7 fail",
    ].join("\n"),
  };

  test.concurrent.each([
    { name: "serial", suffix: "", args: [] },
    { name: "bun test --concurrent", suffix: "", args: ["--concurrent"] },
    { name: "it.concurrent and describe.concurrent", suffix: ".concurrent", args: [] },
  ])("$name", async ({ suffix, args }) => {
    expect(await runFixture(fixture(suffix), args)).toEqual(expected);
  });

  // In each case the "stale" test is already over (timed out, or its body threw before the
  // runner took charge of its pending done) when its done(err) fires during the second test.
  test.concurrent.each([
    {
      name: "its test timed out",
      staleTest: `it("stale", done => { fireLater(done, fn => setTimeout(fn, 20)); }, 1);`,
      staleResult: ["(fail) stale"],
    },
    {
      name: "its test threw after scheduling it on a macrotask",
      staleTest: `it("stale", done => { fireLater(done, setImmediate); throw new Error("thrown boom"); });`,
      staleResult: ["error: thrown boom", "(fail) stale"],
    },
    {
      name: "its test threw after scheduling it on a microtask",
      staleTest: `it("stale", done => { fireLater(done, queueMicrotask); throw new Error("thrown boom"); });`,
      staleResult: ["error: thrown boom", "(fail) stale"],
    },
  ])("a late done(err) is not pinned on the running test when $name", async ({ staleTest, staleResult }) => {
    const run = await runFixture(`
      import { it } from "bun:test";
      const fired = Promise.withResolvers();
      const fireLater = (done, schedule) =>
        schedule(() => {
          done(new Error("late boom"));
          fired.resolve();
        });
      ${staleTest}
      it("is running when the late done(err) arrives", async () => {
        await fired.promise;
      });
    `);
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        ...staleResult,
        "# Unhandled error between tests",
        "error: late boom",
        "(pass) is running when the late done(err) arrives",
        "1 pass",
        "1 fail",
        "1 error",
      ].join("\n"),
    });
  });
});
