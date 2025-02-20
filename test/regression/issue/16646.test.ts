import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

test("--frozen-lockfile does not create a new lockfile", async () => {
  const testDir = tmpdirSync();
  console.log(join(import.meta.dir, "../../cli/install/migration/lockfile-with-workspaces"), testDir, {
    recursive: true,
  });
  fs.cpSync(join(import.meta.dir, "../../cli/install/migration/lockfile-with-workspaces"), testDir, {
    recursive: true,
  });
  const { exitCode } = Bun.spawnSync([bunExe(), "install", "--frozen-lockfile"], {
    env: bunEnv,
    cwd: testDir,
  });
  const bunLock = Bun.file(join(testDir, "bun.lock"));

  expect(await bunLock.exists()).toBeFalse();
  expect(exitCode).toBe(0);
});
