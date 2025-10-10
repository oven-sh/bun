// Test that test runner flags appear in process.argv
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--update-snapshots flag appears in process.argv", async () => {
  using dir = tempDir("test-argv-update-snapshots", {
    "test.test.ts": `
      import { test, expect } from "bun:test";

      test("check argv", () => {
        const hasFlag = process.argv.includes("--update-snapshots") || process.argv.includes("-u");
        console.log("process.argv:", JSON.stringify(process.argv));
        console.log("hasFlag:", hasFlag);
        expect(hasFlag).toBe(true);
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
  expect(stdout).toContain("hasFlag: true");
});

test("-u (short flag) appears in process.argv", async () => {
  using dir = tempDir("test-argv-u-flag", {
    "test.test.ts": `
      import { test, expect } from "bun:test";

      test("check argv", () => {
        const hasFlag = process.argv.includes("--update-snapshots") || process.argv.includes("-u");
        console.log("process.argv:", JSON.stringify(process.argv));
        console.log("hasFlag:", hasFlag);
        expect(hasFlag).toBe(true);
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
  expect(stdout).toContain("hasFlag: true");
});

test("--only flag appears in process.argv", async () => {
  using dir = tempDir("test-argv-only", {
    "test.test.ts": `
      import { test, expect } from "bun:test";

      test("check argv", () => {
        const hasFlag = process.argv.includes("--only");
        console.log("process.argv:", JSON.stringify(process.argv));
        expect(hasFlag).toBe(true);
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

test("--todo flag appears in process.argv", async () => {
  using dir = tempDir("test-argv-todo", {
    "test.test.ts": `
      import { test, expect } from "bun:test";

      test("check argv", () => {
        const hasFlag = process.argv.includes("--todo");
        console.log("process.argv:", JSON.stringify(process.argv));
        expect(hasFlag).toBe(true);
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

test("multiple test flags appear in process.argv", async () => {
  using dir = tempDir("test-argv-multiple", {
    "test.test.ts": `
      import { test, expect } from "bun:test";

      test("check argv", () => {
        const hasConcurrent = process.argv.includes("--concurrent");
        const hasRandomize = process.argv.includes("--randomize");
        console.log("process.argv:", JSON.stringify(process.argv));
        expect(hasConcurrent).toBe(true);
        expect(hasRandomize).toBe(true);
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
