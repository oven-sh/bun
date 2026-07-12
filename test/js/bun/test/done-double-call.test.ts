import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

describe("done() called multiple times", () => {
  test("synchronous double done() fails the test", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test } = require("bun:test");
      test("double done", (done) => {
        done();
        done();
      });
    `);
    expect(stderr).toContain("Expected done to be called once, but it was called multiple times");
    expect(stderr).toContain("1 fail");
    expect(stderr).toContain("0 pass");
    expect(exitCode).toBe(1);
  });

  test("synchronous done() then done(err) reports the user's error as the cause", async () => {
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

  test("late async double done() without an error is not silently swallowed", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test, expect } = require("bun:test");
      test("done then late done()", (done) => {
        done();
        setTimeout(() => done(), 20);
      });
      test("tail keeps the loop alive past the late done()", async () => {
        await new Promise((r) => setTimeout(r, 100));
        expect(1).toBe(1);
      });
    `);
    expect(stderr).toContain("Expected done to be called once, but it was called multiple times");
    expect(exitCode).toBe(1);
  });

  test("done() called exactly once still passes", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test } = require("bun:test");
      test("single done", (done) => {
        done();
      });
      test("single delayed done", (done) => {
        setTimeout(() => done(), 10);
      });
    `);
    expect(stderr).not.toContain("Expected done to be called once");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("double done() in a hook fails", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test, beforeEach } = require("bun:test");
      beforeEach((done) => {
        done();
        done();
      });
      test("the test", () => {});
    `);
    expect(stderr).toContain("Expected done to be called once, but it was called multiple times");
    expect(exitCode).toBe(1);
  });

  test("test.failing inverts a double done() failure into a pass", async () => {
    const { stderr, exitCode } = await runFixture(`
      const { test } = require("bun:test");
      test.failing("double done", (done) => {
        done();
        done();
      });
    `);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
