import { test, expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

test("pipe does the right thing", async () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  expect(result.stdout.toString().trim()).toBe("function");
  expect(result.exitCode).toBe(0);
});

test("file does the right thing", async () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: Bun.file(import.meta.path),
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  expect(result.stdout.toString().trim()).toBe("undefined");
  expect(result.exitCode).toBe(0);
});
