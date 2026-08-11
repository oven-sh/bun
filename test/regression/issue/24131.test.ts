import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

let registry: VerdaccioRegistry;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("issue #24131 - 'l' key should select package in interactive update", () => {
  it("should select package when pressing 'l' to toggle use_latest", async () => {
    // The local registry's `no-deps` has 1.0.0 through 2.0.0 (latest), so the
    // pinned 1.0.0 shows up in the interactive list with a newer latest version.
    using dir = tempDir("issue-24131", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.registryUrl()}"\n`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
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

    const [installStdout, installStderr, installExitCode] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);
    expect({ installStdout, installStderr, installExitCode }).toMatchObject({ installExitCode: 0 });

    // Now run update --interactive.
    // 'l' toggles use_latest and should also select the package (the fix);
    // '\r' (Enter) confirms the selection.
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    updateProc.stdin.write("l\r");
    updateProc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      updateProc.stdout.text(),
      updateProc.stderr.text(),
      updateProc.exited,
    ]);

    // Before the fix, 'l' toggled use_latest without selecting the package, so
    // Enter confirmed an empty selection and nothing was updated.
    expect(stdout).toContain("Selected 1 package to update");
    expect(stdout).not.toContain("No packages selected for update");
    expect(stderr).not.toContain("No packages selected for update");
    expect(exitCode).toBe(0);

    const updatedPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
    expect(updatedPackageJson.dependencies["no-deps"]).toBe("2.0.0");

    const installedPackageJson = JSON.parse(
      readFileSync(join(String(dir), "node_modules", "no-deps", "package.json"), "utf8"),
    );
    expect(installedPackageJson.version).toBe("2.0.0");
  });
});
