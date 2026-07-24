// Syscall errors that bubble to the top-level CLI error handler should include
// the failing path and syscall instead of a bare errno name or the placeholder
// "Bun could not find a file, and the code that produces this error is missing
// a better error." (https://github.com/oven-sh/bun/issues/10743)

import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

test.concurrent(
  "bun install -g with BUN_INSTALL_GLOBAL_DIR under a file reports the path",
  async () => {
    using dir = tempDir("enoent-globaldir", {
      "not-a-dir": "this is a regular file",
      "package.json": JSON.stringify({ name: "x", version: "0.0.0" }),
    });
    const globalDir = path.join(String(dir), "not-a-dir", "global");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "add", "-g", "left-pad"],
      env: {
        ...bunEnv,
        BUN_INSTALL_GLOBAL_DIR: globalDir,
        NO_COLOR: "1",
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    const out = stdout + stderr;
    // The error must name the offending path and must not be the bare "internal
    // error" fallback or the placeholder text.
    expect(out).toContain(globalDir);
    expect(out).toMatch(/ENOTDIR|ENOENT/);
    expect(out).not.toContain("missing a better error");
    expect(out).not.toContain("An internal error occurred");
    expect(exitCode).toBe(1);
  },
);

test.concurrent("bun x with BUN_TMPDIR under a file reports the path", async () => {
  using dir = tempDir("enoent-bunx", {
    "not-a-dir": "this is a regular file",
  });
  const tmpdir = path.join(String(dir), "not-a-dir", "tmp");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "x", "cowsay", "hi"],
    env: {
      ...bunEnv,
      BUN_TMPDIR: tmpdir,
      TMPDIR: tmpdir,
      TEMP: tmpdir,
      TMP: tmpdir,
      NO_COLOR: "1",
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  const out = stdout + stderr;
  expect(out).toContain("not-a-dir");
  expect(out).toMatch(/ENOTDIR|ENOENT/);
  expect(out).not.toContain("missing a better error");
  expect(out).not.toContain("An internal error occurred");
  expect(exitCode).not.toBe(0);
});
