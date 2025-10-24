import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "../../harness";

describe("CI detection", () => {
  test("CI=false disables CI detection even with GITHUB_ACTIONS=true", async () => {
    const dir = tempDirWithFiles("ci-false-test", {
      "test.test.js": `
import { test, expect } from "bun:test";

test.only("should run when CI=false", () => {
  expect(1 + 1).toBe(2);
});
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: {
        ...bunEnv,
        CI: "false",
        GITHUB_ACTIONS: "true", // Should be ignored when CI=false
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // test.only should work (not throw) when CI=false
    expect(exitCode).toBe(0);
    expect(stderr).toContain("1 pass");
  });

  test("CI=true without specific CI env vars detects as CI (blocks test.only)", async () => {
    const dir = tempDirWithFiles("ci-true-unknown", {
      "test.test.js": `
import { test, expect } from "bun:test";

test.only("should fail in CI", () => {
  expect(1 + 1).toBe(2);
});
      `,
    });

    // Clean environment - remove any CI-specific vars
    const cleanEnv = { ...bunEnv };
    delete cleanEnv.GITHUB_ACTIONS;
    delete cleanEnv.GITLAB_CI;
    delete cleanEnv.CIRCLECI;
    delete cleanEnv.TRAVIS;
    delete cleanEnv.BUILDKITE;
    delete cleanEnv.JENKINS_URL;
    delete cleanEnv.BUILD_ID;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: {
        ...cleanEnv,
        CI: "true",
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // test.only should fail (throw) when CI=true
    expect(exitCode).toBe(1);
    expect(stderr).toContain(".only is disabled in CI environments");
  });

  test("Specific CI env vars take precedence over CI=true (GITHUB_ACTIONS)", async () => {
    const dir = tempDirWithFiles("ci-github-precedence", {
      "test.test.js": `
import { test, expect } from "bun:test";

test.only("should fail in CI", () => {
  expect(1 + 1).toBe(2);
});
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: {
        ...bunEnv,
        CI: "true",
        GITHUB_ACTIONS: "true",
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // test.only should fail because github-actions CI is detected
    expect(exitCode).toBe(1);
    expect(stderr).toContain(".only is disabled in CI environments");
  });

  test("GITHUB_ACTIONS detection (blocks test.only)", async () => {
    const dir = tempDirWithFiles("ci-github-test", {
      "test.test.js": `
import { test, expect } from "bun:test";

test.only("should fail in CI", () => {
  expect(1 + 1).toBe(2);
});
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: {
        ...bunEnv,
        GITHUB_ACTIONS: "true",
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(".only is disabled in CI environments");
  });

  test("GITLAB_CI detection (blocks test.only)", async () => {
    const dir = tempDirWithFiles("ci-gitlab-test", {
      "test.test.js": `
import { test, expect } from "bun:test";

test.only("should fail in CI", () => {
  expect(1 + 1).toBe(2);
});
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: {
        ...bunEnv,
        GITLAB_CI: "true",
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(".only is disabled in CI environments");
  });

  test("CIRCLECI detection (blocks test.only)", async () => {
    const dir = tempDirWithFiles("ci-circle-test", {
      "test.test.js": `
import { test, expect } from "bun:test";

test.only("should fail in CI", () => {
  expect(1 + 1).toBe(2);
});
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: {
        ...bunEnv,
        CIRCLECI: "true",
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(".only is disabled in CI environments");
  });

  test("No CI detection with CI=false (allows test.only)", async () => {
    const dir = tempDirWithFiles("ci-none-test", {
      "test.test.js": `
import { test, expect } from "bun:test";

test.only("should run when not in CI", () => {
  expect(1 + 1).toBe(2);
});

test("should be skipped", () => {
  expect(false).toBe(true);
});
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: {
        ...bunEnv,
        CI: "false", // Explicitly disable CI detection
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // test.only should work (not throw) when CI=false
    expect(exitCode).toBe(0);
    expect(stderr).toContain("1 pass");
  });
});
