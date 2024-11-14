import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

it("should execute empty scripts", () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "empty-file.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString()).toBeEmpty();
  expect(stderr.toString()).toBeEmpty();
  expect(exitCode).toBe(0);
});
