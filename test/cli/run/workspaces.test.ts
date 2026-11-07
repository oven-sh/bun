import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("bun run --workspaces", () => {
  test("runs script in all workspace packages", async () => {
    using dir = tempDir("workspaces-test", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        scripts: {
          test: "echo root test",
        },
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: {
          test: "echo package a test",
        },
      }),
      "packages/b/package.json": JSON.stringify({
        name: "b",
        scripts: {
          test: "echo package b test",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--workspaces", "test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // Packages run in parallel so output order is not deterministic; compare sorted lines.
    // The root package must not be included when using --workspaces, which the exact line set proves.
    expect(stdout.split("\n").filter(Boolean).sort()).toEqual([
      "a test: Exited with code 0",
      "a test: package a test",
      "b test: Exited with code 0",
      "b test: package b test",
    ]);
    expect(exitCode).toBe(0);
  });

  test("--if-present succeeds when script is missing", async () => {
    using dir = tempDir("workspaces-if-present", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: {
          test: "echo package a test",
        },
      }),
      "packages/b/package.json": JSON.stringify({
        name: "b",
        // No test script
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--workspaces", "--if-present", "test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("package a test");
    // Should not fail or emit anything for package b
    expect(stdout).not.toContain("b test:");
    expect(exitCode).toBe(0);
  });

  test("fails when no packages have the script", async () => {
    using dir = tempDir("workspaces-no-script", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
      }),
      "packages/b/package.json": JSON.stringify({
        name: "b",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--workspaces", "nonexistent"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr.trim()).toMatch(/^error: Script "nonexistent" not found in \d+ workspace packages$/);
    expect(exitCode).toBe(1);
  });

  test("errors once when there are no workspace packages", async () => {
    using dir = tempDir("ws-none", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { test: "echo root" } }),
    });
    for (const args of [["--workspaces"], ["--parallel", "--workspaces"]]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", ...args, "test"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      expect(stderr.trim()).toBe("error: No workspace packages found");
      expect(exitCode).toBe(1);
    }
  });
});
