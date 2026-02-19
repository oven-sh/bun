import { describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, stderrForInstall, tempDirWithFiles } from "harness";
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

    // Clone env to avoid mutating shared object
    const testEnv = { ...bunEnv };
    delete testEnv.BUN_INSTALL_CACHE_DIR;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      cwd: testDir,
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const out = (await proc.stdout.text()).trim();
    const err = stderrForInstall(await proc.stderr.text());

    expect(err).toBeEmpty();
    // Should NOT contain literal "~" - it should be expanded to the home directory
    expect(out).not.toContain("/~/");
    expect(out).not.toStartWith("~");
    // Should contain the home directory path
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    expect(out).toStartWith(homeDir!);
    expect(out).toEndWith(".bun-test-cache-dir");

    expect(await proc.exited).toBe(0);
  });

  test("bunfig.toml cache string expands tilde to home directory", async () => {
    const testDir = tempDirWithFiles("tilde-bunfig-str-", {
      "bunfig.toml": '[install]\ncache = "~/.bun-test-cache-dir"',
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    const testEnv = { ...bunEnv };
    delete testEnv.BUN_INSTALL_CACHE_DIR;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      cwd: testDir,
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const out = (await proc.stdout.text()).trim();
    const err = stderrForInstall(await proc.stderr.text());

    expect(err).toBeEmpty();
    expect(out).not.toContain("/~/");
    expect(out).not.toStartWith("~");
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    expect(out).toStartWith(homeDir!);
    expect(out).toEndWith(".bun-test-cache-dir");

    expect(await proc.exited).toBe(0);
  });

  test("bunfig.toml cache.dir expands tilde to home directory", async () => {
    const testDir = tempDirWithFiles("tilde-bunfig-dir-", {
      "bunfig.toml": '[install.cache]\ndir = "~/.bun-test-cache-dir"',
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    const testEnv = { ...bunEnv };
    delete testEnv.BUN_INSTALL_CACHE_DIR;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      cwd: testDir,
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const out = (await proc.stdout.text()).trim();
    const err = stderrForInstall(await proc.stderr.text());

    expect(err).toBeEmpty();
    expect(out).not.toContain("/~/");
    expect(out).not.toStartWith("~");
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    expect(out).toStartWith(homeDir!);
    expect(out).toEndWith(".bun-test-cache-dir");

    expect(await proc.exited).toBe(0);
  });

  test("paths without tilde are not affected", async () => {
    // Use a platform-independent absolute path within the test directory
    const testDir = tempDirWithFiles("no-tilde-", {
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });
    const absoluteCachePath = join(testDir, "absolute-cache-dir");
    // Write bunfig.toml with forward slashes (works on all platforms)
    const configPath = absoluteCachePath.replace(/\\/g, "/");
    await Bun.write(join(testDir, "bunfig.toml"), `[install]\ncache = "${configPath}"`);

    const testEnv = { ...bunEnv };
    delete testEnv.BUN_INSTALL_CACHE_DIR;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      cwd: testDir,
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const out = (await proc.stdout.text()).trim();
    const err = stderrForInstall(await proc.stderr.text());

    expect(err).toBeEmpty();
    // Normalize both paths to forward slashes for comparison
    expect(out.replace(/\\/g, "/")).toBe(configPath);

    expect(await proc.exited).toBe(0);
  });

  test("~username paths are not expanded (only ~ is expanded)", async () => {
    // ~username syntax (for other users' home dirs) should not be expanded
    // as it would require looking up user info
    const testDir = tempDirWithFiles("tilde-user-", {
      "bunfig.toml": '[install]\ncache = "~otheruser/cache"',
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    const testEnv = { ...bunEnv };
    delete testEnv.BUN_INSTALL_CACHE_DIR;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      cwd: testDir,
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const out = (await proc.stdout.text()).trim();
    const err = stderrForInstall(await proc.stderr.text());

    expect(err).toBeEmpty();
    // Should still contain ~otheruser since we don't expand that form
    expect(out).toContain("~otheruser");

    expect(await proc.exited).toBe(0);
  });
});
