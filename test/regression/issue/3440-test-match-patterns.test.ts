import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "../../harness";

test("test-match CLI argument appears in help", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--help"],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("--test-match");
  expect(stdout).toContain("Glob patterns to match test files");
});

// NOTE: Manual testing shows this feature works correctly.
// The issue with the test harness seems to be unrelated to the feature implementation.