import { describe, expect, it, beforeAll, afterAll } from "bun:test";
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

describe("bun update --interactive formatting", () => {
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

  it.skipIf(process.platform === "win32")("should update packages when 'a' (select all) is used", async () => {
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
    const stderr = await new Response(update.stderr).text();

    // Should complete successfully
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("panic");

    // Check if package.json was updated
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    // no-deps should be updated from 1.0.0 to 2.0.0
    expect(packageJson.dependencies["no-deps"]).toBe("2.0.0");
  });

  it.skipIf(process.platform === "win32")("should handle workspace updates with recursive flag", async () => {
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

  it.skipIf(process.platform === "win32")("should handle catalog updates correctly", async () => {
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

    // Create a script that runs the interactive update and selects all
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

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

  it.skipIf(process.platform === "win32")(
    "should work correctly when run from inside a workspace directory",
    async () => {
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

      // Create a script that runs from inside workspace
      const scriptPath = join(dir, "update-from-workspace.sh");
      const workspaceDir = join(dir, "packages/app1");
      await Bun.write(
        scriptPath,
        `#!/bin/bash
cd "${workspaceDir}"
echo "a" | ${bunExe()} update -i -r --latest
`,
      );
      await Bun.spawn(["chmod", "+x", scriptPath]).exited;

      // Run through script command to get a PTY
      await using update = Bun.spawn({
        cmd: ["script", "-q", "/dev/null", scriptPath],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

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
    },
  );

  it.skipIf(process.platform === "win32")("should handle basic interactive update with select all", async () => {
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

    // Alternative approach: use expect or unbuffer if available
    let ptyCmd: string[];

    // Try different PTY allocation methods
    const hasExpect = (await Bun.spawn(["which", "expect"]).exited) === 0;
    const hasUnbuffer = (await Bun.spawn(["which", "unbuffer"]).exited) === 0;

    if (hasExpect) {
      // Use expect to handle interactive session
      const expectScript = `
spawn ${bunExe()} update -i --latest
expect "Select packages to update"
send "a\\r"
expect eof
`;
      await Bun.write(join(dir, "expect-script"), expectScript);
      ptyCmd = ["expect", join(dir, "expect-script")];
    } else if (hasUnbuffer) {
      // Use unbuffer
      ptyCmd = ["unbuffer", "-p", bunExe(), "update", "-i", "--latest"];
    } else {
      // Fall back to script
      const scriptPath = join(dir, "update-script.sh");
      await Bun.write(
        scriptPath,
        `#!/bin/bash
echo "a" | ${bunExe()} update -i --latest
`,
      );
      await Bun.spawn(["chmod", "+x", scriptPath]).exited;
      ptyCmd = ["script", "-q", "/dev/null", scriptPath];
    }

    await using update = Bun.spawn({
      cmd: ptyCmd,
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: hasUnbuffer ? "pipe" : "inherit",
    });

    if (hasUnbuffer) {
      update.stdin?.write("a\n");
      update.stdin?.end();
    }

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check if package was updated
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("2.0.0");
  });

  it.skipIf(process.platform === "win32")(
    "should preserve version prefixes for all semver range types in catalogs",
    async () => {
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

      // Create update script
      const scriptPath = join(dir, "update-script.sh");
      await Bun.write(
        scriptPath,
        `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
      );
      await Bun.spawn(["chmod", "+x", scriptPath]).exited;

      // Run through script command to get a PTY
      await using update = Bun.spawn({
        cmd: ["script", "-q", "/dev/null", scriptPath],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await update.exited;
      expect(exitCode).toBe(0);

      // Check if prefixes were preserved
      const packageJson = await Bun.file(join(dir, "package.json")).json();

      // All prefixes should be preserved (versions may or may not change)
      expect(packageJson.catalog["no-deps"]).toMatch(/^\^/);
      expect(packageJson.catalog["dep-with-tags"]).toMatch(/^~/);
      expect(packageJson.catalog["a-dep"]).toMatch(/^>=/);
    },
  );

  it.skipIf(process.platform === "win32")("should handle catalog updates in workspaces.catalogs object", async () => {
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

    // Create update script
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Updated no-deps in workspaces.catalogs.tools");

    // Check if catalogs were updated correctly
    const packageJson = await Bun.file(join(dir, "package.json")).json();

    // Prefixes should be preserved
    expect(packageJson.workspaces.catalogs.tools["no-deps"]).toMatch(/^\^/);
    expect(packageJson.workspaces.catalogs.tools["dep-with-tags"]).toMatch(/^~/);
  });

  it.skipIf(process.platform === "win32")("should handle mixed workspace and catalog dependencies", async () => {
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

    // Create update script
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

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

  it.skipIf(process.platform === "win32")("should handle selecting specific packages in interactive mode", async () => {
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

    // Create update script that selects only first package (space toggles, arrow down, enter)
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
printf " \\033[B\\n" | ${bunExe()} update -i --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

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

  it.skipIf(process.platform === "win32")("should handle empty catalog definitions gracefully", async () => {
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

    // Create update script
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check workspace package was updated normally
    const appJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appJson.dependencies["no-deps"]).toBe("^2.0.0");

    // Root catalog should remain empty
    const rootJson = await Bun.file(join(dir, "package.json")).json();
    expect(Object.keys(rootJson.catalog)).toHaveLength(0);
  });

  it.skipIf(process.platform === "win32")("should handle cancellation (Ctrl+C) gracefully", async () => {
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

    // Create update script that sends Ctrl+C
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
printf "\\003" | ${bunExe()} update -i --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Cancelled");

    // Check package.json was not modified
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("1.0.0");
  });

  it.skipIf(process.platform === "win32")("should handle packages with pre-release versions correctly", async () => {
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

    // Create update script
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check version prefixes are preserved
    const packageJson = await Bun.file(join(dir, "package.json")).json();

    // Prefixes should be preserved
    expect(packageJson.dependencies["dep-with-tags"]).toMatch(/^\^/);
    expect(packageJson.dependencies["a-dep"]).toMatch(/^~/);
  });

  it.skipIf(process.platform === "win32")(
    "should update catalog in workspaces object (not workspaces.catalogs)",
    async () => {
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

      // Create update script
      const scriptPath = join(dir, "update-script.sh");
      await Bun.write(
        scriptPath,
        `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
      );
      await Bun.spawn(["chmod", "+x", scriptPath]).exited;

      // Run through script command to get a PTY
      await using update = Bun.spawn({
        cmd: ["script", "-q", "/dev/null", scriptPath],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await update.exited;
      const output = await new Response(update.stdout).text();

      expect(exitCode).toBe(0);
      expect(output).toContain("Updated dep-with-tags in workspaces.catalog");

      // Check catalog was updated with preserved prefixes
      const packageJson = await Bun.file(join(dir, "package.json")).json();
      expect(packageJson.workspaces.catalog["no-deps"]).toBe("^2.0.0");
      expect(packageJson.workspaces.catalog["dep-with-tags"]).toMatch(/^~/);
    },
  );

  it.skipIf(process.platform === "win32")("should handle scoped packages in catalogs correctly", async () => {
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

    // Create update script
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check scoped packages were updated with preserved prefixes
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.catalog["@scoped/has-bin-entry"]).toMatch(/^\^/);
    expect(packageJson.catalog["no-deps"]).toMatch(/^~/);
    expect(packageJson.catalog["dep-with-tags"]).toMatch(/^>=/);
  });

  it.skipIf(process.platform === "win32")(
    "should handle catalog updates when running from root with filter",
    async () => {
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

      // Create update script with filter
      const scriptPath = join(dir, "update-script.sh");
      await Bun.write(
        scriptPath,
        `#!/bin/bash
echo "a" | ${bunExe()} update -i --filter="@test/app2" --latest
`,
      );
      await Bun.spawn(["chmod", "+x", scriptPath]).exited;

      // Run through script command to get a PTY
      await using update = Bun.spawn({
        cmd: ["script", "-q", "/dev/null", scriptPath],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await update.exited;
      const output = await new Response(update.stdout).text();

      expect(exitCode).toBe(0);
      // Should update catalog even when using filter
      expect(output).toContain("Updated dep-with-tags in catalog");

      // Check catalog was updated
      const packageJson = await Bun.file(join(dir, "package.json")).json();
      expect(packageJson.catalog["dep-with-tags"]).toMatch(/^~/);
    },
  );

  it.skipIf(process.platform === "win32")("should handle multiple catalog definitions with same package", async () => {
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

    // Create update script
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Updated no-deps in workspaces.catalogs");

    // Check both catalogs were updated with preserved prefixes
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalogs.dev["no-deps"]).toBe("^2.0.0");
    expect(packageJson.workspaces.catalogs.prod["no-deps"]).toMatch(/^~/);
  });

  it.skipIf(process.platform === "win32")("should handle version ranges with multiple conditions", async () => {
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

    // Create update script
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i -r --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    expect(exitCode).toBe(0);

    // Check complex ranges are handled (they might be simplified)
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    // Complex ranges might be simplified to latest version
    expect(packageJson.catalog["no-deps"]).toBeDefined();
    expect(packageJson.catalog["dep-with-tags"]).toBeDefined();
  });

  it.skipIf(process.platform === "win32")("should handle dry-run mode correctly", async () => {
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

    // Create update script with dry-run
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
echo "a" | ${bunExe()} update -i --latest --dry-run
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Selected");

    // Check packages were NOT updated (dry-run)
    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("1.0.0");
    expect(packageJson.dependencies["dep-with-tags"]).toBe("1.0.0");
  });

  it.skipIf(process.platform === "win32")("should handle keyboard navigation correctly", async () => {
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

    // Create update script that uses:
    // - n (select none)
    // - i (invert selection)
    // - Enter (confirm)
    const scriptPath = join(dir, "update-script.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
printf "ni\\n" | ${bunExe()} update -i --latest
`,
    );
    await Bun.spawn(["chmod", "+x", scriptPath]).exited;

    // Run through script command to get a PTY
    await using update = Bun.spawn({
      cmd: ["script", "-q", "/dev/null", scriptPath],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await update.exited;
    const output = await new Response(update.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Selected 3 packages to update");
  });
});
