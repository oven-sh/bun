import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/26973
// `bun install --frozen-lockfile` should succeed on a pruned monorepo
// (e.g. output of `turbo prune --docker`) where some workspaces are removed
// but the lockfile is a superset of what's needed.

test("frozen-lockfile succeeds on pruned monorepo with subset of workspaces", async () => {
  // Step 1: Create a full monorepo and generate a lockfile
  const fullDir = tempDirWithFiles("full-monorepo", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      workspaces: ["packages/*", "apps/*"],
    }),
    "packages/shared/package.json": JSON.stringify({
      name: "@test/shared",
      version: "1.0.0",
    }),
    "packages/utils/package.json": JSON.stringify({
      name: "@test/utils",
      version: "1.0.0",
    }),
    "apps/web/package.json": JSON.stringify({
      name: "@test/web",
      version: "1.0.0",
      dependencies: {
        "@test/shared": "workspace:*",
      },
    }),
    "apps/api/package.json": JSON.stringify({
      name: "@test/api",
      version: "1.0.0",
      dependencies: {
        "@test/utils": "workspace:*",
      },
    }),
  });

  // Generate a lockfile with the full set of workspaces
  const installResult = Bun.spawnSync({
    cmd: [bunExe(), "install", "--save-text-lockfile", "--ignore-scripts"],
    cwd: fullDir,
    env: bunEnv,
  });
  expect(installResult.exitCode).toBe(0);

  const lockfileContent = await Bun.file(join(fullDir, "bun.lock")).text();

  // Step 2: Create a pruned monorepo (only @test/web and its dependency @test/shared)
  // but use the FULL lockfile from the original monorepo
  const prunedDir = tempDirWithFiles("pruned-monorepo", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      workspaces: ["packages/shared", "apps/web"],
    }),
    "packages/shared/package.json": JSON.stringify({
      name: "@test/shared",
      version: "1.0.0",
    }),
    "apps/web/package.json": JSON.stringify({
      name: "@test/web",
      version: "1.0.0",
      dependencies: {
        "@test/shared": "workspace:*",
      },
    }),
    "bun.lock": lockfileContent,
  });

  // Step 3: Run frozen install on the pruned output — this should succeed
  const frozenResult = Bun.spawnSync({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--ignore-scripts"],
    cwd: prunedDir,
    env: bunEnv,
  });

  const stderr = frozenResult.stderr.toString();
  expect(stderr).not.toContain("lockfile had changes, but lockfile is frozen");
  expect(frozenResult.exitCode).toBe(0);
});

test("frozen-lockfile still fails when a new workspace is added", async () => {
  // This test ensures we don't accidentally make frozen-lockfile too permissive.
  // If a workspace is ADDED (not just removed), the frozen lockfile check
  // should still fail.
  const fullDir = tempDirWithFiles("frozen-fail-monorepo", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      workspaces: ["packages/*"],
    }),
    "packages/shared/package.json": JSON.stringify({
      name: "@test/shared",
      version: "1.0.0",
    }),
  });

  // Generate a lockfile with only @test/shared
  const installResult = Bun.spawnSync({
    cmd: [bunExe(), "install", "--save-text-lockfile", "--ignore-scripts"],
    cwd: fullDir,
    env: bunEnv,
  });
  expect(installResult.exitCode).toBe(0);

  const lockfileContent = await Bun.file(join(fullDir, "bun.lock")).text();

  // Now create a directory with an ADDITIONAL workspace not in the lockfile
  const modifiedDir = tempDirWithFiles("frozen-fail-modified", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      workspaces: ["packages/*"],
    }),
    "packages/shared/package.json": JSON.stringify({
      name: "@test/shared",
      version: "1.0.0",
    }),
    "packages/extra/package.json": JSON.stringify({
      name: "@test/extra",
      version: "1.0.0",
    }),
    "bun.lock": lockfileContent,
  });

  // This should fail because a new workspace was added that's not in the lockfile
  const frozenResult = Bun.spawnSync({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--ignore-scripts"],
    cwd: modifiedDir,
    env: bunEnv,
  });

  const stderr = frozenResult.stderr.toString();
  expect(stderr).toContain("lockfile had changes, but lockfile is frozen");
  expect(frozenResult.exitCode).not.toBe(0);
});
