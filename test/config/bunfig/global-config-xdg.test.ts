// Regression coverage for oven-sh/bun#30842: global `bunfig.toml` lookup must
// follow the XDG Base Directory Specification — the XDG-conventional
// `$XDG_CONFIG_HOME/bun/bunfig.toml` path, the spec default of
// `$HOME/.config` when `$XDG_CONFIG_HOME` is unset, and back-compat for the
// previously documented `$XDG_CONFIG_HOME/.bunfig.toml`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Observe global-bunfig loading via `[install.cache] dir = "<sentinel>"` and
// reading back the effective cache path with `bun pm cache`. Global config
// is read by install-related commands (`read_global_config()`) — `bun pm
// cache` qualifies, and it exits 0 without touching the network.

async function runPmCache(appDir: string, env: Record<string, string | undefined>) {
  // Strip any inherited env that could mask the bunfig under test, then
  // layer per-test values. An `undefined` value means "explicitly absent".
  //
  // - `BUN_INSTALL_CACHE_DIR` is set by the Buildkite runner
  //   (scripts/runner.node.mjs) and takes precedence over bunfig's
  //   `[install.cache].dir` in `fetch_cache_directory_path()`; drop it so
  //   our sentinel wins.
  // - `BUN_INSTALL` / `XDG_CACHE_HOME` are checked after the bunfig option
  //   but we strip them defensively so the test signal is unambiguous.
  // - `env_var::HOME` reads `USERPROFILE` on Windows (env_var.rs:138), so
  //   when a test passes `HOME`, mirror it into `USERPROFILE` so the
  //   spawned bun sees the same value on both platforms. `XDG_CONFIG_HOME`
  //   is honoured on Windows too (env_var.rs:177–180), so no special-casing
  //   is needed there.
  const spawnEnv: Record<string, string> = { ...bunEnv };
  delete spawnEnv.HOME;
  delete spawnEnv.XDG_CONFIG_HOME;
  delete spawnEnv.USERPROFILE;
  delete spawnEnv.BUN_INSTALL_CACHE_DIR;
  delete spawnEnv.BUN_INSTALL;
  delete spawnEnv.XDG_CACHE_HOME;
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) spawnEnv[k] = v;
  }
  if (spawnEnv.HOME !== undefined && spawnEnv.USERPROFILE === undefined) {
    spawnEnv.USERPROFILE = spawnEnv.HOME;
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "cache"],
    cwd: appDir,
    env: spawnEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

function writeBunfigCacheDir(path: string, cacheDir: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `[install.cache]\ndir = ${JSON.stringify(cacheDir)}\n`);
}

describe.concurrent("global bunfig.toml XDG path lookup", () => {
  test("loads $XDG_CONFIG_HOME/bun/bunfig.toml (XDG-conventional)", async () => {
    using home = tempDir("bunfig-xdg-conventional", { "app/package.json": "{}" });
    const homeStr = String(home);
    const cacheDir = join(homeStr, "xdg-conventional-cache");
    writeBunfigCacheDir(join(homeStr, ".config/bun/bunfig.toml"), cacheDir);

    const { stdout, stderr, exitCode } = await runPmCache(join(homeStr, "app"), {
      HOME: homeStr,
      XDG_CONFIG_HOME: join(homeStr, ".config"),
    });
    expect(stdout).toBe(cacheDir);
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("loads $HOME/.config/bun/bunfig.toml via spec default when XDG_CONFIG_HOME is unset", async () => {
    using home = tempDir("bunfig-xdg-default", { "app/package.json": "{}" });
    const homeStr = String(home);
    const cacheDir = join(homeStr, "spec-default-cache");
    writeBunfigCacheDir(join(homeStr, ".config/bun/bunfig.toml"), cacheDir);

    const { stdout, stderr, exitCode } = await runPmCache(join(homeStr, "app"), {
      HOME: homeStr,
      // XDG_CONFIG_HOME explicitly omitted — spec default of `$HOME/.config`
      // should apply.
    });
    expect(stdout).toBe(cacheDir);
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("loads $XDG_CONFIG_HOME/.bunfig.toml (legacy back-compat)", async () => {
    using home = tempDir("bunfig-xdg-legacy", { "app/package.json": "{}" });
    const homeStr = String(home);
    const cacheDir = join(homeStr, "xdg-legacy-cache");
    writeBunfigCacheDir(join(homeStr, ".config/.bunfig.toml"), cacheDir);

    const { stdout, stderr, exitCode } = await runPmCache(join(homeStr, "app"), {
      HOME: homeStr,
      XDG_CONFIG_HOME: join(homeStr, ".config"),
    });
    expect(stdout).toBe(cacheDir);
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("loads $HOME/.bunfig.toml when no XDG-base candidate exists", async () => {
    using home = tempDir("bunfig-home-dotfile", { "app/package.json": "{}" });
    const homeStr = String(home);
    const cacheDir = join(homeStr, "home-dotfile-cache");
    writeBunfigCacheDir(join(homeStr, ".bunfig.toml"), cacheDir);

    const { stdout, stderr, exitCode } = await runPmCache(join(homeStr, "app"), {
      HOME: homeStr,
      // `~/.config/bun/bunfig.toml` (spec default) does not exist here, so
      // we fall through to `$HOME/.bunfig.toml`.
    });
    expect(stdout).toBe(cacheDir);
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("$XDG_CONFIG_HOME/bun/bunfig.toml wins over $XDG_CONFIG_HOME/.bunfig.toml", async () => {
    using home = tempDir("bunfig-xdg-priority", { "app/package.json": "{}" });
    const homeStr = String(home);
    const winnerCache = join(homeStr, "xdg-winner-cache");
    const loserCache = join(homeStr, "xdg-loser-cache");
    writeBunfigCacheDir(join(homeStr, ".config/bun/bunfig.toml"), winnerCache);
    writeBunfigCacheDir(join(homeStr, ".config/.bunfig.toml"), loserCache);

    const { stdout, stderr, exitCode } = await runPmCache(join(homeStr, "app"), {
      HOME: homeStr,
      XDG_CONFIG_HOME: join(homeStr, ".config"),
    });
    expect(stdout).toBe(winnerCache);
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("empty XDG_CONFIG_HOME falls back to $HOME/.config (per XDG spec)", async () => {
    // XDG spec: "If $XDG_CONFIG_HOME is either not set or empty, a default
    // equal to $HOME/.config should be used." A bare `XDG_CONFIG_HOME=""`
    // must be treated as unset, not as an empty-string base.
    using home = tempDir("bunfig-xdg-empty", { "app/package.json": "{}" });
    const homeStr = String(home);
    const cacheDir = join(homeStr, "empty-xdg-default-cache");
    writeBunfigCacheDir(join(homeStr, ".config/bun/bunfig.toml"), cacheDir);

    const { stdout, stderr, exitCode } = await runPmCache(join(homeStr, "app"), {
      HOME: homeStr,
      XDG_CONFIG_HOME: "",
    });
    expect(stdout).toBe(cacheDir);
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("explicit XDG_CONFIG_HOME beats the $HOME/.config spec default", async () => {
    using home = tempDir("bunfig-xdg-override", { "app/package.json": "{}" });
    const homeStr = String(home);
    const customCache = join(homeStr, "custom-xdg-cache");
    const defaultCache = join(homeStr, "spec-default-cache");
    writeBunfigCacheDir(join(homeStr, "custom/bun/bunfig.toml"), customCache);
    writeBunfigCacheDir(join(homeStr, ".config/bun/bunfig.toml"), defaultCache);

    const { stdout, stderr, exitCode } = await runPmCache(join(homeStr, "app"), {
      HOME: homeStr,
      XDG_CONFIG_HOME: join(homeStr, "custom"),
    });
    expect(stdout).toBe(customCache);
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
