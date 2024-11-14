import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

it("should not have a symbol collision with jsx imports", () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "jsx-collision.tsx")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString()).toBe("[Function: Fragment]\n");
  expect(stderr.toString()).toBeEmpty();
  expect(exitCode).toBe(0);
});
