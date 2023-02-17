import { spawnSync } from "bun";
import { describe, it, expect, test } from "bun:test";
import { bunExe } from "bunExe";

test("esbuild", () => {
  const { exitCode, stderr, stdout } = spawnSync([bunExe(), import.meta.dir + "/esbuild-test.js"], {
    env: {
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  const out = "" + stderr?.toString() + stdout?.toString();
  if (exitCode !== 0 && out?.length) {
    throw new Error(out);
  }

  expect(exitCode).toBe(0);
});
