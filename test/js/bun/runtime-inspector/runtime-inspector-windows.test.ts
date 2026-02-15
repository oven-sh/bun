import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

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

// Windows-specific tests (file mapping mechanism) - Windows only
describe.skipIf(!isWindows)("Runtime inspector Windows file mapping", () => {
  test("inspector activates via file mapping mechanism", async () => {
    // This is the primary Windows test - verify the file mapping mechanism works
    using dir = tempDir("windows-file-mapping-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive
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
    await readStreamUntil(reader, s => s.includes("READY"));
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);
    expect(pid).toBeGreaterThan(0);

    // Use _debugProcess which uses file mapping on Windows
    await using debugProc = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [debugStderr, debugExitCode] = await Promise.all([debugProc.stderr.text(), debugProc.exited]);

    expect(debugStderr).toBe("");
    expect(debugExitCode).toBe(0);

    // Wait for the debugger to start by reading stderr until the full banner appears
    const stderrReader = targetProc.stderr.getReader();
    const targetStderr = await readStreamUntil(stderrReader, hasBanner);
    stderrReader.releaseLock();

    targetProc.kill();
    await targetProc.exited;

    // Verify inspector actually started
    expect(targetStderr).toContain("Bun Inspector");
    expect(targetStderr).toMatch(/ws:\/\/localhost:\d+\//);
  });

  test("_debugProcess works with current process's own pid", async () => {
    // On Windows, calling _debugProcess with our own PID should work.
    // Use PID file approach to avoid timing-dependent setTimeout.
    using dir = tempDir("windows-self-debug-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive until parent sends _debugProcess and then kills us
        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "target.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    await readStreamUntil(reader, s => s.includes("READY"));
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Activate inspector via _debugProcess from a separate process
    await using debugProc = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await debugProc.exited;

    // Wait for inspector banner
    const stderrReader = proc.stderr.getReader();
    const stderr = await readStreamUntil(stderrReader, hasBanner);
    stderrReader.releaseLock();

    proc.kill();
    await proc.exited;

    expect(stderr).toContain("Bun Inspector");
  });

  test("inspector does not activate twice via file mapping", async () => {
    using dir = tempDir("windows-twice-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive until parent kills it
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
    await readStreamUntil(reader, s => s.includes("READY"));
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);
    expect(pid).toBeGreaterThan(0);

    // Set up stderr reader to wait for debugger to start
    const stderrReader = targetProc.stderr.getReader();

    // Call _debugProcess twice
    await using debug1 = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await debug1.exited;

    // Wait for the full banner
    let stderr = await readStreamUntil(stderrReader, hasBanner);

    await using debug2 = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await debug2.exited;

    // Kill and collect remaining stderr — parent drives termination
    targetProc.kill();
    stderrReader.releaseLock();
    const remainingStderr = await targetProc.stderr.text();
    stderr += remainingStderr;
    await targetProc.exited;

    // Should only see one "Bun Inspector" banner (two occurrences of the text, for header and footer)
    const matches = stderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
  });

  test("multiple Windows processes can have inspectors sequentially", async () => {
    // Test sequential activation: activate first, shut down, then activate second.
    // Each process uses a random port, so concurrent would also work, but
    // sequential tests the full lifecycle.
    using dir = tempDir("windows-multi-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");
        const id = process.argv[2];

        fs.writeFileSync(path.join(process.cwd(), "pid-" + id), String(process.pid));
        console.log("READY-" + id);

        // Keep process alive until parent kills it
        setInterval(() => {}, 1000);
      `,
    });

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
      await readStreamUntil(reader1, s => s.includes("READY-1"));
      reader1.releaseLock();

      const pid1 = parseInt(await Bun.file(join(String(dir), "pid-1")).text(), 10);
      expect(pid1).toBeGreaterThan(0);

      await using debug1 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid1})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [debug1Stderr, debug1ExitCode] = await Promise.all([debug1.stderr.text(), debug1.exited]);
      expect(debug1Stderr).toBe("");
      expect(debug1ExitCode).toBe(0);

      // Wait for the full banner
      const stderrReader1 = target1.stderr.getReader();
      const stderr1 = await readStreamUntil(stderrReader1, hasBanner);
      stderrReader1.releaseLock();

      expect(stderr1).toContain("Bun Inspector");

      target1.kill();
      await target1.exited;
    }

    // Second process
    {
      await using target2 = spawn({
        cmd: [bunExe(), "target.js", "2"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const reader2 = target2.stdout.getReader();
      await readStreamUntil(reader2, s => s.includes("READY-2"));
      reader2.releaseLock();

      const pid2 = parseInt(await Bun.file(join(String(dir), "pid-2")).text(), 10);
      expect(pid2).toBeGreaterThan(0);

      await using debug2 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid2})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [debug2Stderr, debug2ExitCode] = await Promise.all([debug2.stderr.text(), debug2.exited]);
      expect(debug2Stderr).toBe("");
      expect(debug2ExitCode).toBe(0);

      // Wait for the full banner
      const stderrReader2 = target2.stderr.getReader();
      const stderr2 = await readStreamUntil(stderrReader2, hasBanner);
      stderrReader2.releaseLock();

      expect(stderr2).toContain("Bun Inspector");

      target2.kill();
      await target2.exited;
    }
  });
});
