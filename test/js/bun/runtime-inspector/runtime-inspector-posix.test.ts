import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// POSIX-specific tests (SIGUSR1 mechanism) - macOS and Linux only
describe.skipIf(isWindows)("Runtime inspector SIGUSR1 activation", () => {
  test("activates inspector when no user listener", async () => {
    using dir = tempDir("sigusr1-activate-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        // Write PID so parent can send signal
        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive
        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send SIGUSR1
    process.kill(pid, "SIGUSR1");

    // Wait for inspector to activate by reading stderr until "Debugger listening" appears
    const stderrReader = proc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    let stderr = "";

    while (!stderr.includes("Debugger listening")) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderr += stderrDecoder.decode(value, { stream: true });
    }
    stderrReader.releaseLock();

    // Kill process
    proc.kill();
    await proc.exited;

    expect(stderr).toContain("Debugger listening on ws://127.0.0.1:6499/");
  });

  test("user SIGUSR1 listener takes precedence over inspector activation", async () => {
    using dir = tempDir("sigusr1-user-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        process.on("SIGUSR1", () => {
          console.log("USER_HANDLER_CALLED");
          setTimeout(() => process.exit(0), 100);
        });

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    process.kill(pid, "SIGUSR1");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(output).toContain("USER_HANDLER_CALLED");
    expect(stderr).not.toContain("Debugger listening");
    expect(exitCode).toBe(0);
  });

  test("inspector does not activate twice via SIGUSR1", async () => {
    using dir = tempDir("sigusr1-twice-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive, exit after a bit
        setTimeout(() => process.exit(0), 500);
        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send first SIGUSR1 and wait for inspector to activate
    process.kill(pid, "SIGUSR1");

    const stderrReader = proc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    let stderr = "";

    // Wait until we see "Debugger listening" before sending second signal
    while (!stderr.includes("Debugger listening")) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderr += stderrDecoder.decode(value, { stream: true });
    }

    // Send second SIGUSR1 - inspector should not activate again
    process.kill(pid, "SIGUSR1");

    // Read any remaining stderr until process exits
    stderrReader.releaseLock();
    const [remainingStderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    stderr += remainingStderr;

    // Should only see one "Debugger listening" message
    const matches = stderr.match(/Debugger listening/g);
    expect(matches?.length ?? 0).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("SIGUSR1 to self activates inspector", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        setTimeout(() => process.exit(0), 300);
        // Small delay to ensure handler is installed
        setTimeout(() => {
          process.kill(process.pid, "SIGUSR1");
        }, 50);
        setInterval(() => {}, 1000);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Debugger listening");
    expect(exitCode).toBe(0);
  });

  test("SIGUSR1 is ignored when started with --inspect", async () => {
    // When the process is started with --inspect, the debugger is already active.
    // The RuntimeInspector signal handler should NOT be installed, so SIGUSR1
    // should have no effect (default action is terminate, but signal may be ignored).
    using dir = tempDir("sigusr1-inspect-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        setTimeout(() => process.exit(0), 500);
        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "--inspect", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send SIGUSR1 - should be ignored since RuntimeInspector is not installed
    process.kill(pid, "SIGUSR1");

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // RuntimeInspector's "Debugger listening" should NOT appear because the signal
    // handler was never installed (debugger was already enabled via --inspect).
    expect(stderr).not.toContain("Debugger listening");
    expect(exitCode).toBe(0);
  });

  test("SIGUSR1 is ignored when started with --inspect-wait", async () => {
    // When the process is started with --inspect-wait, the debugger is already active.
    // Sending SIGUSR1 should NOT print the RuntimeInspector's "Debugger listening" message.
    // Note: The standard debugger prints "Bun Inspector" and "Listening:", not "Debugger listening".
    await using proc = spawn({
      cmd: [bunExe(), "--inspect-wait", "-e", "setTimeout(() => process.exit(0), 500)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for standard "Bun Inspector" message in stderr
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let stderr = "";

    while (!stderr.includes("Bun Inspector")) {
      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }

    // Send SIGUSR1 - should be ignored since debugger is already active
    process.kill(proc.pid, "SIGUSR1");

    // Kill process since --inspect-wait would wait for connection
    // Signal processing is synchronous, so no sleep needed
    proc.kill();

    // Read any remaining stderr
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }
    stderr += decoder.decode();
    reader.releaseLock();

    await proc.exited;

    // SIGUSR1 should NOT trigger RuntimeInspector's "Debugger listening" message
    // because the debugger was already started via --inspect-wait flag
    expect(stderr).not.toContain("Debugger listening");
    // Verify the standard debugger message IS present
    expect(stderr).toContain("Bun Inspector");
  });

  test("SIGUSR1 is ignored when started with --inspect-brk", async () => {
    // When the process is started with --inspect-brk, the debugger is already active.
    // Sending SIGUSR1 should NOT print the RuntimeInspector's "Debugger listening" message.
    // Note: The standard debugger prints "Bun Inspector" and "Listening:", not "Debugger listening".
    await using proc = spawn({
      cmd: [bunExe(), "--inspect-brk", "-e", "setTimeout(() => process.exit(0), 500)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for standard "Bun Inspector" message in stderr
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let stderr = "";

    while (!stderr.includes("Bun Inspector")) {
      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }

    // Send SIGUSR1 - should be ignored since debugger is already active
    process.kill(proc.pid, "SIGUSR1");

    // Kill process since --inspect-brk would wait for connection
    // Signal processing is synchronous, so no sleep needed
    proc.kill();

    // Read any remaining stderr
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }
    stderr += decoder.decode();
    reader.releaseLock();

    await proc.exited;

    // SIGUSR1 should NOT trigger RuntimeInspector's "Debugger listening" message
    // because the debugger was already started via --inspect-brk flag
    expect(stderr).not.toContain("Debugger listening");
    // Verify the standard debugger message IS present
    expect(stderr).toContain("Bun Inspector");
  });
});
