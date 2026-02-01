import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test for issue #26660: Shell interpreter crash when spawning many concurrent shell commands
// The bug was that IOWriter could have pending chunks referencing freed memory after
// builtin/cmd cleanup, causing use-after-free crashes.
test("many concurrent shell commands should not crash", async () => {
  // Spawn many shell commands concurrently (similar to what triggered the crash)
  const script = `const promises = []; for (let i = 0; i < 60; i++) { promises.push(Bun.$\`echo "Hello from shell \${i}"\`.text().then(() => {})); } await Promise.all(promises); console.log("All shell commands completed successfully");`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("All shell commands completed successfully");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("concurrent shell commands with output should not crash", async () => {
  // Test with commands that produce output, which exercises IOWriter more
  const script = `const promises = []; for (let i = 0; i < 40; i++) { promises.push(Bun.$\`echo "Line \${i}: test output"\`.text()); } const results = await Promise.all(promises); console.log("Collected", results.length, "results"); console.log("All outputs received correctly");`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("All outputs received correctly");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("shell commands with mixed builtins should not crash", async () => {
  // Test various builtins that use IOWriter
  const script = `const promises = []; for (let i = 0; i < 20; i++) { promises.push(Bun.$\`echo "Echo \${i}"\`.text().then(() => {})); promises.push(Bun.$\`pwd\`.text().then(() => {})); promises.push(Bun.$\`true\`.text().then(() => {})); } await Promise.all(promises); console.log("All builtin commands completed");`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("All builtin commands completed");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("concurrent shell commands with failing commands should handle errors", async () => {
  // Test that failing commands are handled correctly and don't cause crashes
  const script = `const promises = []; for (let i = 0; i < 20; i++) { if (i % 3 === 0) { promises.push(Bun.$\`nonexistent_command_\${i}\`.nothrow().text().catch(() => "failed")); } else { promises.push(Bun.$\`echo "Success \${i}"\`.text()); } } const results = await Promise.all(promises); console.log("Handled", results.length, "commands"); console.log("Error handling completed");`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("Error handling completed");
  expect(exitCode).toBe(0);
});
