import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("exporting globalThis should not start a server", async () => {
  using dir = tempDir("issue-440", {
    "test.js": `module.exports = globalThis;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should NOT contain server started message
  expect(stderr).not.toContain("Started");
  expect(stderr).not.toContain("server:");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test("default export of globalThis should not start a server", async () => {
  using dir = tempDir("issue-440-esm", {
    "test.js": `export default globalThis;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should NOT contain server started message
  expect(stderr).not.toContain("Started");
  expect(stderr).not.toContain("server:");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
