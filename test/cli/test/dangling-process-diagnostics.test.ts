import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("dangling process diagnostics", () => {
  test("reports PID and command name for dangling processes on timeout", async () => {
    using dir = tempDir("dangling-diag", {
      "dangling.test.ts": `
import { test } from "bun:test";

test("spawns a process that outlives the test", async () => {
  // Spawn a long-running process that won't exit before the test times out
  Bun.spawn({ cmd: ["sleep", "30"] });
  // Wait forever so the test times out
  await new Promise(() => {});
}, { timeout: 300 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "dangling.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should show the command name and PID in the dangling process message
    expect(stderr).toContain("killed 1 dangling process");
    expect(stderr).toMatch(/pid \d+: sleep/);
    // Should show the timeout message
    expect(stderr).toContain("timed out after 300ms");
    // Should show dangling process count in summary
    expect(stderr).toContain("dangling process");
    expect(stderr).toContain("killed");
    expect(exitCode).toBe(1);
  });

  test("reports multiple dangling processes with individual details", async () => {
    using dir = tempDir("dangling-multi", {
      "multi-dangling.test.ts": `
import { test } from "bun:test";

test("spawns multiple processes that outlive the test", async () => {
  Bun.spawn({ cmd: ["sleep", "30"] });
  Bun.spawn({ cmd: ["sleep", "31"] });
  Bun.spawn({ cmd: ["sleep", "32"] });
  await new Promise(() => {});
}, { timeout: 300 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "multi-dangling.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should show count of dangling processes
    expect(stderr).toContain("killed 3 dangling processes:");
    // Should list each with pid and command
    const pidMatches = stderr.match(/pid \d+: sleep/g);
    expect(pidMatches).not.toBeNull();
    expect(pidMatches!.length).toBe(3);
    expect(exitCode).toBe(1);
  });

  test("summary shows total dangling processes killed", async () => {
    using dir = tempDir("dangling-summary", {
      "summary.test.ts": `
import { test, expect } from "bun:test";

test("clean test", () => {
  expect(1 + 1).toBe(2);
});

test("leaky test", async () => {
  Bun.spawn({ cmd: ["sleep", "30"] });
  await new Promise(() => {});
}, { timeout: 300 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "summary.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Summary should show pass, fail, and dangling process counts
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 fail");
    expect(stderr).toContain("1 dangling process killed");
    expect(exitCode).toBe(1);
  });
});
