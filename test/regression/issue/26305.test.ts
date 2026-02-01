import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, runBunInstall, tempDirWithFiles } from "harness";
import { join } from "path";

// GitHub Issue #26305: bun remove doesn't remove package symlink from node_modules
// in workspace packages when using the isolated linker.
//
// The bug was that the cleanup code used std.fs.cwd() which points to the workspace
// root after init, but the symlinks are in the workspace package's node_modules directory.

test("bun remove removes symlink from workspace package's node_modules with isolated linker", async () => {
  const testDir = tempDirWithFiles("issue-26305", {
    "package.json": JSON.stringify({
      name: "test-workspace",
      workspaces: ["packages/*"],
    }),
    "bunfig.toml": `[install]\nlinker = "isolated"`,
    "packages/pkg-a/package.json": JSON.stringify({
      name: "pkg-a",
      dependencies: {
        "is-number": "7.0.0",
      },
    }),
    "packages/pkg-b/package.json": JSON.stringify({
      name: "pkg-b",
    }),
  });

  // Install packages
  await runBunInstall(bunEnv, testDir);

  const pkgADir = join(testDir, "packages", "pkg-a");
  const pkgANodeModules = join(pkgADir, "node_modules");
  const isNumberSymlink = join(pkgANodeModules, "is-number");

  // Verify is-number symlink exists in pkg-a's node_modules
  expect(existsSync(isNumberSymlink)).toBe(true);

  // Remove is-number from pkg-a
  const { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "remove", "is-number"],
    cwd: pkgADir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await exited;
  const stderrText = await stderr.text();
  expect(stderrText).not.toContain("error:");
  expect(exitCode).toBe(0);

  // Verify is-number was removed from package.json
  const pkgAPackageJson = await Bun.file(join(pkgADir, "package.json")).json();
  expect(pkgAPackageJson.dependencies).toBeUndefined();

  // BUG FIX: The symlink should be removed from pkg-a's node_modules
  // Before the fix, this would fail because the symlink was not deleted
  expect(existsSync(isNumberSymlink)).toBe(false);
});

test("bun remove removes symlink from root package's node_modules with isolated linker", async () => {
  const testDir = tempDirWithFiles("issue-26305-root", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      dependencies: {
        "is-number": "7.0.0",
      },
    }),
    "bunfig.toml": `[install]\nlinker = "isolated"`,
  });

  // Install packages
  await runBunInstall(bunEnv, testDir);

  const isNumberSymlink = join(testDir, "node_modules", "is-number");

  // Verify is-number symlink exists
  expect(existsSync(isNumberSymlink)).toBe(true);

  // Remove is-number
  const { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "remove", "is-number"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const exitCode = await exited;
  const stderrText = await stderr.text();
  expect(stderrText).not.toContain("error:");
  expect(exitCode).toBe(0);

  // Verify symlink is removed
  expect(existsSync(isNumberSymlink)).toBe(false);
});
