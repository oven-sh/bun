/**
 * Regression test for MovableFD null panic in shell IO
 * https://github.com/oven-sh/bun/issues/????
 *
 * This tests the fix for the panic that occurred when MovableIfWindowsFd.get() returned null
 * in the shell IO subsystem when passing file descriptors to subprocesses.
 *
 * The panic occurred in src/shell/IO.zig:154 when val.writer.fd.get().? was called
 * but get() returned null on Windows.
 */
import { $ } from "bun";
import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

// This test may not be able to reproduce the exact conditions that caused the panic
// (which involved specific timing with MovableFD being moved/taken on Windows),
// but it tests basic shell execution to ensure the fix doesn't break normal operation.
test("shell exec should not panic with null MovableFD", async () => {
  $.nothrow();
  
  // Test basic shell execution that would go through the same code path
  const result = await $`echo "hello world"`.env(bunEnv);
  expect(result.stdout.toString().trim()).toBe("hello world");
  expect(result.exitCode).toBe(0);
});

test("shell exec with bun exec should not panic", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "exec", "echo hello"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(), 
    proc.exited,
  ]);
  
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("hello");
  expect(stderr).toBe("");
});

test("shell exec with multiple commands should not panic", async () => {
  $.nothrow();
  
  // Test a more complex shell operation that might exercise the IO code paths more
  const result = await $`echo start && echo middle && echo end`.env(bunEnv);
  expect(result.stdout.toString().trim()).toBe("start\nmiddle\nend");
  expect(result.exitCode).toBe(0);
});