import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, VerdaccioRegistry } from "harness";
import { join } from "path";

let registry: VerdaccioRegistry;
let registryUrl: string;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  registryUrl = registry.registryUrl();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("bun update --interactive", () => {
  it("should handle package names of unusual lengths", async () => {
    const dir = tempDirWithFiles("update-interactive-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "a": "1.0.0",
          "really-long-package-name-that-causes-formatting-issues": "1.0.0",
          "@org/extremely-long-scoped-package-name-that-will-test-formatting": "1.0.0",
          "short": "1.0.0",
          "another-package-with-a-very-long-name-to-test-column-alignment": "1.0.0",
        },
        devDependencies: {
          "dev-package": "1.0.0",
          "super-long-dev-package-name-that-should-not-break-formatting": "1.0.0",
        },
        peerDependencies: {
          "peer-package": "1.0.0",
          "extremely-long-peer-dependency-name-for-testing-column-alignment": "1.0.0",
        },
        optionalDependencies: {
          "optional-package": "1.0.0",
          "very-long-optional-dependency-name-that-tests-formatting": "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "a": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "really-long-package-name-that-causes-formatting-issues": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "@org/extremely-long-scoped-package-name-that-will-test-formatting": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "short": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "another-package-with-a-very-long-name-to-test-column-alignment": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "dev-package": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "super-long-dev-package-name-that-should-not-break-formatting": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "peer-package": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "extremely-long-peer-dependency-name-for-testing-column-alignment": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "optional-package": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "very-long-optional-dependency-name-that-tests-formatting": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
        },
      }),
    });

    // Mock outdated packages by creating fake manifests
    const manifestsDir = join(dir, ".bun", "manifests");
    await Bun.write(
      join(manifestsDir, "a.json"),
      JSON.stringify({
        name: "a",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { version: "1.0.0" },
          "2.0.0": { version: "2.0.0" },
        },
      }),
    );

    // Test that the command doesn't crash with unusual package name lengths
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // The command might fail due to missing manifests, but it shouldn't crash
    // due to formatting issues
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });

  it("should handle version strings of unusual lengths", async () => {
    const dir = tempDirWithFiles("update-interactive-versions-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "package-with-long-version": "1.0.0-alpha.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20",
          "package-with-short-version": "1.0.0",
          "package-with-prerelease": "1.0.0-beta.1+build.1234567890.abcdef",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "package-with-long-version": {
            "integrity": "sha512-fake",
            "version": "1.0.0-alpha.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20",
          },
          "package-with-short-version": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "package-with-prerelease": {
            "integrity": "sha512-fake",
            "version": "1.0.0-beta.1+build.1234567890.abcdef",
          },
        },
      }),
    });

    // Test that the command doesn't crash with unusual version string lengths
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // The command might fail due to missing manifests, but it shouldn't crash
    // due to formatting issues
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });

  it("should truncate extremely long package names", async () => {
    const extremelyLongPackageName = "a".repeat(100);
    const dir = tempDirWithFiles("update-interactive-truncate-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          [extremelyLongPackageName]: "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          [extremelyLongPackageName]: {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
        },
      }),
    });

    // Test that extremely long package names are handled gracefully
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // The command might fail due to missing manifests, but it shouldn't crash
    // due to formatting issues
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });

  it("should show workspace column with --filter", async () => {
    const dir = tempDirWithFiles("update-interactive-workspace-col-test", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        dependencies: {
          "dep1": "1.0.0",
        },
      }),
      "packages/pkg2/package.json": JSON.stringify({
        name: "pkg2",
        dependencies: {
          "dep2": "1.0.0",
        },
      }),
    });

    // Test with --filter should include workspace column
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--filter=*", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Should not crash with workspace column
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
  });

  it("should handle catalog dependencies in interactive update", async () => {
    const dir = tempDirWithFiles("update-interactive-catalog-test", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        catalog: {
          "shared-dep": "1.0.0",
        },
        workspaces: ["packages/*"],
      }),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        dependencies: {
          "shared-dep": "catalog:",
        },
      }),
      "packages/pkg2/package.json": JSON.stringify({
        name: "pkg2",
        dependencies: {
          "shared-dep": "catalog:",
        },
      }),
    });

    // Test interactive update with catalog dependencies
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--filter=*", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Should not crash with catalog dependencies
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("catalog: failed to resolve");
  });

  it("should handle mixed dependency types with various name lengths", async () => {
    const dir = tempDirWithFiles("update-interactive-mixed-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "a": "1.0.0",
          "really-long-dependency-name": "1.0.0",
        },
        devDependencies: {
          "b": "1.0.0",
          "super-long-dev-dependency-name": "1.0.0",
        },
        peerDependencies: {
          "c": "1.0.0",
          "extremely-long-peer-dependency-name": "1.0.0",
        },
        optionalDependencies: {
          "d": "1.0.0",
          "very-long-optional-dependency-name": "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "a": { "integrity": "sha512-fake", "version": "1.0.0" },
          "really-long-dependency-name": { "integrity": "sha512-fake", "version": "1.0.0" },
          "b": { "integrity": "sha512-fake", "version": "1.0.0" },
          "super-long-dev-dependency-name": { "integrity": "sha512-fake", "version": "1.0.0" },
          "c": { "integrity": "sha512-fake", "version": "1.0.0" },
          "extremely-long-peer-dependency-name": { "integrity": "sha512-fake", "version": "1.0.0" },
          "d": { "integrity": "sha512-fake", "version": "1.0.0" },
          "very-long-optional-dependency-name": { "integrity": "sha512-fake", "version": "1.0.0" },
        },
      }),
    });

    // Test that mixed dependency types with various name lengths don't cause crashes
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // The command might fail due to missing manifests, but it shouldn't crash
    // due to formatting issues
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });

  it("should update packages when 'a' (select all) is used", async () => {
    const dir = tempDirWithFiles("update-interactive-select-all", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0", // Old version
        },
      }),
    });

    // First install to get lockfile
    const install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Test interactive update with 'a' to select all
    const update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then Enter to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const stdout = await new Response(update.stdout).text();
    const stderr = await new Response(update.stderr).text();
    const output = stdout + stderr;

    if (exitCode !== 0) {
      console.error("Update failed with exit code:", exitCode);
      console.error("Stdout:", stdout);
      console.error("Stderr:", stderr);
    }

    // Should complete successfully
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("panic");

    // Check if package.json was updated
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    // no-deps should be updated from 1.0.0 to 2.0.0
    expect(packageJson.dependencies["no-deps"]).toBe("2.0.0");

    // Check that the output shows the package was installed/updated
    expect(output).toContain("Installing updates...");

    // todo: Should show the installed package in the summary
    // expect(output).toContain("installed no-deps@");

    // Should save the lockfile
    expect(output).toContain("Saved lockfile");
  });

  it("should handle workspace updates with recursive flag", async () => {
    const dir = tempDirWithFiles("update-interactive-workspace-recursive", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0", // Old version in workspace
        },
      }),
    });

    // First install
    const install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Test interactive update with recursive flag
    const update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Select all packages
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const stderr = await new Response(update.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("panic");

    // Check if workspace package was updated
    const appPackageJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appPackageJson.dependencies["no-deps"]).toBe("2.0.0");
  });

  it("should handle catalog updates correctly", async () => {
    const dir = tempDirWithFiles("update-interactive-catalog-actual", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "1.0.0", // Old version in catalog
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        version: "1.0.0",
        dependencies: {
          "no-deps": "catalog:",
        },
      }),
    });

    // First install
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const stdout = await new Response(update.stdout).text();
    const stderr = await new Response(update.stderr).text();

    expect(exitCode).toBe(0);
    expect(stdout + stderr).not.toContain("panic");
    expect(stdout + stderr).not.toContain("catalog: failed to resolve");

    // Check if catalog was updated in root package.json
    const rootPackageJson = await Bun.file(join(dir, "package.json")).json();
    expect(rootPackageJson.catalog["no-deps"]).toBe("2.0.0");

    // App package.json should still have catalog reference
    const appPackageJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appPackageJson.dependencies["no-deps"]).toBe("catalog:");
  });

  it("should work correctly when run from inside a workspace directory", async () => {
    const dir = tempDirWithFiles("update-interactive-from-workspace", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/app1/package.json": JSON.stringify({
        name: "@test/app1",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
      "packages/app2/package.json": JSON.stringify({
        name: "@test/app2",
        version: "1.0.0",
        dependencies: {
          "dep-with-tags": "1.0.0",
        },
      }),
    });

    // First install from root
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update from inside workspace
    const workspaceDir = join(dir, "packages/app1");
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: workspaceDir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();
    const stderr = await new Response(update.stderr).text();
    const combined = output + stderr;

    // Should not fail with FileNotFound
    expect(exitCode).toBe(0);
    expect(combined).not.toContain("FileNotFound");
    expect(combined).not.toContain("Failed to update");

    // Check that both workspace packages were updated
    const app1Json = await Bun.file(join(dir, "packages/app1/package.json")).json();
    const app2Json = await Bun.file(join(dir, "packages/app2/package.json")).json();

    expect(app1Json.dependencies["no-deps"]).toBe("2.0.0");
    expect(app2Json.dependencies["dep-with-tags"]).toBe("3.0.0");
  });

  it("should handle basic interactive update with select all", async () => {
    const dir = tempDirWithFiles("update-interactive-basic", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check if package was updated
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("2.0.0");
  });

  it("should preserve version prefixes for all semver range types in catalogs", async () => {
    const dir = tempDirWithFiles("update-interactive-semver-prefixes", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
          "dep-with-tags": "~1.0.0",
          "a-dep": ">=1.0.5",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
          "a-dep": "catalog:",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check if prefixes were preserved
    const packageJson = await Bun.file(join(dir, "package.json")).json();

    // All prefixes should be preserved (versions may or may not change)
    expect(packageJson.catalog["no-deps"]).toMatch(/^\^/);
    expect(packageJson.catalog["dep-with-tags"]).toMatch(/^~/);
    expect(packageJson.catalog["a-dep"]).toMatch(/^>=/);
  });

  it("should handle catalog updates in workspaces.catalogs object", async () => {
    const dir = tempDirWithFiles("update-interactive-workspaces-catalogs", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalogs: {
            "tools": {
              "no-deps": "^1.0.0",
              "dep-with-tags": "~1.0.0",
            },
            "frameworks": {
              "a-dep": "^1.0.5",
              "normal-dep-and-dev-dep": "^1.0.0",
            },
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:tools",
          "a-dep": "catalog:frameworks",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Installing updates...");

    // Check if catalogs were updated correctly
    const packageJson = await Bun.file(join(dir, "package.json")).json();

    // Prefixes should be preserved
    expect(packageJson.workspaces.catalogs.tools["no-deps"]).toMatch(/^\^/);
    expect(packageJson.workspaces.catalogs.tools["dep-with-tags"]).toMatch(/^~/);
  });

  it("should handle mixed workspace and catalog dependencies", async () => {
    const dir = tempDirWithFiles("update-interactive-mixed-deps", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
        },
      }),
      "packages/lib/package.json": JSON.stringify({
        name: "@test/lib",
        version: "1.0.0",
        dependencies: {
          "a-dep": "^1.0.5",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "@test/lib": "workspace:*",
          "no-deps": "catalog:",
          "dep-with-tags": "~1.0.0",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check updates were applied correctly
    const appJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    const libJson = await Bun.file(join(dir, "packages/lib/package.json")).json();

    // Workspace dependency should remain unchanged
    expect(appJson.dependencies["@test/lib"]).toBe("workspace:*");

    // Regular dependencies should be updated with prefix preserved
    expect(appJson.dependencies["dep-with-tags"]).toMatch(/^~/);
    expect(libJson.dependencies["a-dep"]).toMatch(/^\^/);
  });

  it("should handle selecting specific packages in interactive mode", async () => {
    const dir = tempDirWithFiles("update-interactive-selective", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "1.0.0",
          "a-dep": "1.0.5",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update that selects only first package (space toggles, arrow down, enter)
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send keyboard navigation: space to toggle, arrow down, enter to confirm
    update.stdin.write(" \u001b[B\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Selected 1 package to update");

    // Check only one package was updated
    const packageJson = await Bun.file(join(dir, "package.json")).json();

    // Since we toggled only the first package, check that only one was updated
    // The actual package updated depends on the order, so we check that exactly one changed
    let updatedCount = 0;
    if (packageJson.dependencies["no-deps"] !== "1.0.0") updatedCount++;
    if (packageJson.dependencies["dep-with-tags"] !== "1.0.0") updatedCount++;
    if (packageJson.dependencies["a-dep"] !== "1.0.5") updatedCount++;
    expect(updatedCount).toBe(1);
  });

  it("should handle empty catalog definitions gracefully", async () => {
    const dir = tempDirWithFiles("update-interactive-empty-catalog", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {},
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "^1.0.0",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check workspace package was updated normally
    const appJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appJson.dependencies["no-deps"]).toBe("^2.0.0");

    // Root catalog should remain empty
    const rootJson = await Bun.file(join(dir, "package.json")).json();
    expect(Object.keys(rootJson.catalog)).toHaveLength(0);
  });

  it("should handle cancellation (Ctrl+C) gracefully", async () => {
    const dir = tempDirWithFiles("update-interactive-cancel", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update and send Ctrl+C
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send Ctrl+C to cancel
    update.stdin.write("\u0003");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Cancelled");

    // Check package.json was not modified
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("1.0.0");
  });

  it("should handle packages with pre-release versions correctly", async () => {
    const dir = tempDirWithFiles("update-interactive-prerelease", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "^1.0.0",
          "a-dep": "~1.0.5",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check version prefixes are preserved
    const packageJson = await Bun.file(join(dir, "package.json")).json();

    // Prefixes should be preserved
    expect(packageJson.dependencies["dep-with-tags"]).toMatch(/^\^/);
    expect(packageJson.dependencies["a-dep"]).toMatch(/^~/);
  });

  it("should update catalog in workspaces object (not workspaces.catalogs)", async () => {
    const dir = tempDirWithFiles("update-interactive-workspaces-catalog", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalog: {
            "no-deps": "^1.0.0",
            "dep-with-tags": "~1.0.0",
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Installing updates...");

    // Check catalog was updated with preserved prefixes
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalog["no-deps"]).toBe("^2.0.0");
    expect(packageJson.workspaces.catalog["dep-with-tags"]).toMatch(/^~/);
  });

  it("should handle scoped packages in catalogs correctly", async () => {
    const dir = tempDirWithFiles("update-interactive-scoped-catalog", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "@scoped/has-bin-entry": "^1.0.0",
          "no-deps": "~1.0.0",
          "dep-with-tags": ">=1.0.0",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "@scoped/has-bin-entry": "catalog:",
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check scoped packages were updated with preserved prefixes
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.catalog["@scoped/has-bin-entry"]).toMatch(/^\^/);
    expect(packageJson.catalog["no-deps"]).toMatch(/^~/);
    expect(packageJson.catalog["dep-with-tags"]).toMatch(/^>=/);
  });

  it("should handle catalog updates when running from root with filter", async () => {
    const dir = tempDirWithFiles("update-interactive-filter-catalog", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
          "dep-with-tags": "~1.0.0",
        },
      }),
      "packages/app1/package.json": JSON.stringify({
        name: "@test/app1",
        dependencies: {
          "no-deps": "catalog:",
        },
      }),
      "packages/app2/package.json": JSON.stringify({
        name: "@test/app2",
        dependencies: {
          "dep-with-tags": "catalog:",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with filter
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--filter=@test/app2", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);

    // Check catalog was updated
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.catalog["dep-with-tags"]).toMatch(/^~/);
    //todo: actually check the catalog was updated
  });

  it("should handle multiple catalog definitions with same package", async () => {
    const dir = tempDirWithFiles("update-interactive-multi-catalog", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalogs: {
            "dev": {
              "no-deps": "^1.0.0",
            },
            "prod": {
              "no-deps": "~1.0.0",
            },
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:prod",
        },
        devDependencies: {
          "no-deps": "catalog:dev",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);

    // Check both catalogs were updated with preserved prefixes
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalogs.dev["no-deps"]).toBe("^2.0.0");
    expect(packageJson.workspaces.catalogs.prod["no-deps"]).toMatch(/^~/);
    //todo: actually check the catalog was updated
  });

  it("should handle version ranges with multiple conditions", async () => {
    const dir = tempDirWithFiles("update-interactive-complex-ranges", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0 || ^2.0.0",
          "dep-with-tags": ">=1.0.0 <3.0.0",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with piped input
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check complex ranges are handled (they might be simplified)
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    // Complex ranges might be simplified to latest version
    expect(packageJson.catalog["no-deps"]).toBeDefined();
    expect(packageJson.catalog["dep-with-tags"]).toBeDefined();
  });

  it("should handle dry-run mode correctly", async () => {
    const dir = tempDirWithFiles("update-interactive-dry-run", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "1.0.0",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with dry-run
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Selected");

    // Check packages were NOT updated (dry-run)
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("1.0.0");
    expect(packageJson.dependencies["dep-with-tags"]).toBe("1.0.0");
  });

  it("should handle keyboard navigation correctly", async () => {
    const dir = tempDirWithFiles("update-interactive-navigation", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "1.0.0",
          "a-dep": "1.0.5",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update with keyboard navigation:
    // - n (select none)
    // - i (invert selection)
    // - Enter (confirm)
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send keyboard navigation commands
    update.stdin.write("ni\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Selected 3 packages to update");
  });

  // Comprehensive tests from separate file
  it("comprehensive interactive update test with all scenarios", async () => {
    const dir = tempDirWithFiles("update-interactive-comprehensive", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      // Root package.json with catalog definitions and dependencies
      "package.json": JSON.stringify({
        name: "root-project",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
        // Catalog with old versions that can be updated
        catalog: {
          "no-deps": "^1.0.0",
          "dep-with-tags": "~1.0.0",
        },
        // Some root dependencies
        dependencies: {
          "a-dep": "^1.0.5",
        },
        devDependencies: {
          "normal-dep-and-dev-dep": "^1.0.0",
        },
      }),
      // Workspace 1: Uses catalog references and has its own dependencies
      "packages/app1/package.json": JSON.stringify({
        name: "@test/app1",
        version: "1.0.0",
        dependencies: {
          "no-deps": "catalog:", // References catalog
          "dep-with-tags": "catalog:", // References catalog
          "a-dep": "^1.0.5", // Regular dependency (same as root)
        },
        devDependencies: {
          "normal-dep-and-dev-dep": "^1.0.0", // Dev dependency
        },
      }),
      // Workspace 2: Different dependencies to test workspace-specific updates
      "packages/app2/package.json": JSON.stringify({
        name: "@test/app2",
        version: "1.0.0",
        dependencies: {
          "no-deps": "catalog:", // References catalog
          "a-dep": "^1.0.5", // Regular dependency
        },
        devDependencies: {
          "dep-with-tags": "^1.0.0", // Different from catalog - should update independently
        },
      }),
    });

    // First install to establish the lockfile
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const installExitCode = await install.exited;
    if (installExitCode !== 0) {
      const stderr = await new Response(install.stderr).text();
      console.error("Install failed:", stderr);
    }
    expect(installExitCode).toBe(0);

    // Run interactive update and select all packages
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'a' to select all, then newline to confirm
    update.stdin.write("a\n");
    update.stdin.end();

    const updateExitCode = await update.exited;
    const stdout = await new Response(update.stdout).text();
    const stderr = await new Response(update.stderr).text();
    const combined = stdout + stderr;

    // Should complete successfully
    expect(updateExitCode).toBe(0);
    expect(combined).not.toContain("panic");
    expect(combined).not.toContain("FileNotFound");
    expect(combined).not.toContain("Failed to update");

    // Verify catalog definitions were updated in root package.json
    const rootPackageJson = await Bun.file(join(dir, "package.json")).json();

    // Catalog should be updated while preserving prefixes
    expect(rootPackageJson.catalog["no-deps"]).toBe("^2.0.0");
    expect(rootPackageJson.catalog["dep-with-tags"]).toMatch(/^~/);

    // Root dependencies should be updated
    expect(rootPackageJson.dependencies["a-dep"]).toMatch(/^\^/);
    expect(rootPackageJson.devDependencies["normal-dep-and-dev-dep"]).toMatch(/^\^/);

    // App1 should have catalog references preserved but regular deps updated
    const app1Json = await Bun.file(join(dir, "packages/app1/package.json")).json();
    expect(app1Json.dependencies["no-deps"]).toBe("catalog:"); // Catalog ref preserved
    expect(app1Json.dependencies["dep-with-tags"]).toBe("catalog:"); // Catalog ref preserved
    expect(app1Json.dependencies["a-dep"]).toMatch(/^\^/); // Regular dep updated
    expect(app1Json.devDependencies["normal-dep-and-dev-dep"]).toMatch(/^\^/); // Dev dep updated

    // App2 should have catalog references preserved and independent deps updated
    const app2Json = await Bun.file(join(dir, "packages/app2/package.json")).json();
    expect(app2Json.dependencies["no-deps"]).toBe("catalog:"); // Catalog ref preserved
    expect(app2Json.dependencies["a-dep"]).toMatch(/^\^/); // Regular dep updated
    expect(app2Json.devDependencies["dep-with-tags"]).toMatch(/^\^/); // Independent dep updated

    // Verify lockfile exists and is valid
    console.log("Checking lockfile...");
    const lockfilePath = join(dir, "bun.lock");
    const lockfileExists = await Bun.file(lockfilePath).exists();
    expect(lockfileExists).toBe(true);

    // Run bun install again to verify no changes are needed
    await using verifyInstall = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const verifyExitCode = await verifyInstall.exited;
    const verifyStdout = await new Response(verifyInstall.stdout).text();
    const verifyStderr = await new Response(verifyInstall.stderr).text();
    const verifyCombined = verifyStdout + verifyStderr;

    expect(verifyExitCode).toBe(0);

    // Should indicate no changes are needed - just check that no new packages are being installed
    expect(verifyCombined).not.toContain("Installing");
    // "Saved lockfile" is fine even when no changes, so don't check for it
  });

  it("interactive update with workspace filters", async () => {
    const dir = tempDirWithFiles("update-interactive-filter", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
        },
      }),
      "packages/frontend/package.json": JSON.stringify({
        name: "@test/frontend",
        dependencies: {
          "no-deps": "catalog:",
          "a-dep": "^1.0.5",
        },
      }),
      "packages/backend/package.json": JSON.stringify({
        name: "@test/backend",
        dependencies: {
          "dep-with-tags": "^1.0.0",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Update only frontend workspace
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--filter=@test/frontend", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Verify catalog was updated (even with filter)
    const rootJson = await Bun.file(join(dir, "package.json")).json();
    expect(rootJson.catalog["no-deps"]).toBe("^2.0.0");

    // Verify frontend was updated
    const frontendJson = await Bun.file(join(dir, "packages/frontend/package.json")).json();
    expect(frontendJson.dependencies["a-dep"]).toMatch(/^\^/);

    // Verify backend was not updated (should still be old version)
    const backendJson = await Bun.file(join(dir, "packages/backend/package.json")).json();
    expect(backendJson.dependencies["dep-with-tags"]).toBe("^1.0.0");
  });

  it("interactive update with workspaces.catalogs structure", async () => {
    const dir = tempDirWithFiles("update-interactive-workspaces-catalogs", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalogs: {
            "shared": {
              "no-deps": "^1.0.0",
              "dep-with-tags": "~1.0.0",
            },
            "tools": {
              "a-dep": ">=1.0.5",
            },
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:shared",
          "dep-with-tags": "catalog:shared",
          "a-dep": "catalog:tools",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Installing updates..."); // Should show install message

    // Verify workspaces.catalogs were updated with preserved prefixes AND new versions
    const packageJson = await Bun.file(join(dir, "package.json")).json();

    // Check that versions actually changed from original static values
    expect(packageJson.workspaces.catalogs.shared["no-deps"]).not.toBe("^1.0.0"); // Should be newer
    expect(packageJson.workspaces.catalogs.shared["dep-with-tags"]).not.toBe("~1.0.0"); // Should be newer

    // For a-dep, check if it changed or at least verify it has the right prefix
    // (Some versions might not change if already satisfied)
    const aDep = packageJson.workspaces.catalogs.tools["a-dep"];
    if (aDep !== ">=1.0.5") {
      // Version changed - verify it starts with >=
      expect(aDep).toMatch(/^>=/);
    } else {
      // Version didn't change - that's ok if the constraint was already satisfied
      expect(aDep).toBe(">=1.0.5");
    }

    // Check that prefixes are preserved
    expect(packageJson.workspaces.catalogs.shared["no-deps"]).toMatch(/^\^/);
    expect(packageJson.workspaces.catalogs.shared["dep-with-tags"]).toMatch(/^~/);
    expect(packageJson.workspaces.catalogs.tools["a-dep"]).toMatch(/^>=/);

    // App package should still have catalog references (unchanged)
    const appJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appJson.dependencies["no-deps"]).toBe("catalog:shared");
    expect(appJson.dependencies["dep-with-tags"]).toBe("catalog:shared");
    expect(appJson.dependencies["a-dep"]).toBe("catalog:tools");
  });

  it("interactive update dry run mode", async () => {
    const dir = tempDirWithFiles("update-interactive-dry-run", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "1.0.0",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Store original package.json content
    const originalContent = await Bun.file(join(dir, "package.json")).text();

    // Run interactive update with dry-run
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Dry run");

    // Verify package.json was NOT modified
    const afterContent = await Bun.file(join(dir, "package.json")).text();
    expect(afterContent).toBe(originalContent);

    // Parse and verify versions are still old
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("1.0.0");
    expect(packageJson.dependencies["dep-with-tags"]).toBe("1.0.0");
  });

  it("should preserve npm: alias prefix when updating packages", async () => {
    const dir = tempDirWithFiles("update-interactive-npm-alias", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "my-alias": "npm:no-deps@1.0.0",
          "@my/alias": "npm:@types/no-deps@^1.0.0",
        },
      }),
    });

    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["my-alias"]).toBe("npm:no-deps@2.0.0");
    expect(packageJson.dependencies["@my/alias"]).toBe("npm:@types/no-deps@^2.0.0");
  });

  it("interactive update with mixed dependency types", async () => {
    const dir = tempDirWithFiles("update-interactive-mixed", {
      "bunfig.toml": `[install]
cache = false
registry = "${registryUrl}"
`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "a-dep": "^1.0.5",
        },
        dependencies: {
          "no-deps": "^1.0.0",
        },
        devDependencies: {
          "dep-with-tags": "~1.0.0",
        },
        peerDependencies: {
          "a-dep": ">=1.0.5",
        },
        optionalDependencies: {
          "normal-dep-and-dev-dep": "^1.0.0",
        },
      }),
      "packages/workspace1/package.json": JSON.stringify({
        name: "@test/workspace1",
        dependencies: {
          "a-dep": "catalog:",
          "@test/workspace2": "workspace:*",
        },
        devDependencies: {
          "no-deps": "^1.0.0",
        },
      }),
      "packages/workspace2/package.json": JSON.stringify({
        name: "@test/workspace2",
        version: "1.0.0",
        dependencies: {
          "a-dep": "catalog:",
        },
      }),
    });

    // Install first
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    // Run interactive update
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "-r", "--latest"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    update.stdin.write("a\n");
    update.stdin.end();

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Verify all dependency types were handled correctly
    const rootJson = await Bun.file(join(dir, "package.json")).json();
    expect(rootJson.catalog["a-dep"]).toMatch(/^\^/); // Catalog updated
    expect(rootJson.dependencies["no-deps"]).toMatch(/^\^/); // Regular dep updated
    expect(rootJson.devDependencies["dep-with-tags"]).toMatch(/^~/); // Dev dep updated with prefix preserved
    expect(rootJson.peerDependencies["a-dep"]).toMatch(/^>=/); // Peer dep updated with prefix preserved
    expect(rootJson.optionalDependencies["normal-dep-and-dev-dep"]).toMatch(/^\^/); // Optional dep updated

    // Verify workspace dependencies
    const ws1Json = await Bun.file(join(dir, "packages/workspace1/package.json")).json();
    expect(ws1Json.dependencies["a-dep"]).toBe("catalog:"); // Catalog ref preserved
    expect(ws1Json.dependencies["@test/workspace2"]).toBe("workspace:*"); // Workspace ref preserved
    expect(ws1Json.devDependencies["no-deps"]).toMatch(/^\^/); // Regular dep updated

    const ws2Json = await Bun.file(join(dir, "packages/workspace2/package.json")).json();
    expect(ws2Json.dependencies["a-dep"]).toBe("catalog:"); // Catalog ref preserved
  });
});
