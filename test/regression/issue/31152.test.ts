// https://github.com/oven-sh/bun/issues/31152
//
// `bun --cwd=<relative-dir> update [-i]` double-chdir'd into the target
// directory because `UpdateCommand` parsed `--cwd` once itself and then
// re-entered a helper that parsed `--cwd` again — the second relative
// `chdir` ran from inside the already-resolved dir and hit ENOENT.
import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("bun --cwd=<relative> update succeeds in a workspace child", async () => {
  using dir = tempDir("issue-31152-update", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["apps/*"],
    }),
    "apps/web/package.json": JSON.stringify({
      name: "web",
      version: "1.0.0",
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--cwd=apps/web", "update"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("failed to change directory");
  expect(stderr).not.toContain("ENOENT");
  expect(exitCode).toBe(0);
});

test.concurrent("bun --cwd=<relative> update -i succeeds in a workspace child", async () => {
  using dir = tempDir("issue-31152-update-i", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["apps/*"],
    }),
    "apps/web/package.json": JSON.stringify({
      name: "web",
      version: "1.0.0",
    }),
  });

  // `update -i` needs a lockfile, otherwise it crashes with "missing
  // lockfile" regardless of the cwd bug. Generate one first with a normal
  // install — zero deps, no network.
  await using install = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await install.exited).toBe(0);

  // No deps to update → the interactive command prints "All packages are up
  // to date!" and exits without ever entering the prompt. That's enough to
  // exercise the double-parse path; we don't need a TTY or npm traffic.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--cwd=apps/web", "update", "-i"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("failed to change directory");
  expect(stderr).not.toContain("ENOENT");
  expect(exitCode).toBe(0);
});
