import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
} from "./install/dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

describe.concurrent("bun update --interactive actually installs packages", () => {
  test("does not offer dependencies removed from package.json but still present in bun.lock", async () => {
    const ctx = await createTestContext();
    try {
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, [], {
          "1.0.0": {},
          "2.0.0": {},
          latest: "2.0.0",
        }),
      );
      await Bun.write(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "root",
          version: "1.0.0",
          private: true,
          workspaces: ["packages/*"],
          dependencies: {
            "dep-universal": "1.0.0",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "packages/app"), { recursive: true });
      await Bun.write(
        join(ctx.package_dir, "packages/app/package.json"),
        JSON.stringify({
          name: "@test/app",
          version: "1.0.0",
          dependencies: {
            "dep-multi-cpu": "1.0.0",
          },
        }),
      );

      await using install = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [installStdout, installStderr, installExitCode] = await Promise.all([
        install.stdout.text(),
        install.stderr.text(),
        install.exited,
      ]);
      expect({ stdout: installStdout, stderr: installStderr, exitCode: installExitCode }).toMatchObject({
        exitCode: 0,
      });

      await Bun.write(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "root",
          version: "1.0.0",
          private: true,
          workspaces: ["packages/*"],
        }),
      );

      await using update = Bun.spawn({
        cmd: [bunExe(), "update", "--latest", "--recursive", "--force", "--save", "-i"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      update.stdin.write("\u0003");
      update.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([update.stdout.text(), update.stderr.text(), update.exited]);

      expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
      expect(stdout).toContain("dep-multi-cpu");
      expect(stdout).not.toContain("dep-universal");
    } finally {
      destroyTestContext(ctx);
    }
  });

  test("should update package.json AND install packages", async () => {
    using dir = tempDir("update-interactive-install", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Use a very old version that definitely has updates available
          "is-even": "0.1.0",
        },
      }),
    });

    // Isolate the install cache per test so the concurrent tests in this file
    // don't race on the shared global cache (flaky ENOENT on Windows).
    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") };

    // First, run bun install to create initial node_modules
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [installStdout, installStderr, installExitCode] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);
    expect({ stdout: installStdout, stderr: installStderr, exitCode: installExitCode }).toMatchObject({
      exitCode: 0,
    });

    // Verify initial installation
    const initialPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
    expect(initialPackageJson.dependencies["is-even"]).toBe("0.1.0");

    // Check that node_modules was created
    expect(existsSync(join(String(dir), "node_modules"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules", "is-even"))).toBe(true);

    // Read the initial installed version from package.json in node_modules
    const initialInstalledPkgJson = JSON.parse(
      readFileSync(join(String(dir), "node_modules", "is-even", "package.json"), "utf8"),
    );
    const initialVersion = initialInstalledPkgJson.version;
    expect(initialVersion).toBe("0.1.0");

    // Now run update --interactive with automatic selection
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Select first package and confirm
      updateProc.stdin.write(" "); // space to select
      updateProc.stdin.write("\r"); // enter to confirm
      updateProc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([
        updateProc.stdout.text(),
        updateProc.stderr.text(),
        updateProc.exited,
      ]);

      // Debug output if test fails
      if (exitCode !== 0) {
        console.log("STDOUT:", stdout);
        console.log("STDERR:", stderr);
      }

      expect(exitCode).toBe(0);

      // Check that package.json was updated
      const updatedPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
      const updatedVersion = updatedPackageJson.dependencies["is-even"];

      // The version should have changed from "0.1.0"
      expect(updatedVersion).not.toBe("0.1.0");

      // Most importantly: verify that node_modules was actually updated!
      // This is the bug - previously only package.json changed but not node_modules
      const installedPkgJson = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "is-even", "package.json"), "utf8"),
      );
      const installedVersion = installedPkgJson.version;

      // The installed version should match what's in package.json
      // Extract version number from potentially semver-prefixed string (e.g., "^1.1.0" -> "1.1.0")
      const expectedVersion = updatedVersion.replace(/^[\^~]/, "");

      // The installed version should NOT be the old version
      expect(installedVersion).not.toBe("0.1.0");
      expect(Bun.semver.satisfies(installedVersion, ">0.1.0")).toBe(true);

      // And ideally should match the expected version (or at least be compatible)
      // We check that it starts with the expected major.minor
      const [expectedMajor, expectedMinor] = expectedVersion.split(".");
      expect(installedVersion).toContain(`${expectedMajor}.${expectedMinor}`);
    } catch (err) {
      // Ensure cleanup on failure
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });

  test("should work with --latest flag", async () => {
    using dir = tempDir("update-interactive-latest", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-odd": "0.1.0", // Use old version of is-odd
        },
      }),
    });

    // Isolate the install cache per test so the concurrent tests in this file
    // don't race on the shared global cache (flaky ENOENT on Windows).
    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") };

    // Initial install
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [installStdout, installStderr, installExitCode] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);
    expect({ stdout: installStdout, stderr: installStderr, exitCode: installExitCode }).toMatchObject({
      exitCode: 0,
    });

    // Verify initial version
    const initialPkgJson = JSON.parse(
      readFileSync(join(String(dir), "node_modules", "is-odd", "package.json"), "utf8"),
    );
    expect(initialPkgJson.version).toBe("0.1.0");

    // Run update --interactive with 'l' to toggle latest, then select and confirm
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // 'l' toggles to latest AND selects the package (no separate space needed)
      updateProc.stdin.write("l"); // toggle latest (also selects)
      updateProc.stdin.write("\r"); // confirm
      updateProc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([
        updateProc.stdout.text(),
        updateProc.stderr.text(),
        updateProc.exited,
      ]);

      if (exitCode !== 0) {
        console.log("STDOUT:", stdout);
        console.log("STDERR:", stderr);
      }

      expect(exitCode).toBe(0);

      // Verify node_modules was updated
      const updatedPkgJson = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "is-odd", "package.json"), "utf8"),
      );

      // Should be newer than 0.1.0
      expect(updatedPkgJson.version).not.toBe("0.1.0");
      expect(Bun.semver.satisfies(updatedPkgJson.version, ">0.1.0")).toBe(true);
    } catch (err) {
      // Ensure cleanup on failure
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });
});
