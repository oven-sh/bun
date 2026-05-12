import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/25202
// `bun i ../dir1` where dir1/package.json contains a `workspace:.` dependency
// used to hang forever. The `workspace:.` dependency resolves (via
// FolderResolution abs-path reuse) to the same package id as `../dir1`
// itself, and the tree builder's `.folder` fast-path would re-enqueue it
// without cycle detection.

test("bun add of a folder whose package.json has a `workspace:.` self-reference does not hang", async () => {
  using dir = tempDir("issue-25202-self", {
    "dir1/package.json": JSON.stringify({
      name: "test",
      version: "1.0.0",
      devDependencies: {
        foo: "workspace:.",
      },
    }),
    "dir2/.gitkeep": "",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted", "../dir1"],
    env: bunEnv,
    cwd: join(String(dir), "dir2"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Saved lockfile");
  expect(stdout).toContain("installed test@");
  expect(exitCode).toBe(0);

  const lock = await Bun.file(join(String(dir), "dir2", "bun.lock")).text();
  expect(lock).toContain('"test": ["test@file:../dir1"');
});

test("bun install with two folder deps whose `workspace:` deps form a cycle does not hang", async () => {
  using dir = tempDir("issue-25202-cycle", {
    "pkg/package.json": JSON.stringify({
      name: "pkg",
      version: "1.0.0",
      dependencies: {
        other: "workspace:../pkg2",
      },
    }),
    "pkg2/package.json": JSON.stringify({
      name: "pkg2",
      version: "1.0.0",
      dependencies: {
        back: "workspace:../pkg",
      },
    }),
    "app/package.json": JSON.stringify({
      name: "app",
      dependencies: {
        a: "file:../pkg",
        b: "file:../pkg2",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    env: bunEnv,
    cwd: join(String(dir), "app"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Saved lockfile");
  expect(stdout).toContain("+ a@");
  expect(stdout).toContain("+ b@");
  expect(exitCode).toBe(0);
});

test("bun add of a folder with `workspace:.` self-reference (isolated linker) does not hang", async () => {
  using dir = tempDir("issue-25202-isolated", {
    "dir1/package.json": JSON.stringify({
      name: "test",
      version: "1.0.0",
      devDependencies: {
        foo: "workspace:.",
      },
    }),
    "dir2/.gitkeep": "",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=isolated", "../dir1"],
    env: bunEnv,
    cwd: join(String(dir), "dir2"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Saved lockfile");
  expect(stdout).toContain("installed test@");
  expect(exitCode).toBe(0);
});
