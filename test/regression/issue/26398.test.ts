import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { readdir } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

/**
 * Regression test for https://github.com/oven-sh/bun/issues/26398
 *
 * When using `bun install --filter "a"` in a monorepo, optional peer dependencies
 * of package `a`'s dependencies should NOT get installed if they are only listed
 * as direct dependencies in a filtered-out package `b`.
 *
 * This test uses local file: dependencies to avoid registry dependencies.
 */

describe("install --filter with optional peer dependencies", () => {
  test("does not install optional peer deps from filtered-out packages", async () => {
    // Create workspace structure:
    // - Package "pkg-a" depends on "has-optional-peer" which has "the-peer" as an optional peer
    // - Package "pkg-b" depends on "the-peer" directly
    // When running with --filter "pkg-a", "the-peer" should NOT be installed because:
    // 1. Package "pkg-b" is filtered out
    // 2. "the-peer" is only an optional peer dep of "has-optional-peer"
    //
    // deps/ are NOT workspaces - they're just local packages referenced by file:

    using dir = tempDir("26398-test", {
      "package.json": JSON.stringify({
        name: "test-workspace",
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          "has-optional-peer": "file:../../deps/has-optional-peer",
        },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: {
          "the-peer": "file:../../deps/the-peer",
        },
      }),
      // A package with an optional peer dependency (not a workspace)
      "deps/has-optional-peer/package.json": JSON.stringify({
        name: "has-optional-peer",
        version: "1.0.0",
        peerDependencies: {
          "the-peer": "*",
        },
        peerDependenciesMeta: {
          "the-peer": {
            optional: true,
          },
        },
      }),
      "deps/has-optional-peer/index.js": "module.exports = 'has-optional-peer';",
      // The peer package (not a workspace)
      "deps/the-peer/package.json": JSON.stringify({
        name: "the-peer",
        version: "1.0.0",
      }),
      "deps/the-peer/index.js": "module.exports = 'the-peer';",
    });

    const env = { ...bunEnv };
    env.BUN_INSTALL_CACHE_DIR = join(String(dir), ".bun-cache");
    env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(String(dir), ".bun-tmp");

    // Run install with --filter "pkg-a"
    await using proc = spawn({
      cmd: [bunExe(), "install", "--filter", "pkg-a"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [exitCode, stderrText, stdoutText] = await Promise.all([proc.exited, proc.stderr.text(), proc.stdout.text()]);
    if (exitCode !== 0) {
      console.log("stderr:", stderrText);
      console.log("stdout:", stdoutText);
    }

    // Verify that the-peer is NOT installed
    // It should not be installed because:
    // 1. Package "pkg-b" (which has the-peer as direct dependency) is filtered out
    // 2. the-peer is only an optional peer of has-optional-peer
    // Check that it's not in the .bun cache
    const bunCache = await readdir(join(String(dir), "node_modules", ".bun"));
    expect(bunCache.some((f: string) => f.includes("the-peer"))).toBeFalse();

    // Verify that has-optional-peer IS installed (it's a direct dependency of "pkg-a")
    expect(bunCache.some((f: string) => f.includes("has-optional-peer"))).toBeTrue();

    expect(exitCode).toBe(0);
  });

  test("installs optional peer deps when provided by non-filtered package", async () => {
    // When the optional peer dep is a direct dependency of a non-filtered package,
    // it SHOULD be installed

    using dir = tempDir("26398-test-2", {
      "package.json": JSON.stringify({
        name: "test-workspace",
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          "has-optional-peer": "file:../../deps/has-optional-peer",
          "the-peer": "file:../../deps/the-peer", // explicitly listed as dependency
        },
      }),
      // A package with an optional peer dependency (not a workspace)
      "deps/has-optional-peer/package.json": JSON.stringify({
        name: "has-optional-peer",
        version: "1.0.0",
        peerDependencies: {
          "the-peer": "*",
        },
        peerDependenciesMeta: {
          "the-peer": {
            optional: true,
          },
        },
      }),
      "deps/has-optional-peer/index.js": "module.exports = 'has-optional-peer';",
      // The peer package (not a workspace)
      "deps/the-peer/package.json": JSON.stringify({
        name: "the-peer",
        version: "1.0.0",
      }),
      "deps/the-peer/index.js": "module.exports = 'the-peer';",
    });

    const env = { ...bunEnv };
    env.BUN_INSTALL_CACHE_DIR = join(String(dir), ".bun-cache");
    env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(String(dir), ".bun-tmp");

    // Run install with --filter "pkg-a"
    await using proc = spawn({
      cmd: [bunExe(), "install", "--filter", "pkg-a"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [exitCode, stderrText, stdoutText] = await Promise.all([proc.exited, proc.stderr.text(), proc.stdout.text()]);
    if (exitCode !== 0) {
      console.log("stderr:", stderrText);
      console.log("stdout:", stdoutText);
    }

    // Both should be installed since the-peer is a direct dependency of "pkg-a"
    const bunCache = await readdir(join(String(dir), "node_modules", ".bun"));
    expect(bunCache.some((f: string) => f.includes("has-optional-peer"))).toBeTrue();
    expect(bunCache.some((f: string) => f.includes("the-peer"))).toBeTrue();

    expect(exitCode).toBe(0);
  });
});
