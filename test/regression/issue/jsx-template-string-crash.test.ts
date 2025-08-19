import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("JSX lexer should not crash with slice bounds issues", async () => {
  // This used to crash with: "panic: start index N is larger than end index M"
  // due to invalid slice bounds in js_lexer.zig:767 when calculating string literal content
  // The issue occurred when suffix_len > lexer.end, causing end_pos < base

  // Test JSX with empty template strings that could trigger slice bounds issues
  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "--jsx", "react", "-e", "export function x(){return<div a={``}/>}"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 5000, // 5 second timeout
  });

  // Should not crash with slice bounds panic
  expect(exitCode).not.toBe(139); // 139 = SIGSEGV crash
  expect(stderr.toString()).not.toContain("panic");
  expect(stderr.toString()).not.toContain("start index");
  expect(stderr.toString()).not.toContain("larger than end index");
});

test("normal template strings should continue working", async () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", "console.log(`hello world`)"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(exitCode).toBe(0);
  expect(stderr.toString()).not.toContain("panic");
  expect(stdout.toString()).toContain("hello world");
});
