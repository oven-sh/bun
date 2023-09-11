import { it, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

it("should execute empty scripts", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "empty-file.js")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});
