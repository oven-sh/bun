import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import { join } from "path";

describe("test retry option", () => {
  test("retry: test should pass if it passes on retry", async () => {
    using dir = tempDirWithFiles("retry-pass", {
      "test.ts": `
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
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(dir, "test.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });

  test("retry: test should fail if it fails all retries", async () => {
    using dir = tempDirWithFiles("retry-fail", {
      "test.ts": `
import { test, expect } from "bun:test";

let attempts = 0;
test("always fails", () => {
  attempts++;
  throw new Error("Failed on attempt " + attempts);
}, { retry: 2 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(dir, "test.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("1 fail");
  });

  test("retry: test should pass immediately if it passes on first try", async () => {
    using dir = tempDirWithFiles("retry-pass-first", {
      "test.ts": `
import { test, expect } from "bun:test";

let attempts = 0;
test("passes immediately", () => {
  attempts++;
  expect(attempts).toBe(1);
}, { retry: 5 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(dir, "test.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });

  test("retry: 0 means no retries", async () => {
    using dir = tempDirWithFiles("retry-zero", {
      "test.ts": `
import { test, expect } from "bun:test";

let attempts = 0;
test("fails once", () => {
  attempts++;
  if (attempts === 1) {
    throw new Error("Failed");
  }
}, { retry: 0 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(dir, "test.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("1 fail");
  });
});

describe("test repeats option", () => {
  test("repeats: test should fail if it fails on any repeat", async () => {
    using dir = tempDirWithFiles("repeats-fail", {
      "test.ts": `
import { test, expect } from "bun:test";

let attempts = 0;
test("flaky test", () => {
  attempts++;
  if (attempts === 2) {
    throw new Error("Failed on attempt " + attempts);
  }
}, { repeats: 3 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(dir, "test.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("1 fail");
  });

  test("repeats: test should pass if it passes all repeats", async () => {
    using dir = tempDirWithFiles("repeats-pass", {
      "test.ts": `
import { test, expect } from "bun:test";

let attempts = 0;
test("always passes", () => {
  attempts++;
  expect(attempts).toBeGreaterThan(0);
}, { repeats: 5 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(dir, "test.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });

  test("repeats: 1 means run once (no additional repeats)", async () => {
    using dir = tempDirWithFiles("repeats-one", {
      "test.ts": `
import { test, expect } from "bun:test";

let attempts = 0;
test("runs once", () => {
  attempts++;
  expect(attempts).toBe(1);
}, { repeats: 1 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(dir, "test.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });
});

describe("test retry and repeats together", () => {
  test("retry and repeats: should retry on failure then repeat on success", async () => {
    using dir = tempDirWithFiles("retry-repeats", {
      "test.ts": `
import { test, expect } from "bun:test";

let attempts = 0;
test("complex test", () => {
  attempts++;
  // Fail on first attempt (will retry)
  // Pass on attempts 2, 3, 4 (repeat)
  if (attempts === 1) {
    throw new Error("Failed on first attempt");
  }
  expect(attempts).toBeGreaterThan(1);
}, { retry: 2, repeats: 3 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(dir, "test.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });
});
