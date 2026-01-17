import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("workspace packages with lifecycle scripts should not trigger unnecessary HTTP requests", async () => {
  // Create temp directory with test files
  using dir = tempDir("issue-26070", {
    "package.json": JSON.stringify({
      name: "test-workspace",
      workspaces: ["packages/*"],
    }),
    "packages/app/package.json": JSON.stringify({
      name: "@workspace/app",
      version: "1.0.0",
      scripts: {
        prepare: "echo 'Do some preparations...'",
      },
      dependencies: {
        "@workspace/lib": "workspace:*",
      },
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "@workspace/lib",
      version: "1.0.0",
      dependencies: {
        "is-odd": "^3.0.1",
      },
    }),
  });

  // First install creates the lockfile
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  }

  // Second install with --force should detect no real changes in workspace packages
  // and should NOT report "updated 1 dependencies" for lifecycle script false positives
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--force", "--verbose"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The verbose output should not show "updated 1 dependencies" for workspace packages
    // when no actual dependencies have changed. This was the bug - lifecycle scripts
    // were incorrectly triggering this count.
    const output = stdout + stderr;

    // Check that we're not seeing false positive updates for workspace packages
    if (
      output.includes(
        'Workspace package "packages/app" has added 0 dependencies, removed 0 dependencies, and updated 1 dependencies',
      )
    ) {
      throw new Error(
        "Bug #26070: Workspace package lifecycle scripts are incorrectly triggering 'updated 1 dependencies' message",
      );
    }

    expect(exitCode).toBe(0);
  }
});
