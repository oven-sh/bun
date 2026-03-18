import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/28247
// `bun update -g --latest` panics with "Internal assertion failure" when
// global package.json contains workspace:* dependencies that can't be resolved.
// On Windows (ReleaseSafe builds), this triggered a @panic in
// PackageInstaller.installDependency's else branch for unexpected resolution tags.
test("bun update -g --latest does not crash with unresolvable workspace:* dependencies", async () => {
  using dir = tempDir("issue-28247", {
    "global-install/install/global/package.json": JSON.stringify({
      dependencies: {
        "@fake-scope/plugin": "workspace:*",
        "@fake-scope/sdk": "workspace:*",
      },
    }),
    "bunfig.toml": "",
  });

  const globalDir = join(String(dir), "global-install");
  const globalBinDir = join(String(dir), "global-bin");

  // Overwrite bunfig.toml with the correct path (needs globalBinDir which depends on dir)
  await Bun.write(
    join(String(dir), "bunfig.toml"),
    `
[install]
cache = false
globalBinDir = "${globalBinDir.replace(/\\/g, "\\\\")}"
`,
  );

  const bunfigPath = join(String(dir), "bunfig.toml");

  await using proc = spawn({
    cmd: [bunExe(), "update", "-g", "--latest", `--config=${bunfigPath}`],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      BUN_INSTALL: globalDir,
    },
  });

  const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

  // The workspace deps can't be resolved, so we expect an error exit - but NOT a crash/panic.
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Internal assertion failure");
  expect(stderr).toContain("Workspace dependency");
  expect(stderr).toContain("failed to resolve");

  // Should exit with error code 1 (resolution failure), not a signal/crash
  expect(exitCode).toBe(1);
});
