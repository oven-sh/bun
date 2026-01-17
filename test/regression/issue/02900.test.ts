import { expect, test } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/2900
// process.argv[1] should preserve the symlink path, not resolve to the real path
test("process.argv[1] preserves symlink path", async () => {
  using dir = tempDir("issue-2900", {
    "foo.mjs": "console.log(process.argv[1]);",
  });

  // Create symlink bar.mjs -> foo.mjs
  const fooPath = join(String(dir), "foo.mjs");
  const barPath = join(String(dir), "bar.mjs");
  try {
    symlinkSync(fooPath, barPath);
  } catch (e: any) {
    if (process.platform === "win32") {
      console.log("symlinkSync failed on Windows, skipping test:", e.message);
      return;
    }
    throw e;
  }

  // Run through symlink
  await using proc = Bun.spawn({
    cmd: [bunExe(), barPath],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // process.argv[1] should be the symlink path, not the resolved path
  expect(stdout.trim()).toBe(barPath);
  expect(exitCode).toBe(0);
});

test("process.argv[1] preserves relative symlink path (resolved to absolute)", async () => {
  using dir = tempDir("issue-2900-rel", {
    "foo.mjs": "console.log(process.argv[1]);",
  });

  // Create relative symlink bar.mjs -> foo.mjs
  const barPath = join(String(dir), "bar.mjs");
  try {
    symlinkSync("foo.mjs", barPath);
  } catch (e: any) {
    if (process.platform === "win32") {
      console.log("symlinkSync failed on Windows, skipping test:", e.message);
      return;
    }
    throw e;
  }

  // Run through symlink
  await using proc = Bun.spawn({
    cmd: [bunExe(), "bar.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // process.argv[1] should be the absolute symlink path
  expect(stdout.trim()).toBe(barPath);
  expect(exitCode).toBe(0);
});

test("process.argv[1] works correctly for non-symlink files", async () => {
  using dir = tempDir("issue-2900-nosym", {
    "foo.mjs": "console.log(process.argv[1]);",
  });

  const fooPath = join(String(dir), "foo.mjs");

  await using proc = Bun.spawn({
    cmd: [bunExe(), fooPath],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(fooPath);
  expect(exitCode).toBe(0);
});
