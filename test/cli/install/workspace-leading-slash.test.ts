import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun install works with leading slash in workspace pattern", async () => {
  using dir = tempDir("ws-leading-slash", {
    "packages/foo/package.json": JSON.stringify({
      name: "foo",
      version: "1.0.0",
    }),
    "package.json": JSON.stringify({
      name: "leading-slash-test",
      private: true,
      workspaces: ["/packages/*"],
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("ENOENT");
  expect(exitCode).toBe(0);
});

test("bun run --filter works with leading slash in workspace pattern", async () => {
  using dir = tempDir("ws-leading-slash-filter", {
    "packages/bar/package.json": JSON.stringify({
      name: "bar",
      version: "1.0.0",
      scripts: {
        build: "echo building bar",
      },
    }),
    "package.json": JSON.stringify({
      name: "leading-slash-filter-test",
      private: true,
      workspaces: ["/packages/*"],
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--filter", "*", "build"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("ENOENT");
  expect(stdout).toContain("building bar");
  expect(exitCode).toBe(0);
});

test("bun install works with multiple leading slashes in workspace pattern", async () => {
  using dir = tempDir("ws-multi-slash", {
    "packages/baz/package.json": JSON.stringify({
      name: "baz",
      version: "1.0.0",
    }),
    "package.json": JSON.stringify({
      name: "multi-slash-test",
      private: true,
      workspaces: ["///packages/*"],
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("ENOENT");
  expect(exitCode).toBe(0);
});

test("normal workspace patterns still work (regression check)", async () => {
  using dir = tempDir("ws-normal", {
    "packages/pkg/package.json": JSON.stringify({
      name: "pkg",
      version: "1.0.0",
      scripts: {
        test: "echo testing pkg",
      },
    }),
    "package.json": JSON.stringify({
      name: "normal-test",
      private: true,
      workspaces: ["packages/*"],
    }),
  });

  // Test install
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Test filter
  await using filterProc = Bun.spawn({
    cmd: [bunExe(), "run", "--filter", "*", "test"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [filterStdout, filterStderr, filterExitCode] = await Promise.all([
    new Response(filterProc.stdout).text(),
    new Response(filterProc.stderr).text(),
    filterProc.exited,
  ]);

  expect(filterStderr).not.toContain("ENOENT");
  expect(filterStdout).toContain("testing pkg");
  expect(filterExitCode).toBe(0);
});
