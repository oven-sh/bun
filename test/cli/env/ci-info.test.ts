import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "../../harness";

const cleanEnv = { ...bunEnv };
delete cleanEnv.GITHUB_ACTIONS;
delete cleanEnv.GITLAB_CI;
delete cleanEnv.CIRCLECI;
delete cleanEnv.TRAVIS;
delete cleanEnv.BUILDKITE;
delete cleanEnv.JENKINS_URL;
delete cleanEnv.BUILD_ID;
delete cleanEnv.CI;

async function performTest(env: Record<string, string | undefined>, result: "deny-only" | "allow-only") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./ci-info.fixture.ts"],
    env,
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // test.only should work (not throw) when CI=false
  if (result === "deny-only") {
    expect(stderr).toContain(".only is disabled in CI environments");
    expect(exitCode).toBe(1);
  } else {
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  }
}

describe("CI detection", () => {
  test("Without CI env vars, test.only should work", async () => {
    await performTest(cleanEnv, "allow-only");
  });
  test("CI=false disables CI detection even with GITHUB_ACTIONS=true", async () => {
    await performTest({ ...cleanEnv, CI: "false", GITHUB_ACTIONS: "true" }, "allow-only");
  });
  test("CI=true enables CI detection even with no CI env vars", async () => {
    await performTest({ ...cleanEnv, CI: "true" }, "deny-only");
  });
  test("CI=true enables CI detection with GITHUB_ACTIONS=true", async () => {
    await performTest({ ...cleanEnv, CI: "true", GITHUB_ACTIONS: "true" }, "deny-only");
  });
});
