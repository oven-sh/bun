import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("bun run --workspaces runs script in all workspace packages", async () => {
  const dir = tempDirWithFiles("workspaces-test", {
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--workspaces", "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("package a test");
  expect(stdout).toContain("package b test");
  // Root should not be included when using --workspaces
  expect(stdout).not.toContain("root test");
});

test("bun run --workspaces --if-present succeeds when script is missing", async () => {
  const dir = tempDirWithFiles("workspaces-if-present", {
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--workspaces", "--if-present", "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("package a test");
  // Should not fail for package b
});

test("bun run --workspaces fails when no packages have the script", async () => {
  const dir = tempDirWithFiles("workspaces-no-script", {
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--workspaces", "nonexistent"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("No workspace packages have script");
});
