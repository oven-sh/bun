import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";

// ASAN builds have issues with signal handling reliability for SIGUSR1-based inspector activation
const skipASAN = isASAN;

// Timeout for waiting on stream reader loops (30s matches runtime-inspector.test.ts)
const STREAM_TIMEOUT_MS = 30_000;

// Helper: read from a stream until condition is met, with a timeout to prevent hanging
async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  condition: (output: string) => boolean,
  timeoutMs = STREAM_TIMEOUT_MS,
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  const startTime = Date.now();

  while (!condition(output)) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout after ${timeoutMs}ms waiting for stream condition. Got: "${output}"`);
    }
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output;
}

// Helper: wait for the full inspector banner (header + footer = 2 occurrences of "Bun Inspector")
function hasBanner(stderr: string): boolean {
  return (stderr.match(/Bun Inspector/g) || []).length >= 2;
}

// POSIX-specific tests (SIGUSR1 mechanism) - macOS and Linux only
describe.skipIf(isWindows)("Runtime inspector SIGUSR1 activation", () => {
  test.skipIf(skipASAN)("activates inspector when no user listener", async () => {
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
    await readStreamUntil(reader, s => s.includes("READY"));
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);
    expect(pid).toBeGreaterThan(0);

    // Send SIGUSR1
    process.kill(pid, "SIGUSR1");

    // Wait for inspector to activate by reading stderr until the full banner appears
    const stderrReader = proc.stderr.getReader();
    const stderr = await readStreamUntil(stderrReader, hasBanner);
    stderrReader.releaseLock();

    // Kill process
    proc.kill();
    await proc.exited;

    expect(stderr).toContain("Bun Inspector");
    expect(stderr).toMatch(/ws:\/\/localhost:\d+\//);
  });

  test("user SIGUSR1 listener takes precedence over inspector activation", async () => {
    using dir = tempDir("sigusr1-user-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        process.on("SIGUSR1", () => {
          console.log("USER_HANDLER_CALLED");
          // Exit cleanly after receiving the signal
          process.exit(0);
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
    let output = await readStreamUntil(reader, s => s.includes("READY"));

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

  test("multiple SIGUSR1s work after user installs handler", async () => {
    // After user installs their own SIGUSR1 handler, multiple signals should all
    // be delivered to the user handler correctly.
    using dir = tempDir("sigusr1-uninstall-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        let count = 0;
        process.on("SIGUSR1", () => {
          count++;
          console.log("SIGNAL_" + count);
          if (count >= 3) {
            // Exit cleanly after receiving all signals
            process.exit(0);
          }
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
    let output = await readStreamUntil(reader, s => s.includes("READY"));

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send SIGUSR1s and wait for each handler to respond before sending the next
    for (let i = 1; i <= 3; i++) {
      process.kill(pid, "SIGUSR1");
      // Wait for handler output before sending next signal
      while (!output.includes(`SIGNAL_${i}`)) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
    }

    // Read remaining output until process exits
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(output).toBe(`READY
SIGNAL_1
SIGNAL_2
SIGNAL_3
`);
    expect(stderr).not.toContain("Bun Inspector");
    expect(exitCode).toBe(0);
  });

  test.skipIf(skipASAN)("inspector does not activate twice via SIGUSR1", async () => {
    using dir = tempDir("sigusr1-twice-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive until test kills it
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
    await readStreamUntil(reader, s => s.includes("READY"));
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send first SIGUSR1 and wait for inspector to activate
    process.kill(pid, "SIGUSR1");

    const stderrReader = proc.stderr.getReader();
    let stderr = await readStreamUntil(stderrReader, hasBanner);

    // Send second SIGUSR1 - inspector should not activate again
    process.kill(pid, "SIGUSR1");

    // Kill process — the signal was delivered synchronously, so if a second banner
    // were going to appear it would already be queued. Killing and reading remaining
    // stderr is more reliable than sleeping.
    proc.kill();

    // Read any remaining stderr until process exits
    const stderrDecoder = new TextDecoder();
    while (true) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderr += stderrDecoder.decode(value, { stream: true });
    }
    stderr += stderrDecoder.decode();
    stderrReader.releaseLock();

    await proc.exited;

    // Should only see one "Bun Inspector" banner (two occurrences of the text, for header and footer)
    const matches = stderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
  });

  test.skipIf(skipASAN)("SIGUSR1 to self activates inspector", async () => {
    // Use a PID file approach instead of setTimeout to avoid timing-dependent self-signal
    using dir = tempDir("sigusr1-self-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        // Write PID so parent can send signal
        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive until test kills it
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

    const stdoutReader = proc.stdout.getReader();
    await readStreamUntil(stdoutReader, s => s.includes("READY"));
    stdoutReader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send SIGUSR1 from parent (equivalent to self-signal but without setTimeout race)
    process.kill(pid, "SIGUSR1");

    // Wait for inspector banner
    const reader = proc.stderr.getReader();
    const stderr = await readStreamUntil(reader, hasBanner);
    reader.releaseLock();

    proc.kill();
    await proc.exited;

    expect(stderr).toContain("Bun Inspector");
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

        // Keep process alive until parent kills it
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
    await readStreamUntil(reader, s => s.includes("READY"));
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Wait for the --inspect banner to appear before sending SIGUSR1
    const stderrReader = proc.stderr.getReader();
    let stderr = await readStreamUntil(stderrReader, hasBanner);

    // Send SIGUSR1 - should be ignored since RuntimeInspector is not installed
    process.kill(pid, "SIGUSR1");

    // Kill and collect remaining stderr — parent drives termination
    proc.kill();
    const stderrDecoder = new TextDecoder();
    while (true) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderr += stderrDecoder.decode(value, { stream: true });
    }
    stderrReader.releaseLock();
    await proc.exited;

    // Should only see one "Bun Inspector" banner (from --inspect flag, not from SIGUSR1)
    // The banner has two occurrences of "Bun Inspector" (header and footer)
    const matches = stderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
  });

  test("SIGUSR1 is ignored when started with --inspect-wait", async () => {
    // When the process is started with --inspect-wait, the debugger is already active.
    // Sending SIGUSR1 should NOT activate the inspector again.
    await using proc = spawn({
      cmd: [bunExe(), "--inspect-wait", "-e", "setInterval(() => {}, 1000)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stderr.getReader();
    const stderr = await readStreamUntil(reader, hasBanner);

    // Send SIGUSR1 - should be ignored since debugger is already active
    process.kill(proc.pid, "SIGUSR1");

    // Kill process since --inspect-wait would wait for connection
    // Signal processing is synchronous, so no sleep needed
    proc.kill();

    // Read any remaining stderr
    const decoder = new TextDecoder();
    let remaining = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      remaining += decoder.decode(value, { stream: true });
    }
    remaining += decoder.decode();
    reader.releaseLock();

    await proc.exited;

    // Should only see one "Bun Inspector" banner (from --inspect-wait flag, not from SIGUSR1)
    // The banner has two occurrences of "Bun Inspector" (header and footer)
    const fullStderr = stderr + remaining;
    const matches = fullStderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
  });

  test("SIGUSR1 is ignored when started with --inspect-brk", async () => {
    // When the process is started with --inspect-brk, the debugger is already active.
    // Sending SIGUSR1 should NOT activate the inspector again.
    await using proc = spawn({
      cmd: [bunExe(), "--inspect-brk", "-e", "setInterval(() => {}, 1000)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stderr.getReader();
    const stderr = await readStreamUntil(reader, hasBanner);

    // Send SIGUSR1 - should be ignored since debugger is already active
    process.kill(proc.pid, "SIGUSR1");

    // Kill process since --inspect-brk would wait for connection
    // Signal processing is synchronous, so no sleep needed
    proc.kill();

    // Read any remaining stderr
    const decoder = new TextDecoder();
    let remaining = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      remaining += decoder.decode(value, { stream: true });
    }
    remaining += decoder.decode();
    reader.releaseLock();

    await proc.exited;

    // Should only see one "Bun Inspector" banner (from --inspect-brk flag, not from SIGUSR1)
    // The banner has two occurrences of "Bun Inspector" (header and footer)
    const fullStderr = stderr + remaining;
    const matches = fullStderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
  });
});
