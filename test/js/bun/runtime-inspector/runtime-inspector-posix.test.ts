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
    expect(pid).toBeGreaterThan(0);

    // Send SIGUSR1
    process.kill(pid, "SIGUSR1");

    // Wait for inspector to activate by reading stderr until the full banner appears
    const stderrReader = proc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    let stderr = "";

    // Wait for the full banner (header + content + footer)
    while ((stderr.match(/Bun Inspector/g) || []).length < 2) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderr += stderrDecoder.decode(value, { stream: true });
    }
    stderrReader.releaseLock();

    // Kill process
    proc.kill();
    await proc.exited;

    expect(stderr).toContain("Bun Inspector");
    expect(stderr).toContain("ws://localhost:6499/");
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
    expect(stderr).not.toContain("Bun Inspector");
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

    // Wait for the full banner (header + content + footer) before sending second signal
    while ((stderr.match(/Bun Inspector/g) || []).length < 2) {
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

    // Should only see one "Bun Inspector" banner (two occurrences of the text, for header and footer)
    const matches = stderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
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

    expect(stderr).toContain("Bun Inspector");
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

    // Should only see one "Bun Inspector" banner (from --inspect flag, not from SIGUSR1)
    // The banner has two occurrences of "Bun Inspector" (header and footer)
    const matches = stderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
    expect(exitCode).toBe(0);
  });

  test("SIGUSR1 is ignored when started with --inspect-wait", async () => {
    // When the process is started with --inspect-wait, the debugger is already active.
    // Sending SIGUSR1 should NOT activate the inspector again.
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

    // Should only see one "Bun Inspector" banner (from --inspect-wait flag, not from SIGUSR1)
    // The banner has two occurrences of "Bun Inspector" (header and footer)
    const matches = stderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
  });

  test("SIGUSR1 is ignored when started with --inspect-brk", async () => {
    // When the process is started with --inspect-brk, the debugger is already active.
    // Sending SIGUSR1 should NOT activate the inspector again.
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

    // Should only see one "Bun Inspector" banner (from --inspect-brk flag, not from SIGUSR1)
    // The banner has two occurrences of "Bun Inspector" (header and footer)
    const matches = stderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
  });
});
