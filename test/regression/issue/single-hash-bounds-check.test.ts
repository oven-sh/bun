import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("lexer should not crash on single # character", async () => {
  const dir = tempDirWithFiles("single-hash", {
    "single-hash.js": "#",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "single-hash.js"],
    env: bunEnv,
    cwd: dir,
  });

  const exitCode = await proc.exited;

  // The main fix is preventing a bounds check crash
  // Before the fix, this would potentially crash with a bounds error
  // After the fix, it should exit cleanly with a syntax error (exit code 1)
  expect(exitCode).toBe(1);
});