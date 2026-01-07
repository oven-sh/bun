import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

/**
 * Reads from a stderr stream until the full Bun Inspector banner appears.
 * The banner has "Bun Inspector" in both header and footer lines.
 * Returns the accumulated stderr output.
 */
async function waitForDebuggerListening(
  stderrStream: ReadableStream<Uint8Array>,
): Promise<{ stderr: string; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = stderrStream.getReader();
  const decoder = new TextDecoder();
  let stderr = "";

  // Wait for the full banner (header + content + footer)
  // The banner format is:
  // --------------------- Bun Inspector ---------------------
  // Listening:
  //   ws://localhost:6499/...
  // Inspect in browser:
  //   https://debug.bun.sh/#localhost:6499/...
  // --------------------- Bun Inspector ---------------------
  while ((stderr.match(/Bun Inspector/g) || []).length < 2) {
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

      expect(targetStderr).toContain("Bun Inspector");
      expect(targetStderr).toContain("ws://localhost:6499/");
    });

    test.todoIf(isWindows)("throws error for non-existent process", async () => {
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
      expect(await debug1.exited).toBe(0);

      // Wait for the full debugger banner (header + content + footer)
      while ((stderr.match(/Bun Inspector/g) || []).length < 2) {
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
      expect(await debug2.exited).toBe(0);

      // Release the reader and kill the target
      stderrReader.releaseLock();
      targetProc.kill();
      await targetProc.exited;

      // Should only see one "Bun Inspector" banner (two occurrences of the text, for header and footer)
      const matches = stderr.match(/Bun Inspector/g);
      expect(matches?.length ?? 0).toBe(2);
    });

    test("can activate inspector in multiple processes sequentially", async () => {
      // Note: Runtime inspector uses hardcoded port 6499, so we must test
      // sequential activation (activate first, shut down, then activate second)
      // rather than concurrent activation.
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

      const decoder = new TextDecoder();

      // First process: activate inspector, verify, then shut down
      {
        await using target1 = spawn({
          cmd: [bunExe(), "target.js", "1"],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const reader1 = target1.stdout.getReader();
        let output1 = "";
        while (!output1.includes("READY-1")) {
          const { value, done } = await reader1.read();
          if (done) break;
          output1 += decoder.decode(value, { stream: true });
        }
        reader1.releaseLock();

        const pid1 = parseInt(await Bun.file(join(String(dir), "pid-1")).text(), 10);
        expect(pid1).toBeGreaterThan(0);

        await using debug1 = spawn({
          cmd: [bunExe(), "-e", `process._debugProcess(${pid1})`],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        expect(await debug1.exited).toBe(0);

        const result1 = await waitForDebuggerListening(target1.stderr);
        result1.reader.releaseLock();

        expect(result1.stderr).toContain("Bun Inspector");

        target1.kill();
        await target1.exited;
      }

      // Second process: now that first is shut down, port 6499 is free
      {
        await using target2 = spawn({
          cmd: [bunExe(), "target.js", "2"],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const reader2 = target2.stdout.getReader();
        let output2 = "";
        while (!output2.includes("READY-2")) {
          const { value, done } = await reader2.read();
          if (done) break;
          output2 += decoder.decode(value, { stream: true });
        }
        reader2.releaseLock();

        const pid2 = parseInt(await Bun.file(join(String(dir), "pid-2")).text(), 10);
        expect(pid2).toBeGreaterThan(0);

        await using debug2 = spawn({
          cmd: [bunExe(), "-e", `process._debugProcess(${pid2})`],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        expect(await debug2.exited).toBe(0);

        const result2 = await waitForDebuggerListening(target2.stderr);
        result2.reader.releaseLock();

        expect(result2.stderr).toContain("Bun Inspector");

        target2.kill();
        await target2.exited;
      }
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
    // Exit code = 128 + signal number (macOS: SIGUSR1=30 -> 158, Linux: SIGUSR1=10 -> 138)
    expect(exitCode).toBeOneOf([158, 138]);
  });
});
