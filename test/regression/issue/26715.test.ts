import { describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { bunExe, bunEnv as env, stderrForInstall, tempDirWithFiles } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/26715
// Bun should expand ~ (tilde) to the home directory in cache paths from .npmrc and bunfig.toml

describe("tilde expansion in cache paths", () => {
  test(".npmrc cache path expands tilde to home directory", async () => {
    const testDir = tempDirWithFiles("tilde-npmrc-", {
      ".npmrc": "cache=~/.bun-test-cache-dir",
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    // Remove any bunfig.toml that might override the .npmrc setting
    await rm(join(testDir, "bunfig.toml"), { force: true });

    const originalCacheDir = env.BUN_INSTALL_CACHE_DIR;
    delete env.BUN_INSTALL_CACHE_DIR;

    try {
      const { stdout, stderr, exited } = Bun.spawn({
        cmd: [bunExe(), "pm", "cache"],
        cwd: testDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const out = (await stdout.text()).trim();
      const err = stderrForInstall(await stderr.text());

      expect(err).toBeEmpty();
      // Should NOT contain literal "~" - it should be expanded to the home directory
      expect(out).not.toContain("/~/");
      expect(out).not.toStartWith("~");
      // Should contain the home directory path
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      expect(out).toStartWith(homeDir!);
      expect(out).toEndWith(".bun-test-cache-dir");

      expect(await exited).toBe(0);
    } finally {
      env.BUN_INSTALL_CACHE_DIR = originalCacheDir;
    }
  });

  test("bunfig.toml cache string expands tilde to home directory", async () => {
    const testDir = tempDirWithFiles("tilde-bunfig-str-", {
      "bunfig.toml": '[install]\ncache = "~/.bun-test-cache-dir"',
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    const originalCacheDir = env.BUN_INSTALL_CACHE_DIR;
    delete env.BUN_INSTALL_CACHE_DIR;

    try {
      const { stdout, stderr, exited } = Bun.spawn({
        cmd: [bunExe(), "pm", "cache"],
        cwd: testDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const out = (await stdout.text()).trim();
      const err = stderrForInstall(await stderr.text());

      expect(err).toBeEmpty();
      expect(out).not.toContain("/~/");
      expect(out).not.toStartWith("~");
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      expect(out).toStartWith(homeDir!);
      expect(out).toEndWith(".bun-test-cache-dir");

      expect(await exited).toBe(0);
    } finally {
      env.BUN_INSTALL_CACHE_DIR = originalCacheDir;
    }
  });

  test("bunfig.toml cache.dir expands tilde to home directory", async () => {
    const testDir = tempDirWithFiles("tilde-bunfig-dir-", {
      "bunfig.toml": '[install.cache]\ndir = "~/.bun-test-cache-dir"',
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    const originalCacheDir = env.BUN_INSTALL_CACHE_DIR;
    delete env.BUN_INSTALL_CACHE_DIR;

    try {
      const { stdout, stderr, exited } = Bun.spawn({
        cmd: [bunExe(), "pm", "cache"],
        cwd: testDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const out = (await stdout.text()).trim();
      const err = stderrForInstall(await stderr.text());

      expect(err).toBeEmpty();
      expect(out).not.toContain("/~/");
      expect(out).not.toStartWith("~");
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      expect(out).toStartWith(homeDir!);
      expect(out).toEndWith(".bun-test-cache-dir");

      expect(await exited).toBe(0);
    } finally {
      env.BUN_INSTALL_CACHE_DIR = originalCacheDir;
    }
  });

  test("paths without tilde are not affected", async () => {
    const testDir = tempDirWithFiles("no-tilde-", {
      "bunfig.toml": '[install]\ncache = "/tmp/absolute-cache-dir"',
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    const originalCacheDir = env.BUN_INSTALL_CACHE_DIR;
    delete env.BUN_INSTALL_CACHE_DIR;

    try {
      const { stdout, stderr, exited } = Bun.spawn({
        cmd: [bunExe(), "pm", "cache"],
        cwd: testDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const out = (await stdout.text()).trim();
      const err = stderrForInstall(await stderr.text());

      expect(err).toBeEmpty();
      expect(out).toBe("/tmp/absolute-cache-dir");

      expect(await exited).toBe(0);
    } finally {
      env.BUN_INSTALL_CACHE_DIR = originalCacheDir;
    }
  });

  test("~username paths are not expanded (only ~ is expanded)", async () => {
    // ~username syntax (for other users' home dirs) should not be expanded
    // as it would require looking up user info
    const testDir = tempDirWithFiles("tilde-user-", {
      "bunfig.toml": '[install]\ncache = "~otheruser/cache"',
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    const originalCacheDir = env.BUN_INSTALL_CACHE_DIR;
    delete env.BUN_INSTALL_CACHE_DIR;

    try {
      const { stdout, stderr, exited } = Bun.spawn({
        cmd: [bunExe(), "pm", "cache"],
        cwd: testDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const out = (await stdout.text()).trim();
      const err = stderrForInstall(await stderr.text());

      expect(err).toBeEmpty();
      // Should still contain ~otheruser since we don't expand that form
      expect(out).toContain("~otheruser");

      expect(await exited).toBe(0);
    } finally {
      env.BUN_INSTALL_CACHE_DIR = originalCacheDir;
    }
  });
});
