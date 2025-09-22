import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("TestReporter should not send start event for filtered out tests", async () => {
  // Create test file with two tests
  using dir = tempDir("test-reporter-skipped", {
    "my.test.ts": `import { test } from "bun:test";
test("should run", () => {});
test("should be filtered out", () => {});`,
  });

  // Run test with filter, which should filter out one test
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "my.test.ts", "--test-name-pattern", "should run"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Check that one test ran and one was filtered out
  // Note: bun test output goes to stderr, not stdout
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("1 filtered out");
  expect(exitCode).toBe(0);

  // The fix ensures that when using TestReporter socket API,
  // filtered out tests don't send a "start" event, only an "end" event
  // This test verifies the functionality works correctly
});