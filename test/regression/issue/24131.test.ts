import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("issue #24131 - 'l' key should select package in interactive update", () => {
  it("should select package when pressing 'l' to toggle use_latest", async () => {
    using dir = tempDir("issue-24131", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Use a very old version that definitely has updates available
          "is-even": "0.1.0",
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

    // Read the initial package.json to verify starting state
    const initialPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
    expect(initialPackageJson.dependencies["is-even"]).toBe("0.1.0");

    // Now run update --interactive
    // Press 'l' to toggle use_latest (which should also select the package)
    // Then press 'y' or Enter to confirm
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // 'l' toggles use_latest and should also select the package (the fix)
    // '\r' (Enter) confirms the selection
    updateProc.stdin.write("l\r");
    updateProc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      updateProc.stdout.text(),
      updateProc.stderr.text(),
      updateProc.exited,
    ]);

    // Check that package.json was updated - this proves 'l' selected the package
    // Before the fix, 'l' would toggle use_latest but not select the package,
    // so Enter would result in no packages being updated
    const updatedPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
    const updatedVersion = updatedPackageJson.dependencies["is-even"];

    // The version should have changed from "0.1.0"
    // This assertion failing means 'l' did not select the package
    expect(updatedVersion).not.toBe("0.1.0");

    expect(exitCode).toBe(0);
  });
});
