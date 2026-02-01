import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for issue #26660: Shell interpreter crash when spawning many concurrent shell commands
// The bug was that IOWriter could have pending chunks referencing freed memory after
// builtin/cmd cleanup, causing use-after-free crashes.
test("many concurrent shell commands should not crash", async () => {
  // Create a test script that spawns many shell commands concurrently
  // This is similar to what OpenCode does which triggered the original crash
  using dir = tempDir("issue-26660", {
    "test.ts": `
      const promises: Promise<void>[] = [];

      // Spawn 60 shell commands concurrently (similar to the crash report)
      for (let i = 0; i < 60; i++) {
        promises.push(
          Bun.$\`echo "Hello from shell \${i}"\`.text().then(() => {})
        );
      }

      await Promise.all(promises);
      console.log("All shell commands completed successfully");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");
  expect(stdout).toContain("All shell commands completed successfully");
  expect(exitCode).toBe(0);
});

test("concurrent shell commands with output should not crash", async () => {
  // Test with commands that produce output, which exercises IOWriter more
  using dir = tempDir("issue-26660-output", {
    "test.ts": `
      const promises: Promise<string>[] = [];

      // Spawn many echo commands that all write to IOWriter
      for (let i = 0; i < 40; i++) {
        promises.push(
          Bun.$\`echo "Line \${i}: This is a test with some longer output to exercise the IOWriter buffer"\`.text()
        );
      }

      const results = await Promise.all(promises);
      console.log("Collected", results.length, "results");
      console.log("All outputs received correctly");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");
  expect(stdout).toContain("All outputs received correctly");
  expect(exitCode).toBe(0);
});

test("shell commands with mixed builtins should not crash", async () => {
  // Test various builtins that use IOWriter
  using dir = tempDir("issue-26660-builtins", {
    "test.ts": `
      const promises: Promise<void>[] = [];

      // Spawn various builtin commands concurrently
      for (let i = 0; i < 20; i++) {
        promises.push(Bun.$\`echo "Echo \${i}"\`.text().then(() => {}));
        promises.push(Bun.$\`pwd\`.text().then(() => {}));
        promises.push(Bun.$\`true\`.text().then(() => {}));
      }

      await Promise.all(promises);
      console.log("All builtin commands completed");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");
  expect(stdout).toContain("All builtin commands completed");
  expect(exitCode).toBe(0);
});
