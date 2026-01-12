// https://github.com/oven-sh/bun/issues/25930
// bun --config <path> (space-separated) silently does nothing and exits 0
// only --config=<path> works

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("--config flag should work with space-separated value", () => {
  test("--config bunfig.toml -e (space-separated)", async () => {
    using dir = tempDir("config-test", {
      "bunfig.toml": "[install]\ncache = false",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--config", "bunfig.toml", "-e", "console.log('hello')"],
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

    expect(stdout.trim()).toBe("hello");
    expect(exitCode).toBe(0);
  });

  test("--config=bunfig.toml -e (equals form)", async () => {
    using dir = tempDir("config-test", {
      "bunfig.toml": "[install]\ncache = false",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--config=bunfig.toml", "-e", "console.log('hello')"],
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

    expect(stdout.trim()).toBe("hello");
    expect(exitCode).toBe(0);
  });

  test("-c bunfig.toml -e (short form, space-separated)", async () => {
    using dir = tempDir("config-test", {
      "bunfig.toml": "[install]\ncache = false",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-c", "bunfig.toml", "-e", "console.log('hello')"],
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

    expect(stdout.trim()).toBe("hello");
    expect(exitCode).toBe(0);
  });

  test("-c=bunfig.toml -e (short form, equals)", async () => {
    using dir = tempDir("config-test", {
      "bunfig.toml": "[install]\ncache = false",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-c=bunfig.toml", "-e", "console.log('hello')"],
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

    expect(stdout.trim()).toBe("hello");
    expect(exitCode).toBe(0);
  });

  test("bun run --config bunfig.toml (space-separated)", async () => {
    using dir = tempDir("config-test", {
      "bunfig.toml": "[install]\ncache = false",
      "package.json": JSON.stringify({ scripts: { test: "echo hello" } }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--config", "bunfig.toml", "test"],
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

    expect(stdout).toContain("hello");
    expect(exitCode).toBe(0);
  });

  test("--config without value should use default bunfig.toml", async () => {
    using dir = tempDir("config-test", {
      "bunfig.toml": "[install]\ncache = false",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--config", "-e", "console.log('hello')"],
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

    // When --config is followed by -e (starts with -), it should not consume -e
    // and should use default bunfig.toml instead
    expect(stdout.trim()).toBe("hello");
    expect(exitCode).toBe(0);
  });
});
