// https://github.com/oven-sh/bun/issues/25766
// Tilde expansion (~) should work in bunfig.toml path settings
//
// When users specify paths like `globalBinDir = "~/.bun/bin"` in their bunfig.toml,
// Bun should expand the `~` to $HOME. Without the fix, it creates a literal folder named `~`.

import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("bunfig.toml tilde expansion", () => {
  test("globalBinDir with tilde expands to home directory", async () => {
    // Create a fake home directory and a bunfig that uses tilde for globalBinDir
    using dir = tempDir("issue-25766-bin", {
      "fake-home/.bun/bin/.gitkeep": "",
      "package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]
globalBinDir = "~/.bun/bin"
`,
    });

    const fakeHome = join(String(dir), "fake-home");

    // Use `bun link` which triggers the openGlobalBinDir and openGlobalDir code paths
    await using proc = Bun.spawn({
      cmd: [bunExe(), "link"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HOME: fakeHome,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read output before awaiting exited for better error messages
    const [_stdout, _stderr, _exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // The key assertion: a literal "~" directory should NOT be created in cwd
    // If the bug exists, it would create a directory literally named "~"
    const literalTildeDir = join(String(dir), "~");
    expect(existsSync(literalTildeDir)).toBe(false);

    // Positive assertion: the expanded path under fake home should be used
    const expandedBinDir = join(fakeHome, ".bun", "bin");
    expect(existsSync(expandedBinDir)).toBe(true);
  });

  test("globalDir with tilde expands to home directory", async () => {
    using dir = tempDir("issue-25766-global", {
      "fake-home/.bun/install/global/.gitkeep": "",
      "package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]
globalDir = "~/.bun/install/global"
`,
    });

    const fakeHome = join(String(dir), "fake-home");

    // Use `bun link` which triggers the openGlobalDir code path
    await using proc = Bun.spawn({
      cmd: [bunExe(), "link"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HOME: fakeHome,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read output before awaiting exited for better error messages
    const [_stdout, _stderr, _exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // No literal "~" directory should be created
    const literalTildeDir = join(String(dir), "~");
    expect(existsSync(literalTildeDir)).toBe(false);

    // Positive assertion: the expanded path under fake home should be used
    const expandedGlobalDir = join(fakeHome, ".bun", "install", "global");
    expect(existsSync(expandedGlobalDir)).toBe(true);
  });

  test("cache.dir with tilde expands to home directory", async () => {
    using dir = tempDir("issue-25766-cache", {
      "fake-home/.bun/install/cache/.gitkeep": "",
      "package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install.cache]
dir = "~/.bun/install/cache"
`,
    });

    const fakeHome = join(String(dir), "fake-home");

    // Regular install should trigger cache directory access
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HOME: fakeHome,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read output before awaiting exited for better error messages
    const [_stdout, _stderr, _exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // No literal "~" directory should be created
    const literalTildeDir = join(String(dir), "~");
    expect(existsSync(literalTildeDir)).toBe(false);

    // Positive assertion: the expanded path under fake home should be used
    const expandedCacheDir = join(fakeHome, ".bun", "install", "cache");
    expect(existsSync(expandedCacheDir)).toBe(true);
  });

  test("cache shorthand with tilde expands to home directory", async () => {
    using dir = tempDir("issue-25766-cache-short", {
      "fake-home/.bun/install/cache/.gitkeep": "",
      "package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]
cache = "~/.bun/install/cache"
`,
    });

    const fakeHome = join(String(dir), "fake-home");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HOME: fakeHome,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read output before awaiting exited for better error messages
    const [_stdout, _stderr, _exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // No literal "~" directory should be created
    const literalTildeDir = join(String(dir), "~");
    expect(existsSync(literalTildeDir)).toBe(false);

    // Positive assertion: the expanded path under fake home should be used
    const expandedCacheDir = join(fakeHome, ".bun", "install", "cache");
    expect(existsSync(expandedCacheDir)).toBe(true);
  });
});
