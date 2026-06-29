import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// A `done(error)` in a lifecycle hook must fail the hook's dependent tests,
// exactly like a synchronous throw in the same hook does. It used to be
// surfaced as an "Unhandled error between tests" while every dependent test
// was still counted as a pass. `node:test` routes every hook through the
// done-callback form, so that module's `before()` was affected too.
describe.concurrent("done(error) in a lifecycle hook", () => {
  // One describe block containing 2 tests; expected counts match the
  // synchronous-throw variant of each hook.
  const expected = {
    beforeAll: { pass: 0, fail: 1 },
    beforeEach: { pass: 0, fail: 2 },
    afterEach: { pass: 0, fail: 2 },
    afterAll: { pass: 2, fail: 1 },
  } as const;

  test.each(Object.keys(expected) as (keyof typeof expected)[])(
    "%s(done => done(err)) matches the synchronous-throw counts",
    async hook => {
      using dir = tempDir(`done-error-${hook}`, {
        "hook.test.ts": `
          import { describe, ${hook}, test } from "bun:test";
          describe("suite", () => {
            ${hook}(done => { done(new Error("hook failed")); });
            test("t1", () => {});
            test("t2", () => {});
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./hook.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = stdout + stderr;
      // The hook's error is still reported, attributed to the failing entry.
      expect(out).toContain("error: hook failed");
      expect(summaryCounts(out)).toEqual(expected[hook]);
      expect(exitCode).toBe(1);
    },
  );
});

// A test body that throws after handing `done` to a timer leaves an orphaned
// done callback: the throw returns from the runner before its ref is attached.
// When that done(err) fires later, it must stay an "Unhandled error between
// tests" and never be attributed to whatever entry happens to be active then.
test.concurrent("a late done(err) from a test whose body threw does not fail an unrelated test", async () => {
  using dir = tempDir("orphaned-done", {
    "orphan.test.ts": `
      import { test, describe, beforeEach } from "bun:test";
      const { promise: orphanFired, resolve: markOrphanFired } = Promise.withResolvers<void>();
      test("a", done => {
        setTimeout(() => { done(new Error("late orphan")); markOrphanFired(); }, 5);
        throw new Error("immediate");
      });
      describe("suite", () => {
        // The orphan's done(err) lands while this hook is the active entry.
        beforeEach(done => { orphanFired.then(() => done()); });
        test("b still passes", () => {});
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./orphan.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = stdout + stderr;
  expect(out).toContain("(pass) suite > b still passes");
  expect(out).toContain("Unhandled error between tests");
  expect(summaryCounts(out)).toEqual({ pass: 1, fail: 1, error: 1 });
  expect(exitCode).toBe(1);
});

/** `" 2 pass\n 0 fail\n 1 error\n"` -> `{ pass: 2, fail: 0, error: 1 }` */
function summaryCounts(out: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [, n, label] of out.matchAll(/^ (\d+) (pass|fail|skip|todo|error)s?$/gm)) {
    counts[label] = Number(n);
  }
  return counts;
}
