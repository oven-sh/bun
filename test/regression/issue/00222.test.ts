// https://github.com/oven-sh/bun/issues/222
// ZSH "Insecure Directories" error when zsh completions are installed directly
// to ~/.bun instead of ~/.bun/completions subdirectory

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { join } from "path";

describe("zsh completions", () => {
  test.skipIf(!isPosix)("completions are installed to $BUN_INSTALL/completions subdirectory", async () => {
    using dir = tempDir("issue-222", {
      "completions/.gitkeep": "",
    });

    const bunInstallDir = String(dir);
    const completionsDir = join(bunInstallDir, "completions");

    // Run bun completions with BUN_INSTALL set
    await using proc = Bun.spawn({
      cmd: [bunExe(), "completions"],
      env: {
        ...bunEnv,
        BUN_INSTALL: bunInstallDir,
        SHELL: "/bin/zsh",
        HOME: "/nonexistent", // Ensure we don't fall back to HOME-based paths
        ZDOTDIR: "/nonexistent",
        FPATH: "",
        XDG_DATA_HOME: "",
        IS_BUN_AUTO_UPDATE: "true", // Skip tty check and write to file
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The completion file should be at $BUN_INSTALL/completions/_bun
    const completionFile = Bun.file(join(completionsDir, "_bun"));
    expect(await completionFile.exists()).toBe(true);

    // Verify the completion file has content
    const content = await completionFile.text();
    expect(content).toContain("compdef _bun bun");

    // Verify the file was NOT created directly in $BUN_INSTALL
    const directFile = Bun.file(join(bunInstallDir, "_bun"));
    expect(await directFile.exists()).toBe(false);

    expect(exitCode).toBe(0);
  });

  test.skipIf(!isPosix)("completions fall back to $HOME/.bun/completions", async () => {
    using dir = tempDir("issue-222-home", {
      ".bun/completions/.gitkeep": "",
    });

    const homeDir = String(dir);
    const completionsDir = join(homeDir, ".bun", "completions");

    // Run bun completions with HOME set but no BUN_INSTALL
    await using proc = Bun.spawn({
      cmd: [bunExe(), "completions"],
      env: {
        ...bunEnv,
        HOME: homeDir,
        SHELL: "/bin/zsh",
        // BUN_INSTALL is not set (undefined) - let it fall back to HOME
        ZDOTDIR: "/nonexistent",
        FPATH: "",
        XDG_DATA_HOME: "",
        IS_BUN_AUTO_UPDATE: "true", // Skip tty check and write to file
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The completion file should be at $HOME/.bun/completions/_bun
    const completionFile = Bun.file(join(completionsDir, "_bun"));
    expect(await completionFile.exists()).toBe(true);

    // Verify the file was NOT created directly in $HOME/.bun
    const directFile = Bun.file(join(homeDir, ".bun", "_bun"));
    expect(await directFile.exists()).toBe(false);

    expect(exitCode).toBe(0);
  });
});
