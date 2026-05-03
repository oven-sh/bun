// Regression test for https://github.com/oven-sh/bun/issues/26758
// bun update --interactive does not respect user selections - updates ALL packages
// instead of only the selected ones.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("issue #26758 - bun update --interactive respects selections", () => {
  test("should only update selected package to latest, not all packages", async () => {
    // Create a project with multiple outdated dependencies using exact versions.
    // The bug manifests when using --latest or 'l' to toggle latest in interactive mode.
    using dir = tempDir("update-interactive-26758", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Use exact versions - these have newer versions available
          lodash: "4.17.0", // 4.17.0 -> 4.17.23
          debug: "4.0.0", // 4.0.0 -> 4.4.3
        },
      }),
    });

    // First, run bun install to create initial node_modules and lockfile
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const installExitCode = await installProc.exited;
    expect(installExitCode).toBe(0);

    // Verify initial installation
    const initialLodashPkg = JSON.parse(
      readFileSync(join(String(dir), "node_modules", "lodash", "package.json"), "utf8"),
    );
    const initialDebugPkg = JSON.parse(
      readFileSync(join(String(dir), "node_modules", "debug", "package.json"), "utf8"),
    );
    expect(initialLodashPkg.version).toBe("4.17.0");
    expect(initialDebugPkg.version).toBe("4.0.0");

    // Now run update --interactive
    // Select only lodash using 'l' (which toggles latest AND selects)
    // debug comes before lodash alphabetically
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Move down to lodash (second item) and use 'l' to toggle latest + select
      updateProc.stdin.write("j"); // Move down to lodash
      updateProc.stdin.write("l"); // Toggle latest (also selects)
      updateProc.stdin.write("\r"); // Enter to confirm
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

      // Check the installed versions
      const updatedLodashPkg = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "lodash", "package.json"), "utf8"),
      );
      const updatedDebugPkg = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "debug", "package.json"), "utf8"),
      );

      // The SELECTED package (lodash) should be updated to latest
      expect(updatedLodashPkg.version).not.toBe("4.17.0");
      expect(Bun.semver.satisfies(updatedLodashPkg.version, ">4.17.0")).toBe(true);

      // The UNSELECTED package (debug) should NOT be updated - THIS IS THE BUG FIX
      // Before the fix, debug would also be updated even though it wasn't selected
      expect(updatedDebugPkg.version).toBe("4.0.0");

      // Verify package.json was only updated for the selected package
      const updatedPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
      expect(updatedPackageJson.dependencies["debug"]).toBe("4.0.0");
      expect(updatedPackageJson.dependencies["lodash"]).not.toBe("4.17.0");
    } catch (err) {
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });

  test("should update multiple selected packages but not unselected ones", async () => {
    // Create a project with three outdated dependencies using exact versions
    using dir = tempDir("update-interactive-26758-multi", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Using exact versions
          chalk: "4.0.0", // 4.0.0 -> 5.x
          debug: "4.0.0", // 4.0.0 -> 4.4.3
          lodash: "4.17.0", // 4.17.0 -> 4.17.23
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

    const installExitCode = await installProc.exited;
    expect(installExitCode).toBe(0);

    // Verify initial versions
    expect(JSON.parse(readFileSync(join(String(dir), "node_modules", "chalk", "package.json"), "utf8")).version).toBe(
      "4.0.0",
    );
    expect(JSON.parse(readFileSync(join(String(dir), "node_modules", "debug", "package.json"), "utf8")).version).toBe(
      "4.0.0",
    );
    expect(JSON.parse(readFileSync(join(String(dir), "node_modules", "lodash", "package.json"), "utf8")).version).toBe(
      "4.17.0",
    );

    // Select chalk (first) and lodash (third), skip debug (second)
    // Packages sorted: chalk, debug, lodash
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      updateProc.stdin.write("l"); // Toggle latest + select chalk (cursor at first item)
      updateProc.stdin.write("j"); // Move down to debug
      // Don't select debug
      updateProc.stdin.write("j"); // Move down to lodash
      updateProc.stdin.write("l"); // Toggle latest + select lodash
      updateProc.stdin.write("\r"); // Confirm
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

      // Check updated versions
      const updatedChalkPkg = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "chalk", "package.json"), "utf8"),
      );
      const updatedDebugPkg = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "debug", "package.json"), "utf8"),
      );
      const updatedLodashPkg = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "lodash", "package.json"), "utf8"),
      );

      // Selected packages (chalk and lodash) should be updated
      expect(updatedChalkPkg.version).not.toBe("4.0.0");
      expect(updatedLodashPkg.version).not.toBe("4.17.0");

      // Unselected package (debug) should NOT be updated - THIS IS THE BUG FIX
      expect(updatedDebugPkg.version).toBe("4.0.0");
    } catch (err) {
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });
});
