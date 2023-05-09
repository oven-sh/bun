import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("rebuilding busts the directory entries cache", () => {
  const { exitCode, stderr } = Bun.spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "bundler-reloader-script.ts")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  });
  if (stderr.byteLength > 0) {
    throw new Error(stderr.toString());
  }

  expect(exitCode).toBe(0);
});
