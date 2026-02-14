import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { chmodSync } from "node:fs";

test("bun publish should work with read-only package.json", async () => {
  const dir = tempDirWithFiles("publish-readonly-test", {
    "package.json": JSON.stringify({
      name: "test-package",
      version: "1.0.0",
      description: "Test package for read-only package.json",
      main: "index.js",
      private: true, // Make it private to prevent accidental publishing
    }),
    "index.js": `module.exports = { hello: "world" };`,
    "README.md": "# Test Package\n\nThis is a test package.",
  });

  const packageJsonPath = `${dir}/package.json`;

  // Make package.json read-only
  chmodSync(packageJsonPath, 0o444); // read-only for owner, group, and others

  try {
    // Run bun publish with --dry-run to avoid actually publishing
    await using proc = Bun.spawn({
      cmd: [bunExe(), "publish", "--dry-run"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // The command should succeed (exit code 0) even with read-only package.json
    expect(exitCode).toBe(0);

    // Should not contain the error message about package.json needing to be writable
    expect(stderr).not.toContain("package.json must be writable");
    expect(stderr).not.toContain("Permission denied");

    // Should show the dry-run output
    expect(stdout).toContain("test-package@1.0.0");
    expect(stdout).toContain("(dry-run)");
  } finally {
    // Restore write permissions for cleanup
    chmodSync(packageJsonPath, 0o644);
  }
});

test("bun pack should work with read-only package.json", async () => {
  const dir = tempDirWithFiles("pack-readonly-test", {
    "package.json": JSON.stringify({
      name: "test-package-pack",
      version: "1.0.0",
      description: "Test package for read-only package.json with pack",
      main: "index.js",
    }),
    "index.js": `module.exports = { hello: "world" };`,
    "README.md": "# Test Package\n\nThis is a test package.",
  });

  const packageJsonPath = `${dir}/package.json`;

  // Make package.json read-only
  chmodSync(packageJsonPath, 0o444); // read-only for owner, group, and others

  try {
    // Run bun pack with --dry-run to avoid creating actual tarball
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "pack", "--dry-run"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // The command should succeed (exit code 0) even with read-only package.json
    expect(exitCode).toBe(0);

    // Should not contain the error message about package.json needing to be writable
    expect(stderr).not.toContain("package.json must be writable");
    expect(stderr).not.toContain("Permission denied");

    // Should show the pack output
    expect(stdout).toContain("test-package-pack-1.0.0.tgz");
  } finally {
    // Restore write permissions for cleanup
    chmodSync(packageJsonPath, 0o644);
  }
});

test("bun install with packages should still require writable package.json", async () => {
  const dir = tempDirWithFiles("install-readonly-test", {
    "package.json": JSON.stringify({
      name: "test-package-install",
      version: "1.0.0",
      dependencies: {},
    }),
  });

  const packageJsonPath = `${dir}/package.json`;

  // Make package.json read-only
  chmodSync(packageJsonPath, 0o444); // read-only for owner, group, and others

  try {
    // Run bun install with a package (which should require write access)
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "lodash"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // The command should fail because it needs to write to package.json
    expect(exitCode).not.toBe(0);

    // Should contain the error message about package.json needing to be writable
    expect(stderr).toContain("package.json must be writable");
  } finally {
    // Restore write permissions for cleanup
    chmodSync(packageJsonPath, 0o644);
  }
});
