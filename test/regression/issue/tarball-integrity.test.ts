import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

setDefaultTimeout(60_000); // 60 second timeout

/**
 * Tests for tarball integrity verification (security fix).
 *
 * Previously, Bun did not store or verify integrity hashes for HTTP tarball dependencies.
 * Each `bun install` would download the tarball without verification, allowing silent
 * package substitution if the remote tarball content changed.
 *
 * This test verifies that:
 * 1. Integrity hashes are computed and stored in bun.lock for local tarballs
 * 2. Integrity is verified on subsequent installs
 */
describe("tarball integrity", () => {
  test("local tarball has integrity hash in lockfile", async () => {
    using dir = tempDir("tarball-integrity-test", {});

    // Create a simple test tarball with npm-style 'package' directory
    const tarballDir = join(String(dir), "package");
    mkdirSync(tarballDir, { recursive: true });
    writeFileSync(join(tarballDir, "package.json"), JSON.stringify({ name: "local-pkg", version: "1.0.0" }));

    // Create the tarball in the project directory
    const projectDir = join(String(dir), "project");
    mkdirSync(projectDir, { recursive: true });

    const tarResult = Bun.spawnSync({
      cmd: ["tar", "-czf", join(projectDir, "local-pkg.tgz"), "-C", String(dir), "package"],
      cwd: String(dir),
    });
    expect(tarResult.exitCode).toBe(0);

    // Create a project that depends on the local tarball
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        dependencies: {
          "local-pkg": "local-pkg.tgz",
        },
      }),
    );

    // Run bun install
    const installResult = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(projectDir, ".bun-cache"),
      },
      timeout: 30000,
    });

    if (installResult.exitCode !== 0) {
      console.log("stdout:", installResult.stdout.toString());
      console.log("stderr:", installResult.stderr.toString());
    }
    expect(installResult.exitCode).toBe(0);

    // Read the lockfile and verify it contains the integrity hash
    const lockfilePath = join(projectDir, "bun.lock");
    const lockfileContent = readFileSync(lockfilePath, "utf8");

    // The lockfile should contain an integrity hash for the local tarball
    expect(lockfileContent).toContain("sha512-");
    expect(lockfileContent).toContain("local-pkg.tgz");
  });

  test("integrity verification fails when tarball content changes", async () => {
    using dir = tempDir("tarball-integrity-test", {});

    // Create version 1 tarball
    const v1Dir = join(String(dir), "v1", "package");
    mkdirSync(v1Dir, { recursive: true });
    writeFileSync(join(v1Dir, "package.json"), JSON.stringify({ name: "pkg", version: "1.0.0" }));
    Bun.spawnSync({
      cmd: ["tar", "-czf", join(String(dir), "v1.tgz"), "-C", join(String(dir), "v1"), "package"],
      cwd: String(dir),
    });

    // Create version 2 tarball (different content)
    const v2Dir = join(String(dir), "v2", "package");
    mkdirSync(v2Dir, { recursive: true });
    writeFileSync(
      join(v2Dir, "package.json"),
      JSON.stringify({ name: "pkg", version: "2.0.0", description: "changed" }),
    );
    Bun.spawnSync({
      cmd: ["tar", "-czf", join(String(dir), "v2.tgz"), "-C", join(String(dir), "v2"), "package"],
      cwd: String(dir),
    });

    // Create project
    const projectDir = join(String(dir), "project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        dependencies: {
          pkg: `file:../v1.tgz`,
        },
      }),
    );

    // First install - should succeed and create lockfile with integrity
    const firstInstall = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(projectDir, ".bun-cache"),
      },
      timeout: 30000,
    });

    expect(firstInstall.exitCode).toBe(0);

    // Verify lockfile has integrity
    const lockfileContent = readFileSync(join(projectDir, "bun.lock"), "utf8");
    expect(lockfileContent).toContain("sha512-");

    // Now modify the lockfile to point to v2.tgz but keep the v1 integrity
    // This simulates an attacker swapping the tarball content
    const modifiedLockfile = lockfileContent.replace(/v1\.tgz/g, "v2.tgz");
    writeFileSync(join(projectDir, "bun.lock"), modifiedLockfile);

    // Update package.json to match
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        dependencies: {
          pkg: `file:../v2.tgz`,
        },
      }),
    );

    // Clean cache and node_modules to force re-extraction
    Bun.spawnSync({
      cmd: ["rm", "-rf", "node_modules", ".bun-cache"],
      cwd: projectDir,
    });

    // Second install with different tarball content should fail integrity check
    const secondInstall = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(projectDir, ".bun-cache"),
      },
      timeout: 30000,
    });

    // The install should fail because the integrity check failed
    expect(secondInstall.exitCode).not.toBe(0);
    const stderr = secondInstall.stderr.toString();
    expect(stderr).toContain("Integrity check failed");
  });
});
