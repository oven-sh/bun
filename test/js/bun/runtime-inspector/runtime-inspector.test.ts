import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

/**
 * Reads from a stderr stream until "Debugger listening" appears.
 * Returns the accumulated stderr output.
 */
async function waitForDebuggerListening(
  stderrStream: ReadableStream<Uint8Array>,
): Promise<{ stderr: string; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = stderrStream.getReader();
  const decoder = new TextDecoder();
  let stderr = "";

  while (!stderr.includes("Debugger listening")) {
    const { value, done } = await reader.read();
    if (done) break;
    stderr += decoder.decode(value, { stream: true });
  }

  return { stderr, reader };
}

// Cross-platform tests - run on ALL platforms (Windows, macOS, Linux)
// Windows uses file mapping mechanism, POSIX uses SIGUSR1
describe("Runtime inspector activation", () => {
  describe("process._debugProcess", () => {
    test("activates inspector in target process", async () => {
      using dir = tempDir("debug-process-test", {
        "target.js": `
          const fs = require("fs");
          const path = require("path");

          // Write PID so parent can find us
          fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
          console.log("READY");

          // Keep process alive
          setInterval(() => {}, 1000);
        `,
      });

      // Start target process
      await using targetProc = spawn({
        cmd: [bunExe(), "target.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for target to be ready
      const reader = targetProc.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      while (!output.includes("READY")) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
      reader.releaseLock();

      const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

      // Use _debugProcess to activate inspector
      await using debugProc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [debugStderr, debugExitCode] = await Promise.all([debugProc.stderr.text(), debugProc.exited]);

      expect(debugStderr).toBe("");
      expect(debugExitCode).toBe(0);

      // Wait for inspector to activate by reading stderr until we see the message
      const { stderr: targetStderr, reader: stderrReader } = await waitForDebuggerListening(targetProc.stderr);
      stderrReader.releaseLock();

      // Kill target
      targetProc.kill();
      await targetProc.exited;

      expect(targetStderr).toContain("Debugger listening on ws://127.0.0.1:6499/");
    });

    test("throws error for non-existent process", async () => {
      // Use a PID that definitely doesn't exist
      const fakePid = 999999999;

      await using proc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${fakePid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Failed");
    });

    test("inspector does not activate twice", async () => {
      using dir = tempDir("debug-process-twice-test", {
        "target.js": `
          const fs = require("fs");
          const path = require("path");

          fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
          console.log("READY");

          // Keep process alive long enough for both _debugProcess calls
          setTimeout(() => process.exit(0), 5000);
          setInterval(() => {}, 1000);
        `,
      });

      await using targetProc = spawn({
        cmd: [bunExe(), "target.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const reader = targetProc.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      while (!output.includes("READY")) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
      reader.releaseLock();

      const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

      // Start reading stderr before triggering debugger
      const stderrReader = targetProc.stderr.getReader();
      const stderrDecoder = new TextDecoder();
      let stderr = "";

      // Call _debugProcess the first time
      await using debug1 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await debug1.exited;

      // Wait for the first debugger activation message
      while (!stderr.includes("Debugger listening")) {
        const { value, done } = await stderrReader.read();
        if (done) break;
        stderr += stderrDecoder.decode(value, { stream: true });
      }

      // Call _debugProcess again - inspector should not activate twice
      await using debug2 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await debug2.exited;

      // Release the reader and kill the target
      stderrReader.releaseLock();
      targetProc.kill();
      await targetProc.exited;

      // Should only see one "Debugger listening" message
      const matches = stderr.match(/Debugger listening/g);
      expect(matches?.length ?? 0).toBe(1);
    });

    test("can activate inspector in multiple independent processes", async () => {
      using dir = tempDir("debug-process-multi-test", {
        "target.js": `
          const fs = require("fs");
          const path = require("path");
          const id = process.argv[2];

          fs.writeFileSync(path.join(process.cwd(), "pid-" + id), String(process.pid));
          console.log("READY-" + id);

          // Keep alive long enough for _debugProcess call
          setTimeout(() => process.exit(0), 5000);
          setInterval(() => {}, 1000);
        `,
      });

      // Start two independent target processes
      await using target1 = spawn({
        cmd: [bunExe(), "target.js", "1"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await using target2 = spawn({
        cmd: [bunExe(), "target.js", "2"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for both to be ready
      const decoder = new TextDecoder();

      const reader1 = target1.stdout.getReader();
      let output1 = "";
      while (!output1.includes("READY-1")) {
        const { value, done } = await reader1.read();
        if (done) break;
        output1 += decoder.decode(value, { stream: true });
      }
      reader1.releaseLock();

      const reader2 = target2.stdout.getReader();
      let output2 = "";
      while (!output2.includes("READY-2")) {
        const { value, done } = await reader2.read();
        if (done) break;
        output2 += decoder.decode(value, { stream: true });
      }
      reader2.releaseLock();

      const pid1 = parseInt(await Bun.file(join(String(dir), "pid-1")).text(), 10);
      const pid2 = parseInt(await Bun.file(join(String(dir), "pid-2")).text(), 10);

      // Activate inspector in both processes
      await using debug1 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid1})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await using debug2 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid2})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await Promise.all([debug1.exited, debug2.exited]);

      // Wait for both inspectors to activate by reading stderr
      const [result1, result2] = await Promise.all([
        waitForDebuggerListening(target1.stderr),
        waitForDebuggerListening(target2.stderr),
      ]);

      result1.reader.releaseLock();
      result2.reader.releaseLock();

      // Kill both targets
      target1.kill();
      target2.kill();
      await Promise.all([target1.exited, target2.exited]);

      // Both should have activated their inspector
      expect(result1.stderr).toContain("Debugger listening");
      expect(result2.stderr).toContain("Debugger listening");
    });

    test("throws when called with no arguments", async () => {
      await using proc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess()`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("requires a pid argument");
    });
  });
});

// POSIX-only: --disable-sigusr1 test
// On POSIX, when --disable-sigusr1 is set, no SIGUSR1 handler is installed,
// so SIGUSR1 uses the default action (terminate process with exit code 128+30=158)
// This test is skipped on Windows since there's no SIGUSR1 signal there.

describe.skipIf(isWindows)("--disable-sigusr1", () => {
  test("prevents inspector activation and uses default signal behavior", async () => {
    using dir = tempDir("disable-sigusr1-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep alive long enough for signal to be sent
        setTimeout(() => process.exit(0), 5000);
        setInterval(() => {}, 1000);
      `,
    });

    // Start with --disable-sigusr1
    await using targetProc = spawn({
      cmd: [bunExe(), "--disable-sigusr1", "target.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = targetProc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send SIGUSR1 directly - without handler, this will terminate the process
    process.kill(pid, "SIGUSR1");

    const [stderr, exitCode] = await Promise.all([targetProc.stderr.text(), targetProc.exited]);

    // Should NOT see debugger listening message
    expect(stderr).not.toContain("Debugger listening");
    // Process should be terminated by SIGUSR1
    // Exit code = 128 + signal number (macOS: 30, Linux: 10)
    expect(exitCode === 158 || exitCode === 138).toBe(true);
  });
});
