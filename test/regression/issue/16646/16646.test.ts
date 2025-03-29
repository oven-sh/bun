import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

test("bun install does create a new lockfile", async () => {
  const testDir = tmpdirSync();
  fs.cpSync(join(import.meta.dir), testDir, {
    recursive: true,
  });
  const { exitCode, stderr } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
  });
  const err = stderr.toString();
  expect(err).toContain("Saved lockfile");

  const bunLock = Bun.file(join(testDir, "bun.lock"));
  expect(await bunLock.exists()).toBeTrue();

  expect(exitCode).toBe(0);
});

test("bun install --frozen-lockfile does not create a new lockfile", async () => {
  const testDir = tmpdirSync();
  fs.cpSync(join(import.meta.dir), testDir, {
    recursive: true,
  });
  const { exitCode, stderr } = Bun.spawnSync([bunExe(), "install", "--frozen-lockfile"], {
    env: bunEnv,
    cwd: testDir,
  });
  const err = stderr.toString();
  expect(err).not.toContain("Saved lockfile");

  const bunLock = Bun.file(join(testDir, "bun.lock"));
  expect(await bunLock.exists()).toBeFalse();

  expect(exitCode).toBe(0);
});

test("bun install --no-save does not create a new lockfile", async () => {
  const testDir = tmpdirSync();
  fs.cpSync(join(import.meta.dir), testDir, {
    recursive: true,
  });
  const { exitCode, stderr } = Bun.spawnSync([bunExe(), "install", "--no-save"], {
    env: bunEnv,
    cwd: testDir,
  });
  const err = stderr.toString();
  expect(err).not.toContain("Saved lockfile");

  const bunLock = Bun.file(join(testDir, "bun.lock"));
  expect(await bunLock.exists()).toBeFalse();

  expect(exitCode).toBe(0);
});
