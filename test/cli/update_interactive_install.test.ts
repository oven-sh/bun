import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("bun update --interactive actually installs packages", () => {
  test("should update package.json AND install packages", async () => {
    using dir = tempDir("update-interactive-install", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Use a very old version that definitely has updates available
          "is-even": "0.1.0",
        },
      }),
    });

    // First, run bun install to create initial node_modules
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const installExitCode = await installProc.exited;
    expect(installExitCode).toBe(0);

    // Verify initial installation
    const initialPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
    expect(initialPackageJson.dependencies["is-even"]).toBe("0.1.0");

    // Check that node_modules was created
    expect(existsSync(join(String(dir), "node_modules"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules", "is-even"))).toBe(true);

    // Read the initial installed version from package.json in node_modules
    const initialInstalledPkgJson = JSON.parse(
      readFileSync(join(String(dir), "node_modules", "is-even", "package.json"), "utf8"),
    );
    const initialVersion = initialInstalledPkgJson.version;
    expect(initialVersion).toBe("0.1.0");

    // Now run update --interactive with automatic selection
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Select first package and confirm
      updateProc.stdin.write(" "); // space to select
      updateProc.stdin.write("\r"); // enter to confirm
      updateProc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([
        updateProc.stdout.text(),
        updateProc.stderr.text(),
        updateProc.exited,
      ]);

      // Debug output if test fails
      if (exitCode !== 0) {
        console.log("STDOUT:", stdout);
        console.log("STDERR:", stderr);
      }

      expect(exitCode).toBe(0);

      // Check that package.json was updated
      const updatedPackageJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
      const updatedVersion = updatedPackageJson.dependencies["is-even"];

      // The version should have changed from "0.1.0"
      expect(updatedVersion).not.toBe("0.1.0");

      // Most importantly: verify that node_modules was actually updated!
      // This is the bug - previously only package.json changed but not node_modules
      const installedPkgJson = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "is-even", "package.json"), "utf8"),
      );
      const installedVersion = installedPkgJson.version;

      // The installed version should match what's in package.json
      // Extract version number from potentially semver-prefixed string (e.g., "^1.1.0" -> "1.1.0")
      const expectedVersion = updatedVersion.replace(/^[\^~]/, "");

      // The installed version should NOT be the old version
      expect(installedVersion).not.toBe("0.1.0");
      expect(Bun.semver.satisfies(installedVersion, ">0.1.0")).toBe(true);

      // And ideally should match the expected version (or at least be compatible)
      // We check that it starts with the expected major.minor
      const [expectedMajor, expectedMinor] = expectedVersion.split(".");
      expect(installedVersion).toContain(`${expectedMajor}.${expectedMinor}`);
    } catch (err) {
      // Ensure cleanup on failure
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });

  test("should work with --latest flag", async () => {
    using dir = tempDir("update-interactive-latest", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-odd": "0.1.0", // Use old version of is-odd
        },
      }),
    });

    // Initial install
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await installProc.exited;

    // Verify initial version
    const initialPkgJson = JSON.parse(
      readFileSync(join(String(dir), "node_modules", "is-odd", "package.json"), "utf8"),
    );
    expect(initialPkgJson.version).toBe("0.1.0");

    // Run update --interactive with 'l' to toggle latest, then select and confirm
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // 'l' toggles to latest AND selects the package (no separate space needed)
      updateProc.stdin.write("l"); // toggle latest (also selects)
      updateProc.stdin.write("\r"); // confirm
      updateProc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([
        updateProc.stdout.text(),
        updateProc.stderr.text(),
        updateProc.exited,
      ]);

      if (exitCode !== 0) {
        console.log("STDOUT:", stdout);
        console.log("STDERR:", stderr);
      }

      expect(exitCode).toBe(0);

      // Verify node_modules was updated
      const updatedPkgJson = JSON.parse(
        readFileSync(join(String(dir), "node_modules", "is-odd", "package.json"), "utf8"),
      );

      // Should be newer than 0.1.0
      expect(updatedPkgJson.version).not.toBe("0.1.0");
      expect(Bun.semver.satisfies(updatedPkgJson.version, ">0.1.0")).toBe(true);
    } catch (err) {
      // Ensure cleanup on failure
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });

  // Issue #30890: on Windows the multi-select prompt hides the cursor with
  // `\x1b[?25l` and enables mouse tracking, then registers a `scopeguard::defer!`
  // that re-shows the cursor on exit. The prompt previously set
  // `ENABLE_PROCESSED_INPUT` on stdin, which made the Windows console
  // intercept Ctrl+C and terminate the process via `ExitProcess`, bypassing
  // the defer so the cursor stayed hidden after the prompt died. The fix
  // stops setting `ENABLE_PROCESSED_INPUT` so Ctrl+C arrives as byte `\x03`
  // and takes the byte-3 graceful-cancel path that runs the defer.
  //
  // This piped-stdin variant covers the cross-platform byte-3 → cleanup path
  // (Unix raw mode already delivers Ctrl+C as byte 3; pipes on Windows never
  // go through console mode flags at all).
  test("Ctrl+C during multi-select prompt restores the cursor and exits cleanly", async () => {
    using dir = tempDir("update-interactive-ctrlc", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-even": "0.1.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: { ...bunEnv, FORCE_COLOR: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Byte 0x03 is Ctrl+C. On the interactive prompt's input loop this
      // takes the `3 | 4` (ctrl+c / ctrl+d) arm, which calls
      // `cleanup_and_reprint!(false)` and returns `EndOfStream`. The
      // scopeguard defer then emits `\x1b[?25h` to restore the cursor
      // before the "Cancelled" line prints and the process exits 0.
      updateProc.stdin.write("\x03");
      updateProc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([
        updateProc.stdout.text(),
        updateProc.stderr.text(),
        updateProc.exited,
      ]);

      if (exitCode !== 0 || !stdout.includes("\x1b[?25h")) {
        console.log("STDOUT (hex preview):", Buffer.from(stdout).toString("hex").slice(0, 400));
        console.log("STDERR:", stderr);
      }

      // The defer must have re-shown the cursor before exit.
      expect(stdout).toContain("\x1b[?25h");
      // And disabled mouse tracking that the prompt had enabled.
      expect(stdout).toContain("\x1b[?1000l");
      expect(stdout).toContain("\x1b[?1006l");
      // Graceful cancel message.
      expect(stdout).toContain("Cancelled");

      // package.json must be untouched — Ctrl+C cancels the update.
      const pkg = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
      expect(pkg.dependencies["is-even"]).toBe("0.1.0");

      // Clean exit — asserted last so stdout/stderr diagnostics show up
      // above a non-zero failure.
      expect(exitCode).toBe(0);
    } catch (err) {
      updateProc.stdin.end();
      updateProc.kill();
      throw err;
    }
  });

  // PTY variant that exercises the raw-mode TTY byte-3 path end-to-end on
  // both platforms. NOTE: this does NOT reproduce the original #30890
  // console-ctrl-handler kill path — `terminal-platform-gaps.test.ts:184`
  // documents that Windows ConPTY does not translate a written `\x03` into
  // `CTRL_C_EVENT`; conhost forwards byte `0x03` to the child's input
  // buffer, so even with the pre-fix `ENABLE_PROCESSED_INPUT` flag the
  // child would have taken the same byte-3 graceful-cancel branch. That
  // original bug only fires on a real keyboard press in a real Windows
  // console host, which can't be automated here. The test still guards the
  // byte-3 cleanup path (scopeguard defer → cursor restore → "Cancelled"
  // → clean exit) against regressions on both platforms; the SIGINT test
  // below is what fails pre-fix on Linux.
  test("Ctrl+C through a real PTY restores the cursor and exits cleanly", async () => {
    using dir = tempDir("update-interactive-ctrlc-pty", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-even": "0.1.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    const decoder = new TextDecoder();
    let output = "";
    let sawPrompt = false;
    let sawCancelled = false;
    const promptReady = Promise.withResolvers<void>();
    // Resolved inside data() when "Cancelled" arrives. Key on the LAST
    // thing the child writes (not the earlier `\x1b[?25h`): the Rust code
    // flushes the cursor-restore, then prints "Cancelled" in a separate
    // prettyln that hits conhost as a separate write. On Windows ConPTY
    // those arrive as independent IOCP completions, and proc.exited races
    // the final data IOCP (see terminal-platform-gaps.test.ts:56-59). The
    // exit() callback is not an alternative — it does not fire on child
    // exit for an externally-created Bun.Terminal (same file, L322-335).
    const cancelledSeen = Promise.withResolvers<void>();

    await using terminal = new Bun.Terminal({
      cols: 120,
      rows: 30,
      data(_t, chunk: Uint8Array) {
        output += decoder.decode(chunk, { stream: true });
        if (!sawPrompt && output.includes("\x1b[?25l")) {
          sawPrompt = true;
          promptReady.resolve();
        }
        if (!sawCancelled && output.includes("Cancelled")) {
          sawCancelled = true;
          cancelledSeen.resolve();
        }
      },
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: { ...bunEnv, FORCE_COLOR: "1" },
      terminal,
    });

    try {
      // Wait for the prompt to render before writing; race against
      // proc.exited so a hypothetical pre-prompt crash surfaces as an
      // assertion failure instead of a timeout.
      await Promise.race([promptReady.promise, proc.exited]);
      terminal.write("\x03");

      // Wait for the final "Cancelled" chunk to arrive before asserting —
      // everything we care about has been flushed by then.
      await Promise.race([cancelledSeen.promise, proc.exited]);
      const exitCode = await proc.exited;
      output += decoder.decode();

      if (exitCode !== 0 || !output.includes("\x1b[?25h")) {
        console.log("PTY output (hex preview):", Buffer.from(output).toString("hex").slice(0, 800));
      }

      // The cursor-restore sequence must be present — this is the whole
      // point of the issue.
      expect(output).toContain("\x1b[?25h");
      // And the mouse-tracking modes the prompt enabled must be disabled.
      expect(output).toContain("\x1b[?1000l");
      expect(output).toContain("\x1b[?1006l");
      expect(output).toContain("Cancelled");

      // package.json must be untouched.
      const pkg = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
      expect(pkg.dependencies["is-even"]).toBe("0.1.0");

      // Clean exit — asserted last so PTY output diagnostics show up above
      // a non-zero failure.
      expect(exitCode).toBe(0);
    } finally {
      proc.kill();
    }
  });

  // External SIGINT (or Windows Ctrl+Break / console-close) must also
  // restore the cursor. The in-prompt byte-3 path handles keyboard Ctrl+C
  // via the PTY, but a signal sent from a parent process bypasses that —
  // without a signal handler the process dies with the cursor still
  // hidden. The signal handler installed by `prompt_signal::install()`
  // writes the restore sequence and calls `uv_tty_reset_mode` before
  // exiting, matching the guarantee the keyboard-Ctrl+C path already
  // gives. This is the Linux-observable half of #30890; on Windows the
  // same handler catches CTRL_BREAK_EVENT / CTRL_CLOSE_EVENT which
  // ENABLE_PROCESSED_INPUT clearing does not cover.
  test.skipIf(process.platform === "win32")("SIGINT kills the prompt cleanly with cursor restored", async () => {
    using dir = tempDir("update-interactive-sigint", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-even": "0.1.0",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    const decoder = new TextDecoder();
    let output = "";
    let sawPrompt = false;
    let sawRestore = false;
    const promptReady = Promise.withResolvers<void>();
    // Same race avoidance as the PTY Ctrl+C test above: proc.exited
    // resolves when the child's exit notification arrives, independent of
    // the PTY-master-readable event. Key the resolver on the LAST byte of
    // the restore sequence (`\x1b[?1006l`) so all three mouse / cursor
    // assertions are guaranteed to find their bytes in `output`. The Unix
    // handler writes the whole 24-byte sequence in a single `write(2)`
    // syscall so waiting on the last marker guarantees the earlier ones
    // are present.
    const restoreSeen = Promise.withResolvers<void>();

    await using terminal = new Bun.Terminal({
      cols: 120,
      rows: 30,
      data(_t, chunk: Uint8Array) {
        output += decoder.decode(chunk, { stream: true });
        if (!sawPrompt && output.includes("\x1b[?25l")) {
          sawPrompt = true;
          promptReady.resolve();
        }
        if (!sawRestore && output.includes("\x1b[?1006l")) {
          sawRestore = true;
          restoreSeen.resolve();
        }
      },
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: { ...bunEnv, FORCE_COLOR: "1" },
      terminal,
    });

    try {
      // Wait for the prompt to render (and thus install the signal
      // handler) before sending SIGINT. Race against proc.exited so we
      // don't hang if the subprocess dies before rendering.
      await Promise.race([promptReady.promise, proc.exited]);

      proc.kill("SIGINT");

      // Wait for the full restore sequence to arrive on the PTY master
      // (or for the subprocess to exit, so a regression fails with an
      // assertion instead of a timeout).
      await Promise.race([restoreSeen.promise, proc.exited]);
      const exitCode = await proc.exited;
      output += decoder.decode();

      if (!output.includes("\x1b[?25h")) {
        console.log("Missing cursor restore after SIGINT. Output hex tail:");
        console.log(Buffer.from(output).toString("hex").slice(-400));
      }

      // The signal handler MUST emit the cursor-restore before exiting.
      // Without the handler, the default SIGINT action kills the process
      // with the cursor still hidden.
      expect(output).toContain("\x1b[?25h");
      // And disable the mouse tracking the prompt had enabled.
      expect(output).toContain("\x1b[?1000l");
      expect(output).toContain("\x1b[?1006l");

      // package.json must be untouched — the signal kills the process
      // before any update work runs.
      const pkg = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
      expect(pkg.dependencies["is-even"]).toBe("0.1.0");

      // Conventional 128 + SIGINT(2). Last so output diagnostics show
      // first on failure.
      expect(exitCode).toBe(130);
    } finally {
      proc.kill();
    }
  });
});
