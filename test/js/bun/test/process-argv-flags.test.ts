// Test that test runner flags appear in process.argv
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--update-snapshots flag appears in process.argv", async () => {
  using dir = tempDir("test-argv-update-snapshots", {
    "test.test.ts": `
      import { test, expect } from "bun:test";

      test("check argv", () => {
        expect(process.argv.includes("--update-snapshots")).toBe(true);
        // Ensure the short form is NOT in argv (it gets normalized to long form)
        expect(process.argv.includes("-u")).toBe(false);
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

test("-u (short flag) is normalized to --update-snapshots in process.argv", async () => {
  using dir = tempDir("test-argv-u-flag", {
    "test.test.ts": `
      import { test, expect } from "bun:test";

      test("check argv", () => {
        // -u should be normalized to --update-snapshots
        expect(process.argv.includes("--update-snapshots")).toBe(true);
        // The short form should NOT appear in argv
        expect(process.argv.includes("-u")).toBe(false);
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

test("--only flag appears in process.argv", async () => {
  using dir = tempDir("test-argv-only", {
    "test.test.ts": `
      import { test, expect } from "bun:test";

      test("check argv", () => {
        expect(process.argv.includes("--only")).toBe(true);
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
        expect(process.argv.includes("--todo")).toBe(true);
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
        expect(process.argv.includes("--concurrent")).toBe(true);
        expect(process.argv.includes("--randomize")).toBe(true);
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
