import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";
import fs from "fs";

const HISTORY_FILENAME = ".bun_repl_history";

async function runReplWithEnv(env: Record<string, string>): Promise<number> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    stdin: Buffer.from("1+1\n.exit\n"),
    stdout: "pipe",
    stderr: "pipe",
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
  test("uses $XDG_DATA_HOME/bun/ when XDG_DATA_HOME is set", async () => {
    using dir = tempDir("repl-xdg", {
      "xdg-data": { ".keep": "" },
      "home": { ".keep": "" },
    });
    const xdgDataHome = path.join(String(dir), "xdg-data");
    const fakeHome = path.join(String(dir), "home");

    const exitCode = await runReplWithEnv({
      HOME: fakeHome,
      XDG_DATA_HOME: xdgDataHome,
      BUN_INSTALL: "",
    });
    expect(exitCode).toBe(0);

    const expectedPath = path.join(xdgDataHome, "bun", HISTORY_FILENAME);
    expect(fs.existsSync(expectedPath)).toBe(true);
    // Should NOT be written to $HOME
    expect(fs.existsSync(path.join(fakeHome, HISTORY_FILENAME))).toBe(false);
  });

  test("uses $BUN_INSTALL when BUN_INSTALL is set and XDG_DATA_HOME is not", async () => {
    using dir = tempDir("repl-install", {
      "bun-install": { ".keep": "" },
      "home": { ".keep": "" },
    });
    const bunInstall = path.join(String(dir), "bun-install");
    const fakeHome = path.join(String(dir), "home");

    const exitCode = await runReplWithEnv({
      HOME: fakeHome,
      XDG_DATA_HOME: "",
      BUN_INSTALL: bunInstall,
    });
    expect(exitCode).toBe(0);

    const expectedPath = path.join(bunInstall, HISTORY_FILENAME);
    expect(fs.existsSync(expectedPath)).toBe(true);
    // Should NOT be written to $HOME
    expect(fs.existsSync(path.join(fakeHome, HISTORY_FILENAME))).toBe(false);
  });

  test("falls back to $HOME when neither XDG_DATA_HOME nor BUN_INSTALL is set", async () => {
    using dir = tempDir("repl-home", { ".keep": "" });
    const fakeHome = String(dir);

    const exitCode = await runReplWithEnv({
      HOME: fakeHome,
      XDG_DATA_HOME: "",
      BUN_INSTALL: "",
    });
    expect(exitCode).toBe(0);

    const expectedPath = path.join(fakeHome, HISTORY_FILENAME);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  test("XDG_DATA_HOME takes priority over BUN_INSTALL", async () => {
    using dir = tempDir("repl-priority", {
      "xdg-data": { ".keep": "" },
      "bun-install": { ".keep": "" },
      "home": { ".keep": "" },
    });
    const xdgDataHome = path.join(String(dir), "xdg-data");
    const bunInstall = path.join(String(dir), "bun-install");
    const fakeHome = path.join(String(dir), "home");

    const exitCode = await runReplWithEnv({
      HOME: fakeHome,
      XDG_DATA_HOME: xdgDataHome,
      BUN_INSTALL: bunInstall,
    });
    expect(exitCode).toBe(0);

    // Should be in XDG path, not BUN_INSTALL
    expect(fs.existsSync(path.join(xdgDataHome, "bun", HISTORY_FILENAME))).toBe(true);
    expect(fs.existsSync(path.join(bunInstall, HISTORY_FILENAME))).toBe(false);
  });
});
