// https://github.com/oven-sh/bun/issues/26338
// Test that when a lockfile references a stale file: dependency path,
// the error message correctly identifies the missing dependency path
// instead of showing "Bun could not find a package.json file to install from"

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("shows informative error for missing file: dependency path", async () => {
  // Create a directory structure where:
  // - package.json references a path that doesn't exist
  // - bun.lock references a different (also non-existent) path
  // This simulates a stale lockfile scenario
  using dir = tempDir("missing-file-dep", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        dep: "file:../packages/@scope/dep",
      },
    }),
    "bun.lock": JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: {
        "": {
          name: "app",
          dependencies: {
            dep: "file:../dep",
          },
        },
      },
      packages: {
        dep: ["dep@file:../dep", {}],
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The error should mention the file: path, not a generic "package.json not found" message
  expect(stderr).toContain("file:../packages/@scope/dep");
  // Check that the dependency name "dep" appears as a quoted token (not just as part of "dependency")
  expect(stderr).toMatch(/"dep"/);
  expect(stderr).not.toContain("Bun could not find a package.json file to install from");
  expect(stderr).not.toContain('Run "bun init" to initialize a project');

  expect(exitCode).not.toBe(0);
});
