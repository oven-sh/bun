import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// FORCE_COLOR=1 is needed because the "not in $PATH" warning is gated
// on enable_ansi_colors_stderr, which is false when stderr is piped.
const baseEnv = { ...bunEnv, FORCE_COLOR: "1" };

function setupGlobalDirs(dirStr: string) {
  const binDir = join(dirStr, "bin");
  const globalDir = join(dirStr, "global");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(globalDir, { recursive: true });
  writeFileSync(join(globalDir, "package.json"), "{}");
  return { binDir, globalDir };
}

describe("global bin path warnings", () => {
  test("bun pm bin -g does not warn when PATH entry has trailing slash", async () => {
    using dir = tempDir("global-bin-28771", { "placeholder": "" });
    const { binDir, globalDir } = setupGlobalDirs(String(dir));

    // PATH entry with trailing separator — should still match the bin dir.
    const pathWithTrailing = binDir + "/";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "bin", "-g"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...baseEnv,
        BUN_INSTALL_BIN: binDir,
        BUN_INSTALL_GLOBAL_DIR: globalDir,
        PATH: pathWithTrailing + ":" + (process.env.PATH ?? ""),
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain(binDir);
    expect(stderr).not.toContain("not in $PATH");
    expect(exitCode).toBe(0);
  });

  test("bun pm bin -g does not warn when PATH entry matches exactly", async () => {
    using dir = tempDir("global-bin-28771", { "placeholder": "" });
    const { binDir, globalDir } = setupGlobalDirs(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "bin", "-g"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...baseEnv,
        BUN_INSTALL_BIN: binDir,
        BUN_INSTALL_GLOBAL_DIR: globalDir,
        PATH: binDir + ":" + (process.env.PATH ?? ""),
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain(binDir);
    expect(stderr).not.toContain("not in $PATH");
    expect(exitCode).toBe(0);
  });

  test("bun pm bin -g warns when global bin dir is not in PATH", async () => {
    using dir = tempDir("global-bin-28771", { "placeholder": "" });
    const { binDir, globalDir } = setupGlobalDirs(String(dir));

    // Use a PATH that does NOT contain the bin dir.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "bin", "-g"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...baseEnv,
        BUN_INSTALL_BIN: binDir,
        BUN_INSTALL_GLOBAL_DIR: globalDir,
        PATH: "/usr/bin:/usr/local/bin",
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain(binDir);
    expect(stderr).toContain("not in $PATH");
    expect(exitCode).toBe(0);
  });
});
