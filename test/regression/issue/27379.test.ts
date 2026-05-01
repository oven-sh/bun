import { spawn } from "bun";
import { beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
import { readdirSync } from "node:fs";
import { tmpdir } from "os";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/27379
// `bunx github:user/repo#HEAD` should not use the cache (should always re-fetch).

let x_dir: string;
let current_tmpdir: string;
let install_cache_dir: string;
let env = { ...bunEnv };

setDefaultTimeout(1000 * 60 * 5);

beforeEach(async () => {
  const waiting: Promise<void>[] = [];
  if (current_tmpdir) {
    waiting.push(rm(current_tmpdir, { recursive: true, force: true }));
  }

  if (install_cache_dir) {
    waiting.push(rm(install_cache_dir, { recursive: true, force: true }));
  }

  const tmp = isWindows ? tmpdir() : "/tmp";
  readdirSync(tmp).forEach(file => {
    if (file.startsWith("bunx-") || file.startsWith("bun-x.test")) {
      waiting.push(rm(join(tmp, file), { recursive: true, force: true }));
    }
  });

  install_cache_dir = tmpdirSync();
  current_tmpdir = tmpdirSync();
  x_dir = tmpdirSync();

  env.TEMP = current_tmpdir;
  env.BUN_TMPDIR = env.TMPDIR = current_tmpdir;
  env.TMPDIR = current_tmpdir;
  env.BUN_INSTALL_CACHE_DIR = install_cache_dir;

  await Promise.all(waiting);
});

it("bunx github:user/repo#HEAD should not use cached version", async () => {
  // First run: install from GitHub
  const firstRun = spawn({
    cmd: [bunExe(), "x", "github:piuccio/cowsay#HEAD", "hello bun!"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const [err1, out1, exited1] = await Promise.all([
    new Response(firstRun.stderr).text(),
    new Response(firstRun.stdout).text(),
    firstRun.exited,
  ]);

  expect(err1).not.toContain("error:");
  expect(out1.trim()).toContain("hello bun!");
  expect(exited1).toBe(0);

  // Second run with --no-install should fail because #HEAD bypasses cache
  // (similar to how @latest works for npm packages)
  const secondRun = spawn({
    cmd: [bunExe(), "x", "--no-install", "github:piuccio/cowsay#HEAD", "hello bun!"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const [_err2, _out2, exited2] = await Promise.all([
    new Response(secondRun.stderr).text(),
    new Response(secondRun.stdout).text(),
    secondRun.exited,
  ]);

  // #HEAD should always trigger a fresh install, so --no-install should fail
  expect(exited2).toBe(1);
});
