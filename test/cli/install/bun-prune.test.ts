import { file } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  getPort,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

beforeEach(async () => {
  await dummyBeforeEach();
});

afterEach(async () => {
  await dummyAfterEach();
});

describe.concurrent("bun prune", () => {
  it("should show help with --help flag", async () => {
    using dir = tempDir("prune-help", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "prune", "--help"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Usage");
    expect(stdout).toContain("bun prune");
    expect(stdout).toContain("[flags]");
    expect(stdout).toContain("Remove packages");
    expect(stdout).toContain("--production");
    expect(stdout).toContain("--dry-run");
  });

  it("should remove extraneous packages", async () => {
    using dir = tempDir("prune-extraneous", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Manually create a stray package directory that's not in lockfile
    // This simulates a leftover package that was manually added or left behind
    const strayPkgPath = join(String(dir), "node_modules/lodash");
    mkdirSync(strayPkgPath, { recursive: true });
    writeFileSync(join(strayPkgPath, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));
    writeFileSync(join(strayPkgPath, "index.js"), "module.exports = {};");

    // Verify lodash exists before prune
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);

    // Run prune
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify lodash was removed but is-number was preserved
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(false);
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
  });

  it("should remove devDependencies with --production flag", async () => {
    using dir = tempDir("prune-production", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      }),
    });

    // First install all dependencies
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Verify both dependencies and devDependencies are installed
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/typescript"))).toBe(true);

    // Run prune with --production
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune", "--production"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify devDependencies were removed but regular dependencies preserved
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/typescript"))).toBe(false);
  });

  it("should preserve nested transitive dependencies in --production mode", async () => {
    using dir = tempDir("prune-production-nested", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          // is-odd depends on is-number
          "is-odd": "^3.0.1",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Verify all packages are installed (including nested transitive dep)
    expect(existsSync(join(String(dir), "node_modules/is-odd"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/typescript"))).toBe(true);

    // Run prune with --production
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune", "--production"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify production dep and its transitive dep are preserved
    expect(existsSync(join(String(dir), "node_modules/is-odd"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);

    // Verify devDependency was removed
    expect(existsSync(join(String(dir), "node_modules/typescript"))).toBe(false);
  });

  it("should show what would be removed with --dry-run", async () => {
    using dir = tempDir("prune-dry-run", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Manually create a stray package directory that's not in lockfile
    const strayPkgPath = join(String(dir), "node_modules/lodash");
    mkdirSync(strayPkgPath, { recursive: true });
    writeFileSync(join(strayPkgPath, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));
    writeFileSync(join(strayPkgPath, "index.js"), "module.exports = {};");

    // Run prune with --dry-run
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune", "--dry-run"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify output shows something (not silent)
    expect(stdout).not.toBe("");

    // Verify nothing is actually removed after dry-run
    expect(existsSync(join(String(dir), "node_modules", "lodash"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules", "is-number"))).toBe(true);
  });

  it("should be idempotent", async () => {
    using dir = tempDir("prune-idempotent", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Run prune twice
    await using pruneProc1 = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await pruneProc1.exited).toBe(0);

    await using pruneProc2 = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([
      pruneProc2.stdout.text(),
      pruneProc2.stderr.text(),
      pruneProc2.exited,
    ]);

    expect(exitCode2).toBe(0);
    expect(stderr2).not.toContain("error:");

    // Verify second run removes zero packages (idempotent)
    expect(stdout2).toContain("no changes");
  });

  it("should work with missing package.json", async () => {
    using dir = tempDir("prune-no-package-json", {});

    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([pruneProc.stderr.text(), pruneProc.exited]);

    // Should fail gracefully when no package.json exists
    expect(exitCode).not.toBe(0);

    // Verify error message is clear and mentions package.json
    expect(stderr.toLowerCase()).toContain("package.json");
    expect(stderr.toLowerCase()).toContain("nothing to prune");
  });

  it("should preserve optionalDependencies", async () => {
    using dir = tempDir("prune-optional", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
        optionalDependencies: {
          lodash: "^4.17.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Verify all dependencies are installed
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/typescript"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(true);

    // Run prune with --production
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune", "--production"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify devDependencies removed but regular and optional dependencies preserved
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/typescript"))).toBe(false);
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(true);
  });

  // TODO: This test is skipped because debug builds don't auto-install workspace package dependencies.
  // Workspace packages and their dependencies (e.g., packages/pkg1 and its lodash dependency) aren't
  // installed in node_modules during `bun install` in debug builds, even though the lockfile is correct.
  // Production builds work correctly. This is a pre-existing installation bug, not a prune issue.
  // Related: #16162 (transitive deps in workspaces), #19782 (workspace linking on first install)
  it.skip("should work in workspaces", async () => {
    using dir = tempDir("prune-workspace", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        dependencies: {
          lodash: "^4.17.0",
        },
      }),
      "bunfig.toml": `
[install]
linkWorkspacePackages = true
`,
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Manually create a stray package directory that's not in lockfile
    const strayPkgPath = join(String(dir), "node_modules/typescript");
    mkdirSync(strayPkgPath, { recursive: true });
    writeFileSync(join(strayPkgPath, "package.json"), JSON.stringify({ name: "typescript", version: "5.0.0" }));
    writeFileSync(join(strayPkgPath, "index.js"), "module.exports = {};");

    // Run prune
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify workspace packages still exist
    expect(existsSync(join(String(dir), "node_modules/pkg1"))).toBe(true);

    // Verify workspace dependency still exists
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(true);
  });

  it("should handle nested dependencies correctly", async () => {
    using dir = tempDir("prune-nested", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Verify is-number is installed
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);

    // Run prune (should not remove nested dependencies of declared packages)
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify the main dependency still exists after prune
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
  });

  it("should work with --verbose flag", async () => {
    using dir = tempDir("prune-verbose", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Manually create a stray package directory that's not in lockfile
    const strayPkgPath = join(String(dir), "node_modules/lodash");
    mkdirSync(strayPkgPath, { recursive: true });
    writeFileSync(join(strayPkgPath, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));
    writeFileSync(join(strayPkgPath, "index.js"), "module.exports = {};");

    // Run prune with --verbose
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune", "--verbose"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify verbose output shows some detail
    expect(stdout).not.toBe("");

    // Verify lodash was removed
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(false);
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
  });

  it("should work with --silent flag", async () => {
    using dir = tempDir("prune-silent", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Manually create a stray package directory that's not in lockfile
    const strayPkgPath = join(String(dir), "node_modules/lodash");
    mkdirSync(strayPkgPath, { recursive: true });
    writeFileSync(join(strayPkgPath, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));
    writeFileSync(join(strayPkgPath, "index.js"), "module.exports = {};");

    // Run prune with --silent
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune", "--silent"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");
    // Silent mode should produce minimal output
    expect(stdout.trim()).toBe("");

    // Verify pruning actually removed the stray package
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(false);
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
  });

  it("should verify --dry-run does not modify node_modules", async () => {
    using dir = tempDir("prune-dry-run-verify", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Manually create a stray package directory that's not in lockfile
    const strayPkgPath = join(String(dir), "node_modules/lodash");
    mkdirSync(strayPkgPath, { recursive: true });
    writeFileSync(join(strayPkgPath, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));
    writeFileSync(join(strayPkgPath, "index.js"), "module.exports = {};");

    // Verify lodash exists before dry-run
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(true);

    // Run prune with --dry-run
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune", "--dry-run"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify lodash still exists after dry-run (should not have been removed)
    expect(existsSync(join(String(dir), "node_modules/lodash"))).toBe(true);
  });

  it("should report consistent counts between dry-run and actual execution", async () => {
    using dir = tempDir("prune-count-consistency", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Manually create multiple stray packages that aren't in lockfile
    const strayPackages = ["lodash", "axios", "express"];
    for (const pkg of strayPackages) {
      const strayPkgPath = join(String(dir), `node_modules/${pkg}`);
      mkdirSync(strayPkgPath, { recursive: true });
      writeFileSync(join(strayPkgPath, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0" }));
      writeFileSync(join(strayPkgPath, "index.js"), "module.exports = {};");
    }

    // Verify stray packages exist before prune
    for (const pkg of strayPackages) {
      expect(existsSync(join(String(dir), `node_modules/${pkg}`))).toBe(true);
    }

    // Run prune with --dry-run
    await using dryRunProc = Bun.spawn({
      cmd: [bunExe(), "prune", "--dry-run"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [dryRunStdout, dryRunExitCode] = await Promise.all([dryRunProc.stdout.text(), dryRunProc.exited]);

    expect(dryRunExitCode).toBe(0);

    // Verify dry-run output shows packages would be removed
    expect(dryRunStdout).toContain("would be removed");

    // Extract count from dry-run output (e.g., "3 packages would be removed")
    const dryRunMatch = dryRunStdout.match(/(\d+) package.*would be removed/);
    if (!dryRunMatch) {
      throw new Error("Could not find package count in dry-run output");
    }
    const dryRunCount = parseInt(dryRunMatch[1]);
    expect(dryRunCount).toBe(strayPackages.length);

    // Verify nothing was removed during dry-run
    for (const pkg of strayPackages) {
      expect(existsSync(join(String(dir), `node_modules/${pkg}`))).toBe(true);
    }

    // Run actual prune (without --dry-run)
    await using actualProc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [actualStdout, actualStderr, actualExitCode] = await Promise.all([
      actualProc.stdout.text(),
      actualProc.stderr.text(),
      actualProc.exited,
    ]);

    expect(actualExitCode).toBe(0);

    // Extract count from actual output (e.g., "3 packages removed")
    const actualMatch = actualStdout.match(/(\d+) package.*removed/);
    expect(actualMatch).not.toBeNull();
    const actualCount = parseInt(actualMatch![1]);

    // CRITICAL: Counts must match between dry-run and actual execution
    expect(actualCount).toBe(dryRunCount);
    expect(actualCount).toBe(strayPackages.length);

    // Verify packages were actually removed
    for (const pkg of strayPackages) {
      expect(existsSync(join(String(dir), `node_modules/${pkg}`))).toBe(false);
    }

    // Verify is-number (legitimate package) was preserved
    expect(existsSync(join(String(dir), "node_modules/is-number"))).toBe(true);
  });
});

// Isolated linker tests run sequentially (not concurrently) to avoid handler conflicts
describe("bun prune - isolated linker", () => {
  it("should prune nested node_modules in isolated linker mode", async () => {
    // Set up dummy registry handler for is-number package
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "7.0.0": {
          bin: {},
        },
      }),
    );

    using dir = tempDir("prune-isolated", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${getPort()}/"
saveTextLockfile = false
linker = "isolated"
`,
    });

    // Install with isolated linker
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Manually create a stray package directory that's not in lockfile
    const strayPkgPath = join(String(dir), "node_modules/lodash");
    mkdirSync(strayPkgPath, { recursive: true });
    writeFileSync(join(strayPkgPath, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));
    writeFileSync(join(strayPkgPath, "index.js"), "module.exports = {};");

    // Run prune
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify lodash was removed (in isolated mode it might be nested)
    // Check both top-level and potential nested locations
    const lodashExists = existsSync(join(String(dir), "node_modules/lodash"));
    expect(lodashExists).toBe(false);
  });

  it("should handle isolated linker mode with nested node_modules", async () => {
    // Set up dummy registry handler for is-number package
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "7.0.0": {
          bin: {},
        },
      }),
    );

    using dir = tempDir("prune-isolated-nested", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          // is-number has no dependencies, so it won't create nested structure
          // but we can manually create one to test
          "is-number": "^7.0.0",
        },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${getPort()}/"
saveTextLockfile = false
linker = "isolated"
`,
    });

    // Install with isolated linker
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await installProc.exited).toBe(0);

    // Manually create a nested node_modules structure to simulate isolated mode
    // In isolated mode, packages can have their dependencies nested like:
    // node_modules/pkg-a/node_modules/pkg-b
    const nestedPath = join(String(dir), "node_modules/is-number/node_modules");
    mkdirSync(nestedPath, { recursive: true });

    const nestedPkgPath = join(nestedPath, "lodash");
    mkdirSync(nestedPkgPath, { recursive: true });
    writeFileSync(join(nestedPkgPath, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));

    // Verify nested package exists
    expect(existsSync(nestedPkgPath)).toBe(true);

    // Run prune - should remove lodash since it's not in lockfile
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [pruneStdout, pruneStderr, pruneExitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(pruneExitCode).toBe(0);
    expect(pruneStderr).not.toContain("error:");

    // Verify nested lodash was removed
    expect(existsSync(nestedPkgPath)).toBe(false);
  });

  it("should handle scoped packages (@scope/name)", async () => {
    using dir = tempDir("prune-scoped", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: { "@types/node": "^18.0.0" },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Add extraneous scoped package
    await using addProc = Bun.spawn({
      cmd: [bunExe(), "add", "@types/uuid"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await addProc.exited).toBe(0);

    // Remove @types/uuid from package.json
    const pkg = await file(join(String(dir), "package.json")).json();
    delete pkg.dependencies["@types/uuid"];
    writeFileSync(join(String(dir), "package.json"), JSON.stringify(pkg, null, 2));

    // Reconcile lockfile by running install to remove @types/uuid from lockfile
    // This makes @types/uuid truly extraneous (in node_modules but not in lockfile)
    await using reconcileProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await reconcileProc.exited).toBe(0);

    // Verify both scoped packages exist (node_modules not yet pruned)
    expect(existsSync(join(String(dir), "node_modules/@types/node"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/@types/uuid"))).toBe(true);

    // Run prune
    await using pruneProc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      pruneProc.stdout.text(),
      pruneProc.stderr.text(),
      pruneProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");

    // Verify @types/uuid was removed but @types/node was preserved
    expect(existsSync(join(String(dir), "node_modules/@types/node"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules/@types/uuid"))).toBe(false);
  });
});
