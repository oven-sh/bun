import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
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

  test("bun run loads project bunfig.toml even when system config is set", async () => {
    // Regression test for loaded_bunfig poisoning: system config loading must not
    // set ctx.debug.loaded_bunfig, which is used as a guard in run_command.zig
    // (line ~1366) to load project bunfig.toml. If system config incorrectly
    // poisons loaded_bunfig, `bun run script.ts` silently skips the project
    // bunfig.toml, inverting the documented config priority (system < project).
    using dir = tempDir("system-bunfig-run-priority", {
      "system-bunfig.toml": `
[define]
"globalThis.TIER" = "'system'"
`,
      "bunfig.toml": `
[define]
"globalThis.TIER" = "'project'"
`,
      "script.ts": `console.log("tier:" + (globalThis as any).TIER);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "script.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Project bunfig.toml must override system config.
    // If loaded_bunfig is poisoned, stdout would be "tier:system".
    expect(stdout).toContain("tier:project");
    expect(exitCode).toBe(0);
  });

  test("BUN_SYSTEM_CONFIG rejects relative paths", async () => {
    using dir = tempDir("system-bunfig-relative", {
      "index.ts": `console.log("should not run");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: "./relative-bunfig.toml" },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("absolute path");
    expect(exitCode).not.toBe(0);
  });

  test("BUN_SYSTEM_CONFIG empty string is treated as unset", async () => {
    // If BUN_SYSTEM_CONFIG="" were treated as set, loadSystemBunfig would fall
    // through to the platform default (/etc/bunfig.toml), silently enabling
    // system config auto-discovery for commands that should not probe it.
    using dir = tempDir("system-bunfig-empty", {
      "index.ts": `console.log("works");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: "" },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("works");
    expect(exitCode).toBe(0);
  });
});
