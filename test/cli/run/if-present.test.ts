import { it, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("should not error using `bun --if-present`", () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "--if-present", "doesnotexist"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString()).toBeEmpty();
  expect(stderr.toString()).toBeEmpty();
  expect(exitCode).toBe(0);
});

it("should not error using `bun --if-present`", () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", "--if-present", "doesnotexist"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString()).toBeEmpty();
  expect(stderr.toString()).toBeEmpty();
  expect(exitCode).toBe(0);
});
