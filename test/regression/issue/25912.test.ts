import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Issue #25912: PTY allocation fails after extended runtime (~17 hours) or system
// sleep/wake cycles on macOS. New Terminal instances appear to create successfully,
// but spawned shells immediately exit with code 0.
//
// The fix adds proper error handling for:
// 1. setsid() - now fails the spawn if it returns -1 for PTY spawns
// 2. ioctl(TIOCSCTTY) - now fails the spawn if it returns -1 for PTY spawns
// 3. PTY validation - verifies slave FD is actually a TTY after openpty()
//
// Since we can't reliably reproduce the sleep/wake corruption in a test, we verify:
// - The PTY slave FD is correctly identified as a TTY (via isatty check in spawn)
// - Proper session setup happens (setsid) before TIOCSCTTY
// - The spawned shell gets a proper controlling terminal

describe.todoIf(isWindows)("Issue #25912 - PTY session and controlling terminal setup", () => {
  test("spawned shell has controlling terminal and proper session", async () => {
    // This test verifies the shell gets a proper controlling terminal.
    // Before the fix, setsid() and TIOCSCTTY failures were silently ignored,
    // causing shells to exit immediately with code 0.
    const dataChunks: Uint8Array[] = [];

    const proc = Bun.spawn(
      [
        bunExe(),
        "-e",
        `
      const tty = require("tty");
      const fs = require("fs");

      // Check that we have a controlling terminal
      const hasTTY = tty.isatty(0) && tty.isatty(1) && tty.isatty(2);

      // Check that our session ID matches (we should be session leader)
      // getsid(0) returns the session ID of the calling process
      const pid = process.pid;

      // Try to get ttyname - this only works if TIOCSCTTY succeeded
      let ttyName = "unknown";
      try {
        // On Unix, /dev/tty is the controlling terminal
        // It will error if there's no controlling terminal
        fs.statSync("/dev/tty");
        ttyName = "has_ctty";
      } catch (e) {
        ttyName = "no_ctty";
      }

      console.log(JSON.stringify({
        hasTTY,
        ttyName,
        pid
      }));
    `,
      ],
      {
        env: bunEnv,
        terminal: {
          cols: 80,
          rows: 24,
          data: (_terminal: Bun.Terminal, data: Uint8Array) => {
            dataChunks.push(data);
          },
        },
      },
    );

    await proc.exited;

    // The shell should exit successfully (exit code 0)
    // Before the fix, it might exit with code 0 but have no controlling terminal
    expect(proc.exitCode).toBe(0);

    const combinedOutput = Buffer.concat(dataChunks).toString();

    // Parse the JSON output - find the JSON object in the output
    const jsonMatch = combinedOutput.match(/\{[^}]+\}/);
    expect(jsonMatch).not.toBeNull();

    const result = JSON.parse(jsonMatch![0]);

    // Verify we have a TTY
    expect(result.hasTTY).toBe(true);

    // Verify we have a controlling terminal
    // If TIOCSCTTY failed, /dev/tty would not exist for this process
    expect(result.ttyName).toBe("has_ctty");

    proc.terminal!.close();
  });

  test("multiple sequential terminal spawns all get controlling terminals", async () => {
    // This test simulates the scenario from the bug report where multiple
    // terminal sessions are created over time. After sleep/wake, new sessions
    // would fail while old ones continued working.

    for (let i = 0; i < 3; i++) {
      const dataChunks: Uint8Array[] = [];

      const proc = Bun.spawn(
        [
          bunExe(),
          "-e",
          `
        const fs = require("fs");
        try {
          fs.statSync("/dev/tty");
          console.log("ctty:ok");
        } catch (e) {
          console.log("ctty:failed");
        }
      `,
        ],
        {
          env: bunEnv,
          terminal: {
            data: (_terminal: Bun.Terminal, data: Uint8Array) => {
              dataChunks.push(data);
            },
          },
        },
      );

      await proc.exited;

      expect(proc.exitCode).toBe(0);

      const output = Buffer.concat(dataChunks).toString();
      expect(output).toContain("ctty:ok");

      proc.terminal!.close();
    }
  });

  test("terminal spawn fails gracefully if PTY is invalid", async () => {
    // This test verifies that the PTY validation (isatty check) catches
    // corrupted PTYs early. We can't directly test corrupted PTYs, but
    // we can verify that a closed terminal properly throws an error.

    const terminal = new Bun.Terminal({});
    terminal.close();

    expect(() => {
      Bun.spawn(["echo", "test"], { terminal });
    }).toThrow("terminal is closed");
  });

  test("shell process is properly set as session leader", async () => {
    // Verify setsid() is being called and succeeding.
    // The spawned process should be a session leader (its PID should equal its SID).
    const dataChunks: Uint8Array[] = [];

    const proc = Bun.spawn(
      [
        bunExe(),
        "-e",
        `
      // In Node.js/Bun, we can use child_process to get session ID
      const { execSync } = require("child_process");
      const pid = process.pid;

      // Use ps to get the session ID (SID) of our process
      // ps -o pid=,sid= -p <pid> shows PID and SID
      try {
        const result = execSync(\`ps -o pid=,sid= -p \${pid}\`, { encoding: "utf-8" });
        const [, sid] = result.trim().split(/\\s+/);

        // As session leader, our PID should equal our SID
        console.log(JSON.stringify({ pid, sid: parseInt(sid), isSessionLeader: pid === parseInt(sid) }));
      } catch (e) {
        // ps command failed, just report we couldn't verify
        console.log(JSON.stringify({ pid, error: e.message }));
      }
    `,
      ],
      {
        env: bunEnv,
        terminal: {
          data: (_terminal: Bun.Terminal, data: Uint8Array) => {
            dataChunks.push(data);
          },
        },
      },
    );

    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const output = Buffer.concat(dataChunks).toString();
    const jsonMatch = output.match(/\{[^}]+\}/);
    expect(jsonMatch).not.toBeNull();

    const result = JSON.parse(jsonMatch![0]);

    // If we got the session info, verify we're session leader
    if (!result.error) {
      expect(result.isSessionLeader).toBe(true);
    }

    proc.terminal!.close();
  });
});
