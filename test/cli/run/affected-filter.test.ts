import { spawnSync } from "bun";
import { describe, expect, test, beforeAll } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";

function git(cwd: string, ...args: string[]) {
  execSync(`git ${args.join(" ")}`, { cwd, stdio: "pipe" });
}

function setupGitWorkspace() {
  const cwd = tempDirWithFiles("affected-test", {
    packages: {
      "pkg-a": {
        "index.ts": "export const a = 1;",
        "package.json": JSON.stringify({
          name: "pkg-a",
          scripts: { test: "echo test-a" },
        }),
      },
      "pkg-b": {
        "index.ts": "export const b = 1;",
        "package.json": JSON.stringify({
          name: "pkg-b",
          scripts: { test: "echo test-b" },
          dependencies: { "pkg-a": "workspace:*" },
        }),
      },
      "pkg-c": {
        "index.ts": "export const c = 1;",
        "package.json": JSON.stringify({
          name: "pkg-c",
          scripts: { test: "echo test-c" },
        }),
      },
    },
    "package.json": JSON.stringify({
      name: "ws-root",
      workspaces: ["packages/*"],
    }),
  });

  // Initialize git repo with a baseline commit
  git(cwd, "init");
  git(cwd, "config", "user.name", "Bun Test");
  git(cwd, "config", "user.email", "test@bun.sh");
  git(cwd, "add", "-A");
  git(cwd, 'commit', '-m', '"initial"');
  git(cwd, "branch", "-M", "main");

  return cwd;
}

describe("bun run --affected", () => {
  test("runs only scripts in packages with changed files", () => {
    const cwd = setupGitWorkspace();

    // Modify only pkg-a
    writeFileSync(join(cwd, "packages/pkg-a/index.ts"), "export const a = 2;");

    const result = spawnSync({
      cmd: [bunExe(), "run", "--affected", "test"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();
    const output = stdout + stderr;

    // pkg-a is directly changed
    expect(output).toContain("pkg-a");
    // pkg-b depends on pkg-a, so it should be affected transitively
    expect(output).toContain("pkg-b");
    // pkg-c has no changes and no dependency on pkg-a
    expect(output).not.toContain("pkg-c");
    expect(result.exitCode).toBe(0);
  });

  test("exits with 0 when no packages are affected", () => {
    const cwd = setupGitWorkspace();

    // No changes — everything is committed
    const result = spawnSync({
      cmd: [bunExe(), "run", "--affected", "test"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
  });

  test("--list prints affected package names without running", () => {
    const cwd = setupGitWorkspace();

    // Modify pkg-c only
    writeFileSync(join(cwd, "packages/pkg-c/index.ts"), "export const c = 2;");

    const result = spawnSync({
      cmd: [bunExe(), "run", "--affected", "--list", "test"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    expect(stdout).toContain("pkg-c");
    expect(stdout).not.toContain("pkg-a");
    expect(stdout).not.toContain("pkg-b");
    expect(result.exitCode).toBe(0);
  });

  test("global file change marks all packages as affected", () => {
    const cwd = setupGitWorkspace();

    // Modify root package.json (global file)
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "ws-root",
        workspaces: ["packages/*"],
        version: "2.0.0",
      }),
    );

    const result = spawnSync({
      cmd: [bunExe(), "run", "--affected", "--list", "test"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    expect(stdout).toContain("pkg-a");
    expect(stdout).toContain("pkg-b");
    expect(stdout).toContain("pkg-c");
    expect(result.exitCode).toBe(0);
  });

  test("--affected and --filter cannot be used together", () => {
    const cwd = setupGitWorkspace();

    const result = spawnSync({
      cmd: [bunExe(), "run", "--affected", "--filter", "pkg-a", "test"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("--affected and --filter cannot be used together");
  });

  test("--list requires --affected", () => {
    const cwd = setupGitWorkspace();

    const result = spawnSync({
      cmd: [bunExe(), "run", "--list", "test"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("--list requires --affected");
  });

  test("custom --base ref", () => {
    const cwd = setupGitWorkspace();

    // Create a new commit modifying pkg-a
    writeFileSync(join(cwd, "packages/pkg-a/index.ts"), "export const a = 2;");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-m", '"change-a"');

    // Create another commit modifying pkg-c
    writeFileSync(join(cwd, "packages/pkg-c/index.ts"), "export const c = 2;");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-m", '"change-c"');

    // Using HEAD~1 as base should only show pkg-c (changed in the last commit)
    const result = spawnSync({
      cmd: [bunExe(), "run", "--affected", "--base", "HEAD~1", "--list", "test"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    expect(stdout).toContain("pkg-c");
    // pkg-a was changed before HEAD~1, so should not be affected
    expect(stdout).not.toContain("pkg-a");
    expect(result.exitCode).toBe(0);
  });
});
