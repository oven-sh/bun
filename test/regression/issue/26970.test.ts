import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("missing literal workspace path should not error", () => {
  using dir = tempDir("issue-26970", {
    "package.json": JSON.stringify({
      name: "test",
      workspaces: ["terraform"],
    }),
  });

  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  expect(text).not.toContain("Workspace not found");
  expect(exitCode).toBe(0);
});

test("missing glob workspace pattern should not error", () => {
  using dir = tempDir("issue-26970", {
    "package.json": JSON.stringify({
      name: "test",
      workspaces: ["terraform*"],
    }),
  });

  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  expect(text).not.toContain("Workspace not found");
  expect(exitCode).toBe(0);
});

test("literal and glob missing workspaces behave the same", () => {
  using literalDir = tempDir("issue-26970", {
    "package.json": JSON.stringify({
      name: "test",
      workspaces: ["nonexistent"],
    }),
  });

  const literalResult = spawnSync({
    cmd: [bunExe(), "install"],
    cwd: String(literalDir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  using globDir = tempDir("issue-26970", {
    "package.json": JSON.stringify({
      name: "test",
      workspaces: ["nonexistent*"],
    }),
  });

  const globResult = spawnSync({
    cmd: [bunExe(), "install"],
    cwd: String(globDir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Both should succeed with exit code 0
  expect(literalResult.exitCode).toBe(0);
  expect(globResult.exitCode).toBe(0);
});
