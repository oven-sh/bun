import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

  test("project bunfig overrides system bunfig values", async () => {
    using dir = tempDir("system-bunfig-override", {
      "system-bunfig.toml": `preload = ["./system-preload.ts"]`,
      "bunfig.toml": `preload = ["./project-preload.ts"]`,
      "system-preload.ts": `(globalThis as any).FROM = "system";`,
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

    // Project-level bunfig overrides system-level preload
    expect(stdout.trim()).toBe("from:project");
    expect(exitCode).toBe(0);
  });

  test("nonexistent BUN_SYSTEM_CONFIG path is silently ignored", async () => {
    using dir = tempDir("system-bunfig-missing", {
      "index.ts": `console.log("works");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/nonexistent.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("works");
    expect(exitCode).toBe(0);
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
});
