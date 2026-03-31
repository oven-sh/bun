import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("system-wide bunfig.toml", () => {
  test("system config preload is applied via BUN_SYSTEM_CONFIG", async () => {
    using dir = tempDir("system-bunfig-preload", {
      "system-bunfig.toml": `preload = ["./preload.ts"]`,
      "preload.ts": `(globalThis as any).SYSTEM_PRELOADED = true;`,
      "index.ts": `console.log("preloaded:" + !!(globalThis as any).SYSTEM_PRELOADED);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("preloaded:true");
    expect(exitCode).toBe(0);
  });

  test("project bunfig overrides system bunfig preload completely", async () => {
    // system-preload writes a marker file as an irreversible side effect.
    // If project bunfig truly replaces the preload list, the marker must not exist.
    using dir = tempDir("system-bunfig-override", {
      "system-bunfig.toml": `preload = ["./system-preload.ts"]`,
      "bunfig.toml": `preload = ["./project-preload.ts"]`,
      "system-preload.ts": `require("fs").writeFileSync(require("path").join(process.cwd(), "system-ran.txt"), "yes");`,
      "project-preload.ts": `(globalThis as any).FROM = "project";`,
      "index.ts": `console.log("from:" + (globalThis as any).FROM);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("from:project");
    // The system preload must NOT have run — project bunfig replaced it
    expect(existsSync(join(String(dir), "system-ran.txt"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("explicit BUN_SYSTEM_CONFIG with bad path fails loudly", async () => {
    using dir = tempDir("system-bunfig-bad", {
      "index.ts": `console.log("should not run");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/nonexistent.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Explicit override should error, not silently ignore
    expect(stderr.length).toBeGreaterThan(0);
    expect(exitCode).not.toBe(0);
  });

  test("system config define is applied", async () => {
    using dir = tempDir("system-bunfig-define", {
      "system-bunfig.toml": `
[define]
"process.env.SYSTEM_DEFINED" = "'from-system-config'"
`,
      "index.ts": `console.log("val:" + process.env.SYSTEM_DEFINED);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("val:from-system-config");
    expect(exitCode).toBe(0);
  });

  test("system→home config merge via readGlobalConfig path", async () => {
    // Exercise loadGlobalBunfig() via a package manager command.
    // System config sets exact=true, home config sets dryRun=true.
    using dir = tempDir("system-bunfig-home-merge", {
      "system-bunfig.toml": `
[install]
exact = true
`,
      "home-bunfig.toml": `
[install]
dryRun = true
`,
      "package.json": `{ "name": "test-merge", "dependencies": {} }`,
    });

    const xdgDir = join(String(dir), "xdg");
    mkdirSync(xdgDir);
    copyFileSync(join(String(dir), "home-bunfig.toml"), join(xdgDir, ".bunfig.toml"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: {
        ...bunEnv,
        BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml`,
        XDG_CONFIG_HOME: xdgDir,
      },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [_stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // dryRun from home config means no node_modules created
    expect(existsSync(join(String(dir), "node_modules"))).toBe(false);
    expect(exitCode).toBe(0);
  });
});
