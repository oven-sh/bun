// https://github.com/oven-sh/bun/issues/25801
// Workspace packages that are symlinks to directories outside the monorepo
// should be discovered during `bun install` when using glob patterns.

import { expect, test } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("workspace glob patterns should follow symlinks to external directories", async () => {
  // Create a temporary directory for the external package (outside the monorepo)
  using externalPkgDir = tempDir("external-pkg", {
    "package.json": JSON.stringify({
      name: "backend",
      version: "1.0.0",
    }),
  });

  // Create the monorepo with a glob pattern in workspaces
  using monorepoDir = tempDir("monorepo", {
    "package.json": JSON.stringify({
      name: "monorepo-test",
      workspaces: ["./*"],
      dependencies: {
        backend: "workspace:*",
      },
    }),
  });

  // Create a symlink inside the monorepo pointing to the external package
  symlinkSync(String(externalPkgDir), join(String(monorepoDir), "backend"));

  // Run bun install
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(monorepoDir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not fail with "Workspace dependency 'backend' not found"
  expect(stderr).not.toContain("Workspace dependency");
  expect(stderr).not.toContain("not found");

  // Should succeed
  expect(exitCode).toBe(0);
});

test("workspace glob patterns should follow symlinks in packages directory", async () => {
  // Create an external package to be symlinked
  using externalPkgDir = tempDir("external-alias-pkg", {
    "package.json": JSON.stringify({
      name: "pkg-alias",
      version: "2.0.0",
    }),
  });

  // Create a monorepo with packages/* glob pattern
  using monorepoDir = tempDir("monorepo-internal", {
    "package.json": JSON.stringify({
      name: "monorepo-internal",
      workspaces: ["packages/*"],
      dependencies: {
        "pkg-alias": "workspace:*",
      },
    }),
    "packages/real-pkg/package.json": JSON.stringify({
      name: "real-pkg",
      version: "1.0.0",
    }),
  });

  // Create a symlink to the external package inside packages/
  symlinkSync(String(externalPkgDir), join(String(monorepoDir), "packages", "pkg-alias"));

  // Run bun install
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(monorepoDir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not fail with workspace dependency errors
  expect(stderr).not.toContain("Workspace dependency");
  expect(stderr).not.toContain("not found");

  // Should succeed
  expect(exitCode).toBe(0);
});
