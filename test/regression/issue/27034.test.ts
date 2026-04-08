import { spawn } from "bun";
import { beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
import { readdirSync } from "node:fs";
import { tmpdir } from "os";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/27034
// bunx should support multiple -p/--package flags and the -c/--call flag

let x_dir: string;
let current_tmpdir: string;
let install_cache_dir: string;
let env = { ...bunEnv };

beforeEach(async () => {
  setDefaultTimeout(1000 * 60 * 5);
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

describe("bunx --call / -c flag", () => {
  it("should error when --call is provided without --package", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "x", "-c", "echo hello"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [stderr, stdout, exited] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    expect(stderr).toContain("--call requires at least one --package flag");
    expect(exited).toBe(1);
  });

  it("should error when --call is provided without a command string", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "x", "--call"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [stderr, stdout, exited] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    expect(stderr).toContain("--call requires a command string");
    expect(exited).toBe(1);
  });

  it("should run a shell command with -p and -c flags", async () => {
    // Use a simple command that doesn't require installing anything real
    // We just verify the flags are parsed correctly and the shell runs
    await using proc = spawn({
      cmd: [bunExe(), "x", "-p", "is-number", "-c", "echo bunx-call-works"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [stderr, stdout, exited] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("bunx-call-works");
    expect(exited).toBe(0);
  });

  it("should support --call=<command> syntax", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "x", "-p", "is-number", "--call=echo call-equals-works"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [stderr, stdout, exited] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("call-equals-works");
    expect(exited).toBe(0);
  });
});

describe("bunx multiple --package flags", () => {
  it("should support multiple -p flags and install all packages", async () => {
    // Test with two small packages and a call command that uses echo
    await using proc = spawn({
      cmd: [bunExe(), "x", "-p", "is-number", "-p", "is-odd", "-c", "echo multi-pkg-works"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [stderr, stdout, exited] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("multi-pkg-works");
    expect(exited).toBe(0);
  });
});
