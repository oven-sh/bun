import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Each test uses its own BUN_INSTALL_CACHE_DIR inside the temp dir for full
// isolation.  This avoids interfering with the global cache or other tests.
function envWithCache(dir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") };
}

describe.concurrent("GitHub tarball integrity", () => {
  test("should store integrity hash in lockfile for GitHub dependencies", async () => {
    using dir = tempDir("github-integrity", {
      "package.json": JSON.stringify({
        name: "test-github-integrity",
        dependencies: {
          "is-number": "jonschlinkert/is-number#98e8ff1",
        },
      }),
    });

    const env = envWithCache(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    const lockfileContent = await file(join(String(dir), "bun.lock")).text();

    // The lockfile should contain a sha512 integrity hash for the GitHub dependency
    expect(lockfileContent).toContain("sha512-");
    // The resolved commit hash should be present
    expect(lockfileContent).toContain("jonschlinkert-is-number-98e8ff1");
    // Verify the format: the integrity appears after the resolved commit hash
    expect(lockfileContent).toMatch(/"jonschlinkert-is-number-98e8ff1",\s*"sha512-/);
  });

  test("should verify integrity passes on re-install with matching hash", async () => {
    using dir = tempDir("github-integrity-match", {
      "package.json": JSON.stringify({
        name: "test-github-integrity-match",
        dependencies: {
          "is-number": "jonschlinkert/is-number#98e8ff1",
        },
      }),
    });

    const env = envWithCache(dir);

    // First install to generate lockfile with correct integrity
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);
    expect(stderr1).not.toContain("error:");
    expect(exitCode1).toBe(0);

    // Read the generated lockfile and extract the integrity hash adjacent to
    // the GitHub resolved entry to avoid accidentally matching an npm hash.
    const lockfileContent = await file(join(String(dir), "bun.lock")).text();
    const integrityMatch = lockfileContent.match(/"jonschlinkert-is-number-98e8ff1",\s*"(sha512-[A-Za-z0-9+/]+=*)"/);
    expect(integrityMatch).not.toBeNull();
    const integrityHash = integrityMatch![1];

    // Clear cache and node_modules, then re-install with the same lockfile
    await rm(join(String(dir), ".bun-cache"), { recursive: true, force: true });
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });

    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    // Should succeed because the integrity matches
    expect(stderr2).not.toContain("Integrity check failed");
    expect(exitCode2).toBe(0);

    // Lockfile should still contain the same integrity hash
    const lockfileContent2 = await file(join(String(dir), "bun.lock")).text();
    expect(lockfileContent2).toContain(integrityHash);
  });

  test("should reject GitHub tarball when integrity check fails", async () => {
    using dir = tempDir("github-integrity-reject", {
      "package.json": JSON.stringify({
        name: "test-github-integrity-reject",
        dependencies: {
          "is-number": "jonschlinkert/is-number#98e8ff1",
        },
      }),
      // Pre-create a lockfile with an invalid integrity hash (valid base64, 64 zero bytes)
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: {
          "": {
            name: "test-github-integrity-reject",
            dependencies: {
              "is-number": "jonschlinkert/is-number#98e8ff1",
            },
          },
        },
        packages: {
          "is-number": [
            "is-number@github:jonschlinkert/is-number#98e8ff1",
            {},
            "jonschlinkert-is-number-98e8ff1",
            "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
          ],
        },
      }),
    });

    // Fresh per-test cache ensures the tarball must be downloaded from the network
    const env = envWithCache(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Integrity check failed");
    expect(exitCode).not.toBe(0);
  });

  test("should update lockfile with integrity when old format has none", async () => {
    using dir = tempDir("github-integrity-upgrade", {
      "package.json": JSON.stringify({
        name: "test-github-integrity-upgrade",
        dependencies: {
          "is-number": "jonschlinkert/is-number#98e8ff1",
        },
      }),
      // Pre-create a lockfile in the old format (no integrity hash)
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: {
          "": {
            name: "test-github-integrity-upgrade",
            dependencies: {
              "is-number": "jonschlinkert/is-number#98e8ff1",
            },
          },
        },
        packages: {
          "is-number": ["is-number@github:jonschlinkert/is-number#98e8ff1", {}, "jonschlinkert-is-number-98e8ff1"],
        },
      }),
    });

    // Fresh per-test cache ensures the tarball must be downloaded
    const env = envWithCache(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed without errors
    expect(stderr).not.toContain("Integrity check failed");
    expect(stderr).not.toContain("error:");
    // The lockfile should be re-saved with the new integrity hash
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    // Verify the lockfile now contains the integrity hash
    const lockfileContent = await file(join(String(dir), "bun.lock")).text();
    expect(lockfileContent).toContain("sha512-");
    expect(lockfileContent).toMatch(/"jonschlinkert-is-number-98e8ff1",\s*"sha512-/);
  });

  test("should accept GitHub dependency from cache without re-downloading", async () => {
    // Use a shared cache dir for both installs so the second is a true cache hit
    using dir = tempDir("github-integrity-cached", {
      "package.json": JSON.stringify({
        name: "test-github-integrity-cached",
        dependencies: {
          "is-number": "jonschlinkert/is-number#98e8ff1",
        },
      }),
    });

    const env = envWithCache(dir);

    // First install warms the per-test cache
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);
    expect(stderr1).not.toContain("error:");
    expect(exitCode1).toBe(0);

    // Remove node_modules but keep the cache
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });

    // Strip the integrity from the lockfile to simulate an old-format lockfile
    // that should still work when the cache already has the package
    const lockfileContent = await file(join(String(dir), "bun.lock")).text();
    const stripped = lockfileContent.replace(/,\s*"sha512-[^"]*"/, "");
    await Bun.write(join(String(dir), "bun.lock"), stripped);

    // Second install should hit the cache and succeed without re-downloading
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    // Should succeed without integrity errors (package served from cache)
    expect(stderr2).not.toContain("Integrity check failed");
    expect(stderr2).not.toContain("error:");
    expect(exitCode2).toBe(0);
  });
});
