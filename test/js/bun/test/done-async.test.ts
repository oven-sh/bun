import { describe, expect, test } from "bun:test";

import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";
import path from "path";

test("done() causes the test to fail when it should", async () => {
  const dir = tempDirWithFiles("done", {
    "done.test.ts": await Bun.file(path.join(import.meta.dir, "done-infinity.fixture.ts")).text(),
    "package.json": JSON.stringify({
      name: "done",
      version: "0.0.0",
      scripts: {
        test: "bun test",
      },
    }),
  });

  const $$ = new Bun.$.Shell();
  $$.nothrow();
  $$.cwd(dir);
  $$.env(bunEnv);
  const result = await $$`${bunExe()} test`;

  console.log(result.stdout.toString());
  console.log(result.stderr.toString());

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain(" 7 fail\n");
  expect(result.stderr.toString()).toContain(" 0 pass\n");
});

async function runFixture(src: string) {
  using dir = tempDir("done-double", { "done.test.js": src });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "done.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("done() called multiple times", () => {
  test("synchronous done() then done(err) fails the test and reports the user's error as the cause", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test } = require("bun:test");
      test("done then done(err)", (done) => {
        done();
        done(new Error("second call error"));
      });
    `);
    expect(stderr).toContain("Expected done to be called once, but it was called multiple times");
    expect(stderr).toContain("second call error");
    expect(stderr).toContain("1 fail");
    expect(stderr).toContain("0 pass");
    expect(exitCode).toBe(1);
  });

  test("late async done(err) after done() is not silently swallowed", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test, expect } = require("bun:test");
      test("done then late done(err)", (done) => {
        done();
        setTimeout(() => done(new Error("late error that must not be swallowed")), 20);
      });
      test("tail keeps the loop alive past the late done(err)", async () => {
        await new Promise((r) => setTimeout(r, 100));
        expect(1).toBe(1);
      });
    `);
    expect(stderr).toContain("late error that must not be swallowed");
    expect(stderr).toContain("Expected done to be called once, but it was called multiple times");
    expect(exitCode).toBe(1);
  });

  test("a second done() without an error argument is a no-op", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test } = require("bun:test");
      test("double bare done", (done) => {
        done();
        done();
      });
      test("single done", (done) => {
        done();
      });
      test("single delayed done", (done) => {
        setTimeout(() => done(), 10);
      });
    `);
    expect(stderr).not.toContain("Expected done to be called once");
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("done(err) after done() in a hook fails", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test, beforeEach } = require("bun:test");
      beforeEach((done) => {
        done();
        done(new Error("hook double done"));
      });
      test("the test", () => {});
    `);
    expect(stderr).toContain("Expected done to be called once, but it was called multiple times");
    expect(stderr).toContain("hook double done");
    expect(exitCode).toBe(1);
  });

  test("test.failing inverts a done()/done(err) failure into a pass", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test } = require("bun:test");
      test.failing("double done", (done) => {
        done();
        done(new Error("expected"));
      });
    `);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
