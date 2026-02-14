import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { homedir } from "os";
import { join } from "path";

// Helper to remove GitHub packages from the global cache so tarballs must be re-downloaded.
async function clearGitHubCache(pattern: string) {
  const cacheDir = join(homedir(), ".bun", "install", "cache");
  const glob = new Bun.Glob(`@GH@${pattern}*`);
  const indexGlob = new Bun.Glob(pattern);
  for await (const entry of glob.scan({ cwd: cacheDir, onlyFiles: false })) {
    await rm(join(cacheDir, entry), { recursive: true, force: true });
  }
  for await (const entry of indexGlob.scan({ cwd: cacheDir, onlyFiles: false })) {
    await rm(join(cacheDir, entry), { recursive: true, force: true });
  }
}

describe("GitHub tarball integrity", () => {
  test("should store integrity hash in lockfile for GitHub dependencies", async () => {
    await clearGitHubCache("jonschlinkert-is-number");

    using dir = tempDir("github-integrity", {
      "package.json": JSON.stringify({
        name: "test-github-integrity",
        dependencies: {
          "is-number": "jonschlinkert/is-number#98e8ff1",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
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

  test("should reject GitHub tarball when integrity check fails", async () => {
    // Clear the cache so the tarball must be re-downloaded
    await clearGitHubCache("jonschlinkert-is-number");

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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Integrity check failed");
    expect(exitCode).not.toBe(0);
  });

  test("should accept GitHub dependency lockfile without integrity (backward compat)", async () => {
    using dir = tempDir("github-integrity-compat", {
      "package.json": JSON.stringify({
        name: "test-github-integrity-compat",
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
            name: "test-github-integrity-compat",
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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed without errors
    expect(stderr).not.toContain("Integrity check failed");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });
});
