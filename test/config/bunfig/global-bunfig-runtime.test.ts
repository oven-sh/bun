// The global `.bunfig.toml` must apply to runtime commands (`bun <file>`,
// `bun -e`, `bun run`, `bun test`) and must fall back to `$HOME/.bunfig.toml`
// when `$XDG_CONFIG_HOME` is set but contains no config.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function baseEnv(home: string, xdg?: string) {
  const env: Record<string, string> = { ...bunEnv };
  // Isolate from the host's global config.
  delete env.HOME;
  delete env.USERPROFILE;
  delete env.XDG_CONFIG_HOME;
  // `bun pm cache` precedence: strip vars that would mask `[install.cache].dir`.
  delete env.BUN_INSTALL_CACHE_DIR;
  delete env.BUN_INSTALL;
  delete env.XDG_CACHE_HOME;
  env.HOME = home;
  env.USERPROFILE = home;
  if (xdg !== undefined) env.XDG_CONFIG_HOME = xdg;
  return env;
}

async function run(cmd: string[], cwd: string, env: Record<string, string>, argv0?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    argv0,
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

const toml = (s: string) => s.replace(/\\/g, "/");

describe("global ~/.bunfig.toml applies to runtime commands", () => {
  function layout() {
    const dir = tempDir("global-bunfig-rt", {
      "preload.ts": `(globalThis as any).__G = "preload-ran";\n`,
      "app/main.ts": `console.log((globalThis as any).__G ?? "preload NOT run");\nconsole.log(process.env.GLOBAL_BUNFIG_SENTINEL ?? "define NOT applied");\n`,
      "app/main.test.ts": `import { test, expect } from "bun:test";\ntest("preload", () => { expect((globalThis as any).__G).toBe("preload-ran"); });\n`,
    });
    const home = String(dir);
    writeFileSync(
      join(home, ".bunfig.toml"),
      toml(
        `preload = ["${join(home, "preload.ts")}"]\n` +
          `define = { "process.env.GLOBAL_BUNFIG_SENTINEL" = "'sentinel'" }\n` +
          `[test]\npreload = ["${join(home, "preload.ts")}"]\n`,
      ),
    );
    return { dir, home, app: join(home, "app") };
  }

  test.concurrent("bun <file>", async () => {
    const { dir, home, app } = layout();
    using _ = dir;
    const { stdout, exitCode } = await run(["main.ts"], app, baseEnv(home));
    expect(stdout).toBe("preload-ran\nsentinel");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun -e", async () => {
    const { dir, home, app } = layout();
    using _ = dir;
    const { stdout, exitCode } = await run(
      ["-e", `console.log((globalThis as any).__G ?? "preload NOT run")`],
      app,
      baseEnv(home),
    );
    expect(stdout).toBe("preload-ran");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun run <file>", async () => {
    const { dir, home, app } = layout();
    using _ = dir;
    const { stdout, exitCode } = await run(["run", "./main.ts"], app, baseEnv(home));
    expect(stdout).toBe("preload-ran\nsentinel");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun test", async () => {
    const { dir, home, app } = layout();
    using _ = dir;
    const { stderr, exitCode } = await run(["test", "main.test.ts"], app, baseEnv(home));
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("node shim (argv0=node)", async () => {
    const { dir, home, app } = layout();
    using _ = dir;
    const { stdout, exitCode } = await run(["main.ts"], app, baseEnv(home), "node");
    expect(stdout).toBe("preload-ran\nsentinel");
    expect(exitCode).toBe(0);
  });

  test.concurrent("local bunfig overrides global for bun run (shallow merge)", async () => {
    using dir = tempDir("global-bunfig-merge", {
      "g.ts": `(globalThis as any).__G = "global";\n`,
      "l.ts": `(globalThis as any).__G = "local";\n`,
      "app/main.ts": `console.log((globalThis as any).__G ?? "none");\n`,
    });
    const home = String(dir);
    writeFileSync(join(home, ".bunfig.toml"), toml(`preload = ["${join(home, "g.ts")}"]\n`));
    writeFileSync(join(home, "app", "bunfig.toml"), toml(`preload = ["${join(home, "l.ts")}"]\n`));
    const { stdout, exitCode } = await run(["run", "./main.ts"], join(home, "app"), baseEnv(home));
    expect(stdout).toBe("local");
    expect(exitCode).toBe(0);
  });
});

describe("XDG_CONFIG_HOME lookup falls back to $HOME/.bunfig.toml", () => {
  test.concurrent("XDG set but no config there -> $HOME/.bunfig.toml still applies (runtime)", async () => {
    using dir = tempDir("global-bunfig-xdg-fallback", {
      "preload.ts": `(globalThis as any).__G = "preload-ran";\n`,
      "xdg/.keep": "",
      "app/main.ts": `console.log((globalThis as any).__G ?? "preload NOT run");\n`,
    });
    const home = String(dir);
    const xdg = join(home, "xdg");
    writeFileSync(join(home, ".bunfig.toml"), toml(`preload = ["${join(home, "preload.ts")}"]\n`));
    const { stdout, exitCode } = await run(["main.ts"], join(home, "app"), baseEnv(home, xdg));
    expect(stdout).toBe("preload-ran");
    expect(exitCode).toBe(0);
  });

  test.concurrent("XDG set but no config there -> $HOME/.bunfig.toml still applies (bun pm cache)", async () => {
    using dir = tempDir("global-bunfig-xdg-fallback-pm", {
      "xdg/.keep": "",
      "app/package.json": `{"name":"app"}\n`,
    });
    const home = String(dir);
    const xdg = join(home, "xdg");
    const cacheDir = join(home, "sentinel-cache");
    writeFileSync(join(home, ".bunfig.toml"), toml(`[install.cache]\ndir = "${cacheDir}"\n`));
    const { stdout, exitCode } = await run(["pm", "cache"], join(home, "app"), baseEnv(home, xdg));
    expect(stdout).toContain("sentinel-cache");
    expect(exitCode).toBe(0);
  });

  // #23128: same fallback for the user-level .npmrc.
  test.concurrent("XDG set but no config there -> $HOME/.npmrc still applies (bun pm cache)", async () => {
    using dir = tempDir("global-npmrc-xdg-fallback-pm", {
      "xdg/.keep": "",
      "app/package.json": `{"name":"app"}\n`,
    });
    const home = String(dir);
    const xdg = join(home, "xdg");
    const cacheDir = join(home, "npmrc-sentinel-cache");
    writeFileSync(join(home, ".npmrc"), toml(`cache=${cacheDir}\n`));
    const { stdout, exitCode } = await run(["pm", "cache"], join(home, "app"), baseEnv(home, xdg));
    expect(stdout).toContain("npmrc-sentinel-cache");
    expect(exitCode).toBe(0);
  });

  test.concurrent("XDG config present -> it wins over $HOME/.bunfig.toml", async () => {
    using dir = tempDir("global-bunfig-xdg-wins", {
      "h.ts": `(globalThis as any).__G = "home";\n`,
      "x.ts": `(globalThis as any).__G = "xdg";\n`,
      "app/main.ts": `console.log((globalThis as any).__G ?? "none");\n`,
    });
    const home = String(dir);
    const xdg = join(home, "xdg");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(home, ".bunfig.toml"), toml(`preload = ["${join(home, "h.ts")}"]\n`));
    writeFileSync(join(xdg, ".bunfig.toml"), toml(`preload = ["${join(home, "x.ts")}"]\n`));
    const { stdout, exitCode } = await run(["main.ts"], join(home, "app"), baseEnv(home, xdg));
    expect(stdout).toBe("xdg");
    expect(exitCode).toBe(0);
  });

  test.concurrent("XDG .npmrc present -> it wins over $HOME/.npmrc", async () => {
    using dir = tempDir("global-npmrc-xdg-wins", {
      "app/package.json": `{"name":"app"}\n`,
    });
    const home = String(dir);
    const xdg = join(home, "xdg");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(home, ".npmrc"), toml(`cache=${join(home, "npmrc-home-cache")}\n`));
    writeFileSync(join(xdg, ".npmrc"), toml(`cache=${join(home, "npmrc-xdg-cache")}\n`));
    const { stdout, exitCode } = await run(["pm", "cache"], join(home, "app"), baseEnv(home, xdg));
    expect(stdout).toContain("npmrc-xdg-cache");
    expect(stdout).not.toContain("npmrc-home-cache");
    expect(exitCode).toBe(0);
  });
});
