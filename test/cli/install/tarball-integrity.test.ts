import { describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, pack, tempDirWithFiles } from "harness";
import { join } from "path";

/**
 * Tests for tarball integrity verification.
 *
 * Bun computes and stores integrity hashes for HTTP tarball and local tarball dependencies.
 * This ensures integrity is verified on subsequent installs, preventing silent package substitution.
 *
 * This test verifies that:
 * 1. Integrity hashes are computed and stored in bun.lock for local tarballs
 * 2. Integrity is verified on subsequent installs
 */
describe("tarball integrity", () => {
  test("local tarball has integrity hash in lockfile", async () => {
    // Create a package to be packed
    const pkgDir = tempDirWithFiles("tarball-pkg", {
      "package.json": JSON.stringify({ name: "local-pkg", version: "1.0.0" }),
      "index.js": "module.exports = 'hello';",
    });

    // Pack it into a tarball
    await pack(String(pkgDir), bunEnv);
    const tarballPath = join(String(pkgDir), "local-pkg-1.0.0.tgz");

    // Create a project that depends on the local tarball
    const projectDir = tempDirWithFiles("tarball-project", {
      "package.json": JSON.stringify({
        name: "test-project",
        dependencies: {
          "local-pkg": `file:${tarballPath}`,
        },
      }),
    });

    // Run bun install
    const installResult = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: String(projectDir),
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(String(projectDir), ".bun-cache"),
      },
    });

    expect(installResult.exitCode).toBe(0);

    // Read the lockfile and verify it contains the integrity hash
    const lockfileContent = await Bun.file(join(String(projectDir), "bun.lock")).text();

    // The lockfile should contain an integrity hash for the local tarball
    expect(lockfileContent).toContain("sha512-");
    expect(lockfileContent).toContain("local-pkg-1.0.0.tgz");
  });

  test("integrity verification fails when tarball content changes", async () => {
    // Create version 1 package
    const v1Dir = tempDirWithFiles("tarball-v1", {
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
      "index.js": "module.exports = 'v1';",
    });
    await pack(String(v1Dir), bunEnv);
    const v1Tarball = join(String(v1Dir), "pkg-1.0.0.tgz");

    // Create version 2 package (different content, same name/version for testing)
    const v2Dir = tempDirWithFiles("tarball-v2", {
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0", description: "changed" }),
      "index.js": "module.exports = 'v2 - different content';",
    });
    await pack(String(v2Dir), bunEnv);
    const v2Tarball = join(String(v2Dir), "pkg-1.0.0.tgz");

    // Create project pointing to v1
    const projectDir = tempDirWithFiles("tarball-integrity-project", {
      "package.json": JSON.stringify({
        name: "test-project",
        dependencies: {
          pkg: `file:${v1Tarball}`,
        },
      }),
    });

    const cacheDir = join(String(projectDir), ".bun-cache");

    // First install - should succeed and create lockfile with integrity
    const firstInstall = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: String(projectDir),
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      },
    });

    expect(firstInstall.exitCode).toBe(0);

    // Verify lockfile has integrity
    const lockfilePath = join(String(projectDir), "bun.lock");
    const lockfileContent = await Bun.file(lockfilePath).text();
    expect(lockfileContent).toContain("sha512-");

    // Modify the lockfile to point to v2 tarball but keep the v1 integrity hash
    // This simulates an attacker swapping the tarball content
    // Note: we replace globally since the path appears in multiple places
    const modifiedLockfile = lockfileContent.replaceAll(v1Tarball, v2Tarball);
    await Bun.write(lockfilePath, modifiedLockfile);

    // Also update package.json to point to v2 (to match the lockfile path)
    await Bun.write(
      join(String(projectDir), "package.json"),
      JSON.stringify({
        name: "test-project",
        dependencies: {
          pkg: `file:${v2Tarball}`,
        },
      }),
    );

    // Verify the lockfile was modified correctly
    const newLockfile = await Bun.file(lockfilePath).text();
    expect(newLockfile).toContain(v2Tarball);
    expect(newLockfile).not.toContain(v1Tarball);

    // Clean cache and node_modules to force re-extraction
    await rm(join(String(projectDir), "node_modules"), { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });

    // Second install with different tarball content should fail integrity check
    const secondInstall = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: String(projectDir),
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      },
    });

    // The install should fail because the integrity check failed
    const stderr = secondInstall.stderr.toString();
    const stdout = secondInstall.stdout.toString();
    const output = stdout + stderr;
    expect(output).toContain("Integrity check failed");
    expect(secondInstall.exitCode).not.toBe(0);
  });
});
