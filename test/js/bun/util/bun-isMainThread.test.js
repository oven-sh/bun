import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.isMainThread", () => {
  expect(Bun.isMainThread).toBeTrue();

  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), import.meta.resolveSync("./main-worker-file.js")],
    stderr: "inherit",
    stdout: "pipe",
    env: bunEnv,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe("isMainThread true\nisMainThread false\n");
});
