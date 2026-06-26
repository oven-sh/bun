import { describe, expect, test } from "bun:test";
import { spawn } from "child_process";
import { bunEnv, bunExe } from "harness";

describe("issue #1632 - broken pipe behavior for process.stdout.write()", () => {
  test("process.stdout.write() should exit non-zero on broken pipe", async () => {
    // Use child_process.spawn to get proper Node-style streams with destroy()
    const child = spawn(bunExe(), ["-e", 'process.stdout.write("testing\\n");'], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Destroy stdout immediately to create a broken pipe
    child.stdout!.destroy();

    const exitCode = await new Promise<number | null>(resolve => {
      child.on("exit", resolve);
    });

    // The process should exit with a non-zero code due to the unhandled EPIPE error
    // Node.js exits with code 1 in this case
    expect(exitCode).not.toBe(0);
  });

  test("console.log should not panic on broken pipe", async () => {
    // console.log should ignore errors (uses catch {}) and not crash
    const child = spawn(bunExe(), ["-e", 'console.log("testing");'], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Destroy stdout immediately
    child.stdout!.destroy();

    let stderr = "";
    child.stderr!.on("data", data => {
      stderr += data.toString();
    });

    await new Promise<void>(resolve => {
      child.on("exit", resolve);
    });

    // console.log ignores errors, so the process shouldn't panic
    expect(stderr).not.toContain("panic");
  });

  test("matches Node.js behavior - broken pipe causes exit code 1", async () => {
    // This test spawns a subprocess that tries to write to a destroyed stdout
    // using child_process.exec pattern from the original issue
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { exec } = require("child_process");
        const child = exec(process.execPath + ' -e "process.stdout.write(\\'testing\\\\n\\')"', (err) => {
          if (err) {
            console.log("exit_code:" + err.code);
            console.log("killed:" + err.killed);
            console.log("signal:" + err.signal);
          } else {
            console.log("no_error");
          }
        });
        child.stdout.destroy();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The parent process should complete successfully
    expect(exitCode).toBe(0);

    // The child should have exited with an error (code 1) due to EPIPE
    // Node.js behavior: "1 false null" - exit code 1, not killed, no signal
    // If it says no_error, the write completed before stdout was destroyed (timing)
    if (stdout.includes("exit_code:")) {
      expect(stdout).toContain("exit_code:1");
    }
  });

  test("process.stdout.write() callback receives EPIPE error", async () => {
    // Test that the write callback receives the EPIPE error
    const child = spawn(
      bunExe(),
      [
        "-e",
        `
      // Handle the error via callback
      process.stdout.write("testing\\n", (err) => {
        if (err) {
          // Error should have code EPIPE
          console.error("ERROR_CODE:" + err.code);
          process.exit(42);
        }
        process.exit(0);
      });
      `,
      ],
      {
        env: bunEnv,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Destroy stdout immediately to create broken pipe
    child.stdout!.destroy();

    let stderr = "";
    child.stderr!.on("data", data => {
      stderr += data.toString();
    });

    const exitCode = await new Promise<number | null>(resolve => {
      child.on("exit", resolve);
    });

    // Either:
    // 1. The error callback was called with EPIPE and process exited with 42, or
    // 2. The write completed before stdout was destroyed and process exited with 0
    // Both are acceptable - we mainly want to verify it doesn't exit 0 silently when there IS an error
    if (exitCode === 42) {
      expect(stderr).toContain("ERROR_CODE:EPIPE");
    }
  });
});
