import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// These tests use "sleep" which is not available on Windows.
describe("dangling process diagnostics", () => {
  test.skipIf(isWindows)(
    "reports PID, command name, and timeout hint for dangling processes",
    async () => {
      using dir = tempDir("dangling-diag", {
        "dangling.test.ts": `
import { test } from "bun:test";

test("spawns a process that outlives the test", async () => {
  Bun.spawn({ cmd: ["sleep", "30"] });
  await new Promise(() => {});
}, { timeout: 1000 });
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "dangling.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("killed 1 dangling process");
      expect(stderr).toMatch(/pid \d+: sleep/);
      expect(stderr).toContain("timed out after 1000ms");
      expect(stderr).toContain("hint: this test timed out because");
      expect(stderr).toContain("child process");
      expect(stderr).toContain("1 dangling process killed");
      expect(exitCode).toBe(1);
    },
    60_000,
  );

  test.skipIf(isWindows)(
    "reports multiple dangling processes with individual details",
    async () => {
      using dir = tempDir("dangling-multi", {
        "multi-dangling.test.ts": `
import { test } from "bun:test";

test("spawns multiple processes that outlive the test", async () => {
  Bun.spawn({ cmd: ["sleep", "30"] });
  Bun.spawn({ cmd: ["sleep", "31"] });
  Bun.spawn({ cmd: ["sleep", "32"] });
  await new Promise(() => {});
}, { timeout: 1000 });
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "multi-dangling.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("killed 3 dangling processes:");
      const pidMatches = stderr.match(/pid \d+: sleep/g);
      expect(pidMatches).not.toBeNull();
      expect(pidMatches!.length).toBe(3);
      expect(exitCode).toBe(1);
    },
    60_000,
  );

  test("shows timeout hint for active timers", async () => {
    using dir = tempDir("dangling-timer", {
      "timer.test.ts": `
import { test } from "bun:test";

test("has an active timer that prevents exit", async () => {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}, { timeout: 1000 });
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "timer.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("hint: this test timed out because");
    expect(stderr).toContain("active timer");
    expect(exitCode).toBe(1);
  }, 60_000);

  test.skipIf(isWindows)(
    "summary shows total dangling processes killed",
    async () => {
      using dir = tempDir("dangling-summary", {
        "summary.test.ts": `
import { test, expect } from "bun:test";

test("clean test", () => {
  expect(1 + 1).toBe(2);
});

test("leaky test", async () => {
  Bun.spawn({ cmd: ["sleep", "30"] });
  await new Promise(() => {});
}, { timeout: 1000 });
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "summary.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("1 pass");
      expect(stderr).toContain("1 fail");
      expect(stderr).toContain("1 dangling process killed");
      expect(exitCode).toBe(1);
    },
    60_000,
  );
});
