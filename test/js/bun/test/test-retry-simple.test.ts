import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe("test retry option", () => {
  test("retry: test should pass if it passes on retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "retry-pass-"));
    try {
      writeFileSync(
        join(dir, "test.ts"),
        `
import { test, expect } from "bun:test";

let attempts = 0;
test("flaky test", () => {
  attempts++;
  if (attempts < 3) {
    throw new Error("Failed on attempt " + attempts);
  }
  expect(attempts).toBe(3);
}, { retry: 3 });
`,
      );

      const proc = Bun.spawn({
        cmd: [bunExe(), "test", join(dir, "test.ts")],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("1 pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("retry: test should fail if it fails all retries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "retry-fail-"));
    try {
      writeFileSync(
        join(dir, "test.ts"),
        `
import { test, expect } from "bun:test";

let attempts = 0;
test("always fails", () => {
  attempts++;
  throw new Error("Failed on attempt " + attempts);
}, { retry: 2 });
`,
      );

      const proc = Bun.spawn({
        cmd: [bunExe(), "test", join(dir, "test.ts")],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain("1 fail");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("test repeats option", () => {
  test("repeats: test should fail if it fails on any repeat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repeats-fail-"));
    try {
      writeFileSync(
        join(dir, "test.ts"),
        `
import { test, expect } from "bun:test";

let attempts = 0;
test("flaky test", () => {
  attempts++;
  if (attempts === 2) {
    throw new Error("Failed on attempt " + attempts);
  }
}, { repeats: 3 });
`,
      );

      const proc = Bun.spawn({
        cmd: [bunExe(), "test", join(dir, "test.ts")],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain("1 fail");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repeats: test should pass if it passes all repeats", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repeats-pass-"));
    try {
      writeFileSync(
        join(dir, "test.ts"),
        `
import { test, expect } from "bun:test";

let attempts = 0;
test("always passes", () => {
  attempts++;
  expect(attempts).toBeGreaterThan(0);
}, { repeats: 5 });
`,
      );

      const proc = Bun.spawn({
        cmd: [bunExe(), "test", join(dir, "test.ts")],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("1 pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
