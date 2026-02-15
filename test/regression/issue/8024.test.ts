import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Issue #8024: Bun.spawn with a non-existent cwd prints error with wrong path
// https://github.com/oven-sh/bun/issues/8024
//
// When Bun.spawn is called with a cwd that doesn't exist, the error message
// should indicate the cwd path doesn't exist, not the binary path.

test("Bun.spawnSync with non-existent cwd should report cwd path in error", () => {
  const nonExistentCwd = "/something/that/doesnt/exist/for/sure/8024";

  try {
    Bun.spawnSync({
      cmd: ["python3"],
      stdio: ["inherit", "inherit", "inherit"],
      cwd: nonExistentCwd,
    });
    // Should not reach here
    expect(true).toBe(false);
  } catch (e: any) {
    // The error should mention the cwd path, not the binary path
    expect(e.message).toContain("no such file or directory");
    // Verify the error path is the cwd, not the binary
    expect(e.path || e.message).toContain(nonExistentCwd);
    // Should NOT say the binary doesn't exist
    expect(e.path).not.toBe("python3");
  }
});

test("Bun.spawn with non-existent cwd should report cwd path in error", async () => {
  const nonExistentCwd = "/something/that/doesnt/exist/for/sure/8024/async";

  try {
    const proc = Bun.spawn({
      cmd: ["echo", "test"],
      cwd: nonExistentCwd,
    });
    await proc.exited;
    // Should not reach here
    expect(true).toBe(false);
  } catch (e: any) {
    // The error should mention the cwd path, not the binary path
    expect(e.message).toContain("no such file or directory");
    // Verify the error path is the cwd, not the binary
    expect(e.path || e.message).toContain(nonExistentCwd);
  }
});

test("Bun.spawnSync with existing cwd but non-existent binary should report binary path", () => {
  const existingCwd = "/tmp";
  const nonExistentBinary = "/nonexistent/binary/path/that/doesnt/exist/8024";

  try {
    Bun.spawnSync({
      cmd: [nonExistentBinary],
      cwd: existingCwd,
    });
    // Should not reach here
    expect(true).toBe(false);
  } catch (e: any) {
    // The error should mention the binary path when cwd exists
    expect(e.message).toContain("no such file or directory");
    expect(e.path).toBe(nonExistentBinary);
  }
});

test("Bun.spawnSync with both valid cwd and valid binary should work", () => {
  const result = Bun.spawnSync({
    cmd: ["echo", "hello"],
    cwd: "/tmp",
    stdout: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("hello");
});
