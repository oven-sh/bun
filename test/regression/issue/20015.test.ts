import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, stderrForInstall, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/20015
// `bun link <package>` from a workspace member with `catalog:` dependencies
// should resolve catalogs from the workspace root, not fail with "failed to resolve".
test("bun link resolves catalog: dependencies in workspace member", async () => {
  using dir = tempDir("issue-20015", {
    "package.json": JSON.stringify({
      name: "my-workspace-root",
      workspaces: {
        packages: ["packages/*"],
        catalog: {
          "is-number": "7.0.0",
        },
      },
    }),
    "packages/api/package.json": JSON.stringify({
      name: "api",
      version: "1.0.0",
      devDependencies: {
        "is-number": "catalog:",
      },
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
    }),
  });

  // First, run `bun install` from root to set up the workspace
  {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const stderr = stderrForInstall(await proc.stderr.text());
    const stdout = await proc.stdout.text();
    expect(stderr).not.toContain("error");
    expect(await proc.exited).toBe(0);
  }

  // Register the "lib" package globally with `bun link` (no args)
  {
    await using proc = spawn({
      cmd: [bunExe(), "link"],
      cwd: join(String(dir), "packages", "lib"),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const stdout = await proc.stdout.text();
    const stderr = stderrForInstall(await proc.stderr.text());
    expect(stdout).toContain(`Success! Registered "lib"`);
    expect(await proc.exited).toBe(0);
  }

  // Link the "lib" package into the "api" workspace member
  // This previously failed with: error: is-number@catalog: failed to resolve
  {
    await using proc = spawn({
      cmd: [bunExe(), "link", "lib"],
      cwd: join(String(dir), "packages", "api"),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    expect(stderr).not.toContain("failed to resolve");
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("installed lib");
    expect(await proc.exited).toBe(0);
  }
});

// Verify that `bun link` (no args) from a workspace member still registers
// the member package (not the workspace root).
test("bun link (no args) from workspace member registers member, not root", async () => {
  using dir = tempDir("issue-20015-noargs", {
    "package.json": JSON.stringify({
      name: "my-root",
      workspaces: ["packages/*"],
    }),
    "packages/member/package.json": JSON.stringify({
      name: "member-pkg",
      version: "1.0.0",
    }),
  });

  // Run install first
  {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(await proc.exited).toBe(0);
  }

  // Run `bun link` from the workspace member directory
  {
    await using proc = spawn({
      cmd: [bunExe(), "link"],
      cwd: join(String(dir), "packages", "member"),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const stdout = await proc.stdout.text();
    // Should register "member-pkg", not "my-root"
    expect(stdout).toContain(`Success! Registered "member-pkg"`);
    expect(stdout).not.toContain("my-root");
    expect(await proc.exited).toBe(0);
  }
});
