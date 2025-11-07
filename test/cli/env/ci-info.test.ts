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
    delete cleanEnv.CI;

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

  test("Without CI env vars (allows test.only)", async () => {
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

    const cleanEnv = {...bunEnv};
    delete cleanEnv.GITHUB_ACTIONS;
    delete cleanEnv.GITLAB_CI;
    delete cleanEnv.CIRCLECI;
    delete cleanEnv.TRAVIS;
    delete cleanEnv.BUILDKITE;
    delete cleanEnv.JENKINS_URL;
    delete cleanEnv.BUILD_ID;
    delete cleanEnv.CI;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: cleanEnv,
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
