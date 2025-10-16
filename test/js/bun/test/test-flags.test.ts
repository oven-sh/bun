// Test that test runner flags are available via testFlags from bun:test
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("testFlags.updateSnapshots is true when --update-snapshots is passed", async () => {
  using dir = tempDir("test-flags-update-snapshots", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags", () => {
        expect(testFlags.updateSnapshots).toBe(true);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--update-snapshots"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});

test("testFlags.updateSnapshots is true when -u is passed", async () => {
  using dir = tempDir("test-flags-u-flag", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags", () => {
        expect(testFlags.updateSnapshots).toBe(true);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "-u"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});

test("testFlags.updateSnapshots is false when not passed", async () => {
  using dir = tempDir("test-flags-no-update", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags", () => {
        expect(testFlags.updateSnapshots).toBe(false);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});

test("testFlags.only is true when --only is passed", async () => {
  using dir = tempDir("test-flags-only", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags", () => {
        expect(testFlags.only).toBe(true);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--only"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});

test("testFlags.runTodo is true when --todo is passed", async () => {
  using dir = tempDir("test-flags-todo", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags", () => {
        expect(testFlags.runTodo).toBe(true);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--todo"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});

test("testFlags has multiple boolean flags", async () => {
  using dir = tempDir("test-flags-multiple", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags", () => {
        expect(testFlags.concurrent).toBe(true);
        expect(testFlags.randomize).toBe(true);
        expect(testFlags.only).toBe(false);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--concurrent", "--randomize"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});

test("testFlags.bail is set when --bail is passed", async () => {
  using dir = tempDir("test-flags-bail", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags", () => {
        expect(testFlags.bail).toBe(5);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--bail=5"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});

test("testFlags.rerunEach is set when --rerun-each is passed", async () => {
  using dir = tempDir("test-flags-rerun-each", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags", () => {
        expect(testFlags.rerunEach).toBe(3);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--rerun-each=3"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});

test("testFlags.testFilterPattern is set when --test-name-pattern is passed", async () => {
  using dir = tempDir("test-flags-pattern", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags for mypattern", () => {
        expect(testFlags.testFilterPattern).toBe("mypattern");
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--test-name-pattern", "mypattern"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }

  expect(exitCode).toBe(0);
});

test("testFlags has all expected properties", async () => {
  using dir = tempDir("test-flags-properties", {
    "test.test.ts": `
      import { test, expect, testFlags } from "bun:test";

      test("check testFlags has all properties", () => {
        expect(typeof testFlags.defaultTimeout).toBe("number");
        expect(typeof testFlags.updateSnapshots).toBe("boolean");
        expect(typeof testFlags.runTodo).toBe("boolean");
        expect(typeof testFlags.only).toBe("boolean");
        expect(typeof testFlags.passWithNoTests).toBe("boolean");
        expect(typeof testFlags.concurrent).toBe("boolean");
        expect(typeof testFlags.randomize).toBe("boolean");
        expect(typeof testFlags.maxConcurrency).toBe("number");
        // These can be undefined
        expect(testFlags.rerunEach === undefined || typeof testFlags.rerunEach === "number").toBe(true);
        expect(testFlags.seed === undefined || typeof testFlags.seed === "number").toBe(true);
        expect(testFlags.bail === undefined || typeof testFlags.bail === "number").toBe(true);
        expect(testFlags.testFilterPattern === undefined || typeof testFlags.testFilterPattern === "string").toBe(true);
      });
    `,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
});
