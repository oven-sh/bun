import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { isOhos } from "harness";

test.skipIf(isOhos)("esbuild", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/esbuild-test.js"], {
    env: {
      ...bunEnv,
    },
    detached: true,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  expect(exitCode).toBe(0);
});
