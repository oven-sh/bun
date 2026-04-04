import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "path";

const HISTORY_FILENAME = ".bun_repl_history";

// On Windows, bun.env_var.HOME reads USERPROFILE instead of HOME.
function homeEnv(dir: string): Record<string, string> {
  return isWindows ? { USERPROFILE: dir } : { HOME: dir };
}

async function runReplWithEnv(env: Record<string, string>): Promise<number> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    stdin: Buffer.from("1+1\n.exit\n"),
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...bunEnv,
      TERM: "dumb",
      NO_COLOR: "1",
      ...env,
    },
  });
  return await proc.exited;
}

describe("REPL history respects XDG_DATA_HOME and BUN_INSTALL", () => {
  test.concurrent("uses $XDG_DATA_HOME/bun/ when XDG_DATA_HOME is set", async () => {
    using dir = tempDir("repl-xdg", {
      "xdg-data": { ".keep": "" },
      "home": { ".keep": "" },
    });
    const xdgDataHome = path.join(String(dir), "xdg-data");
    const fakeHome = path.join(String(dir), "home");

    const exitCode = await runReplWithEnv({
      ...homeEnv(fakeHome),
      XDG_DATA_HOME: xdgDataHome,
      BUN_INSTALL: "",
    });
    expect(exitCode).toBe(0);

    const expectedPath = path.join(xdgDataHome, "bun", HISTORY_FILENAME);
    expect(fs.existsSync(expectedPath)).toBe(true);
    // Should NOT be written to home dir
    expect(fs.existsSync(path.join(fakeHome, HISTORY_FILENAME))).toBe(false);
  });

  test.concurrent("uses $BUN_INSTALL when BUN_INSTALL is set and XDG_DATA_HOME is not", async () => {
    using dir = tempDir("repl-install", {
      "bun-install": { ".keep": "" },
      "home": { ".keep": "" },
    });
    const bunInstall = path.join(String(dir), "bun-install");
    const fakeHome = path.join(String(dir), "home");

    const exitCode = await runReplWithEnv({
      ...homeEnv(fakeHome),
      XDG_DATA_HOME: "",
      BUN_INSTALL: bunInstall,
    });
    expect(exitCode).toBe(0);

    const expectedPath = path.join(bunInstall, HISTORY_FILENAME);
    expect(fs.existsSync(expectedPath)).toBe(true);
    // Should NOT be written to home dir
    expect(fs.existsSync(path.join(fakeHome, HISTORY_FILENAME))).toBe(false);
  });

  test.concurrent("falls back to home dir when neither XDG_DATA_HOME nor BUN_INSTALL is set", async () => {
    using dir = tempDir("repl-home", { ".keep": "" });
    const fakeHome = String(dir);

    const exitCode = await runReplWithEnv({
      ...homeEnv(fakeHome),
      XDG_DATA_HOME: "",
      BUN_INSTALL: "",
    });
    expect(exitCode).toBe(0);

    const expectedPath = path.join(fakeHome, HISTORY_FILENAME);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  test.concurrent("XDG_DATA_HOME takes priority over BUN_INSTALL", async () => {
    using dir = tempDir("repl-priority", {
      "xdg-data": { ".keep": "" },
      "bun-install": { ".keep": "" },
      "home": { ".keep": "" },
    });
    const xdgDataHome = path.join(String(dir), "xdg-data");
    const bunInstall = path.join(String(dir), "bun-install");
    const fakeHome = path.join(String(dir), "home");

    const exitCode = await runReplWithEnv({
      ...homeEnv(fakeHome),
      XDG_DATA_HOME: xdgDataHome,
      BUN_INSTALL: bunInstall,
    });
    expect(exitCode).toBe(0);

    // Should be in XDG path, not BUN_INSTALL
    expect(fs.existsSync(path.join(xdgDataHome, "bun", HISTORY_FILENAME))).toBe(true);
    expect(fs.existsSync(path.join(bunInstall, HISTORY_FILENAME))).toBe(false);
  });
});
