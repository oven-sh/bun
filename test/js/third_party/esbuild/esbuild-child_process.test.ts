import { spawnSync } from "bun";
import { describe, it, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("esbuild", () => {
  const { exitCode, stderr, stdout } = spawnSync([bunExe(), import.meta.dir + "/esbuild-test.js"], {
    env: {
      ...bunEnv,
    },
  });
  const out = "" + stderr?.toString() + stdout?.toString();
  if (exitCode !== 0 && out?.length) {
    throw new Error(out);
  }

  expect(exitCode).toBe(0);
});
