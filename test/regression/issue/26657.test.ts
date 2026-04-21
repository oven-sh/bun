import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("bun update -i select all with 'A' key", () => {
  // Issue #26657: When pressing 'A' to select all packages in interactive update,
  // the UI shows "Selected X packages to update" but then shows "No packages selected for update"
  // because packages where current_version == update_version were silently filtered out.
  test("should update packages when 'A' is pressed to select all", async () => {
    // Create a project with a package that has an old version
    // The package constraint allows higher versions, and there's a newer latest version
    using dir = tempDir("update-interactive-select-all", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Use a very old version that definitely has updates available
          "is-even": "0.1.0",
        },
      }),
    });

    // First, run bun install to create initial node_modules
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [installStdout, installStderr, installExitCode] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);

    // Check install succeeded before proceeding
    if (installExitCode !== 0) {
      console.log("Install STDOUT:", installStdout);
      console.log("Install STDERR:", installStderr);
    }
    expect(installExitCode).toBe(0);

    // Verify initial installation
    const initialPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
    expect(initialPackageJson.dependencies["is-even"]).toBe("0.1.0");

    // Now run update --interactive and press 'A' to select all, then Enter to confirm
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Press 'A' to select all packages, then Enter to confirm
      updateProc.stdin.write("A"); // select all
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

      // The bug was that it would say "No packages selected for update"
      // Check that this error message does NOT appear (check before exitCode for better error messages)
      expect(stdout).not.toContain("No packages selected for update");
      expect(stderr).not.toContain("No packages selected for update");

      expect(exitCode).toBe(0);

      // Check that package.json was updated
      const updatedPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
      const updatedVersion = updatedPackageJson.dependencies["is-even"];

      // The version should have changed from "0.1.0"
      expect(updatedVersion).not.toBe("0.1.0");

      // Verify node_modules was actually updated
      const installedPkgJson = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "is-even", "package.json"), "utf8"),
      );
      const installedVersion = installedPkgJson.version;

      // The installed version should NOT be the old version
      expect(installedVersion).not.toBe("0.1.0");
      expect(Bun.semver.satisfies(installedVersion, ">0.1.0")).toBe(true);
    } catch (err) {
      // Ensure cleanup on failure
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });

  test("should handle packages where current equals update version but not latest", async () => {
    // This is the core of issue #26657: packages that are at the highest version
    // within their semver constraint but not at the latest version overall
    using dir = tempDir("update-interactive-select-all-constrained", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Use a version constraint that limits updates
          // The point is to have packages where current == update_version but current != latest
          "is-even": "^1.0.0",
        },
      }),
    });

    // First install
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [installStdout, installStderr, installExitCode] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);

    // Check install succeeded before proceeding
    if (installExitCode !== 0) {
      console.log("Install STDOUT:", installStdout);
      console.log("Install STDERR:", installStderr);
    }
    expect(installExitCode).toBe(0);

    // Get the installed version
    const installedPkgJson = JSON.parse(
      readFileSync(join(String(dir), "node_modules", "is-even", "package.json"), "utf8"),
    );
    const currentVersion = installedPkgJson.version;

    // Now run update --interactive with 'A' to select all
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      updateProc.stdin.write("A"); // select all
      updateProc.stdin.write("\r"); // confirm
      updateProc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([
        updateProc.stdout.text(),
        updateProc.stderr.text(),
        updateProc.exited,
      ]);

      // If there were packages shown in the list, they should have been processed
      // The key assertion: we should NOT see "Selected X packages" followed by "No packages selected"
      const selectedMatch = stdout.match(/Selected (\d+) package/);
      if (selectedMatch) {
        const selectedCount = parseInt(selectedMatch[1], 10);
        if (selectedCount > 0) {
          // If packages were selected, they should have been processed (check before exitCode)
          expect(stdout).not.toContain("No packages selected for update");
          expect(stderr).not.toContain("No packages selected for update");
        }
      }

      // The command should succeed without "No packages selected for update" error
      // (unless there are genuinely no outdated packages, which is a valid state)
      expect(exitCode).toBe(0);
    } catch (err) {
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });
});
