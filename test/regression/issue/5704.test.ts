// https://github.com/oven-sh/bun/issues/5704
import { test, expect } from "bun:test";
import { tmpdir } from "os";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe } from "harness";

test("running a empty script should not return a missing script error", () => {
  const tmp = mkdtempSync(join(tmpdir(), "bun-test-"));
  writeFileSync(join(tmp, "empty-file.ts"), "");

  const result = Bun.spawnSync({
    cmd: [bunExe(), "run", join(tmp, "empty-file.ts")],
    cwd: tmp,
    env: bunEnv,
  });

  expect(result.exitCode).toBe(0);
});
