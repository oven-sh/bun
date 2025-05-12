import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunExe, bunEnv as env } from "harness";

test("--no-addons throws an error on process.dlopen", () => {
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "--no-addons", "-p", "process.dlopen()"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const err = stderr.toString();
  const out = stdout.toString();
  expect(exitCode).toBe(1);
  expect(out).toBeEmpty();
  expect(err).toContain("\nerror: Cannot load native addon because loading addons is disabled.");
});
