import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

test("bun install --frozen-lockfile does not create a new lockfile", async () => {
  const testDir = tmpdirSync();
  console.log(join(import.meta.dir), testDir, {
    recursive: true,
  });
  fs.cpSync(join(import.meta.dir), testDir, {
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

test("bun install does create a new lockfile", async () => {
  const testDir = tmpdirSync();
  console.log(join(import.meta.dir), testDir, {
    recursive: true,
  });
  fs.cpSync(join(import.meta.dir), testDir, {
    recursive: true,
  });
  const { exitCode } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
  });
  const bunLock = Bun.file(join(testDir, "bun.lock"));

  expect(await bunLock.exists()).toBeTrue();
  expect(exitCode).toBe(0);
});
