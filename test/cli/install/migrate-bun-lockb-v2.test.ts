import { file, spawn } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cp } from "node:fs/promises";
import { join } from "node:path";
const { parseLockfile } = install_test_helpers;

test("old binary lockfile migrates successfully", async () => {
  const oldLockfileContents = await file(join(import.meta.dir, "fixtures/bun.lockb.v2")).text();
  using testDir = tempDir("migrate-bun-lockb-v2", {
    "bunfig.toml": "install.saveTextLockfile = false",
    "package.json": JSON.stringify({
      name: "migrate-bun-lockb-v2",
      dependencies: {
        jquery: "~3.7.1",
        "is-even": "^1.0.0",
      },
    }),
  });

  await cp(join(import.meta.dir, "fixtures/bun.lockb.v2"), join(testDir, "bun.lockb"));

  const oldLockfile = parseLockfile(testDir);

  let { stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: testDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  let err = await stderr.text();

  expect(await exited).toBe(0);
  expect(err).toContain("Saved lockfile");

  const newLockfileContents = await file(join(testDir, "bun.lockb")).bytes();
  const newLockfile = parseLockfile(testDir);

  // contents should be different due to semver numbers changing size
  expect(newLockfileContents).not.toEqual(oldLockfileContents);
  // but parse result should be the same
  expect(newLockfile).toEqual(oldLockfile);

  // another install should not change the lockfile
  ({ stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: testDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  }));

  expect(await exited).toBe(0);
  expect(await stderr.text()).not.toContain("Saved lockfile");

  const newLockfileContents2 = await file(join(testDir, "bun.lockb")).bytes();
  const newLockfile2 = parseLockfile(testDir);
  expect(newLockfileContents2).toEqual(newLockfileContents);
  expect(newLockfile2).toEqual(newLockfile);
});
