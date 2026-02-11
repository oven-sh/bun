import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";

// ASAN builds have issues with signal handling reliability for SIGUSR1-based inspector activation
const skipASAN = isASAN;

/**
 * Reads from a stderr stream until the full Bun Inspector banner appears.
 * The banner has "Bun Inspector" in both header and footer lines.
 * Returns the accumulated stderr output.
 */
async function waitForDebuggerListening(
  stderrStream: ReadableStream<Uint8Array>,
  timeoutMs: number = 30000,
): Promise<{ stderr: string }> {
  const reader = stderrStream.getReader();
  const decoder = new TextDecoder();
  let stderr = "";

  const startTime = Date.now();

  // Wait for the full banner (header + content + footer)
  // The banner format is:
  // --------------------- Bun Inspector ---------------------
  // Listening:
  //   ws://localhost:6499/...
  // Inspect in browser:
  //   https://debug.bun.sh/#localhost:6499/...
  // --------------------- Bun Inspector ---------------------
  try {
    while ((stderr.match(/Bun Inspector/g) || []).length < 2) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout waiting for Bun Inspector banner after ${timeoutMs}ms. Got stderr: "${stderr}"`);
      }

      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }
  } finally {
    // Cancel the reader to avoid "Stream reader cancelled via releaseLock()" errors
    await reader.cancel();
    reader.releaseLock();
  }

  return { stderr };
}

// Cross-platform tests - run on ALL platforms (Windows, macOS, Linux)
// Windows uses file mapping mechanism, POSIX uses SIGUSR1
describe("Runtime inspector activation", () => {
  describe("process._debugProcess", () => {
    test.skipIf(skipASAN)("activates inspector in target process", async () => {
      // Start target process - prints PID to stdout then stays alive
      await using targetProc = spawn({
        cmd: [bunExe(), "-e", `console.log(process.pid); setInterval(() => {}, 1000);`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Read PID from stdout (confirms JS is executing)
      const reader = targetProc.stdout.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      const pid = parseInt(new TextDecoder().decode(value).trim(), 10);

      // Use _debugProcess to activate inspector
      await using debugProc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const debugStderr = await debugProc.stderr.text();
      expect(debugStderr).toBe("");
      expect(await debugProc.exited).toBe(0);

      // Wait for inspector to activate by reading stderr until we see the message
      const { stderr: targetStderr } = await waitForDebuggerListening(targetProc.stderr);

      // Kill target
      targetProc.kill();
      await targetProc.exited;

      expect(targetStderr).toContain("Bun Inspector");
      expect(targetStderr).toMatch(/ws:\/\/localhost:\d+\//);
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

      const stderr = await proc.stderr.text();
      expect(stderr).toContain("Failed");
      expect(await proc.exited).not.toBe(0);
    });

    test.skipIf(skipASAN)("inspector does not activate twice", async () => {
      // Start target process - prints PID to stdout then stays alive
      await using targetProc = spawn({
        cmd: [bunExe(), "-e", `console.log(process.pid); setInterval(() => {}, 1000);`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Read PID from stdout (confirms JS is executing)
      const reader = targetProc.stdout.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      const pid = parseInt(new TextDecoder().decode(value).trim(), 10);

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
      const debug1Stderr = await debug1.stderr.text();
      expect(debug1Stderr).toBe("");
      expect(await debug1.exited).toBe(0);

      // Wait for the full debugger banner (header + content + footer) with timeout
      const bannerStartTime = Date.now();
      const bannerTimeout = 30000;
      while ((stderr.match(/Bun Inspector/g) || []).length < 2) {
        if (Date.now() - bannerStartTime > bannerTimeout) {
          throw new Error(`Timeout waiting for inspector banner. Got: "${stderr}"`);
        }
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
      const debug2Stderr = await debug2.stderr.text();
      expect(debug2Stderr).toBe("");
      expect(await debug2.exited).toBe(0);

      // Release the reader and kill the target
      stderrReader.releaseLock();
      targetProc.kill();
      await targetProc.exited;

      // Should only see one "Bun Inspector" banner (two occurrences of the text, for header and footer)
      const matches = stderr.match(/Bun Inspector/g);
      expect(matches?.length ?? 0).toBe(2);
    });

    test.skipIf(skipASAN)("can activate inspector in multiple processes sequentially", async () => {
      // Note: Runtime inspector uses hardcoded port 6499, so we must test
      // sequential activation (activate first, shut down, then activate second)
      // rather than concurrent activation.
      const targetScript = `console.log(process.pid); setInterval(() => {}, 1000);`;

      // First process: activate inspector, verify, then shut down
      {
        await using target1 = spawn({
          cmd: [bunExe(), "-e", targetScript],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const reader1 = target1.stdout.getReader();
        const { value: v1 } = await reader1.read();
        reader1.releaseLock();
        const pid1 = parseInt(new TextDecoder().decode(v1).trim(), 10);
        expect(pid1).toBeGreaterThan(0);

        await using debug1 = spawn({
          cmd: [bunExe(), "-e", `process._debugProcess(${pid1})`],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const debug1Stderr = await debug1.stderr.text();
        expect(debug1Stderr).toBe("");
        expect(await debug1.exited).toBe(0);

        const result1 = await waitForDebuggerListening(target1.stderr);

        expect(result1.stderr).toContain("Bun Inspector");

        target1.kill();
        await target1.exited;
      }

      // Second process: now that first is shut down, port 6499 is free
      {
        await using target2 = spawn({
          cmd: [bunExe(), "-e", targetScript],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const reader2 = target2.stdout.getReader();
        const { value: v2 } = await reader2.read();
        reader2.releaseLock();
        const pid2 = parseInt(new TextDecoder().decode(v2).trim(), 10);
        expect(pid2).toBeGreaterThan(0);

        await using debug2 = spawn({
          cmd: [bunExe(), "-e", `process._debugProcess(${pid2})`],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const debug2Stderr = await debug2.stderr.text();
        expect(debug2Stderr).toBe("");
        expect(await debug2.exited).toBe(0);

        const result2 = await waitForDebuggerListening(target2.stderr);

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

      const stderr = await proc.stderr.text();
      expect(stderr).toContain("requires a pid argument");
      expect(await proc.exited).not.toBe(0);
    });

    test.skipIf(skipASAN)("can interrupt an infinite loop", async () => {
      // Start target process with infinite loop
      await using targetProc = spawn({
        cmd: [bunExe(), "-e", `console.log(process.pid); while (true) {}`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Read PID from stdout (written before the infinite loop starts)
      const reader = targetProc.stdout.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      const pid = parseInt(new TextDecoder().decode(value).trim(), 10);
      expect(pid).toBeGreaterThan(0);

      // Use _debugProcess to activate inspector - this should interrupt the infinite loop
      await using debugProc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const debugStderr = await debugProc.stderr.text();
      expect(debugStderr).toBe("");
      expect(await debugProc.exited).toBe(0);

      // Wait for inspector to activate - this proves we interrupted the infinite loop
      const { stderr: targetStderr } = await waitForDebuggerListening(targetProc.stderr);

      // Kill target
      targetProc.kill();
      await targetProc.exited;

      expect(targetStderr).toContain("Bun Inspector");
      expect(targetStderr).toMatch(/ws:\/\/localhost:\d+\//);
    });

    test.skipIf(skipASAN)("can pause execution during while(true) via CDP", async () => {
      // Start target process with infinite loop
      await using targetProc = spawn({
        cmd: [bunExe(), "-e", `console.log(process.pid); while (true) {}`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Read PID from stdout (written before the infinite loop starts)
      const reader = targetProc.stdout.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      const pid = parseInt(new TextDecoder().decode(value).trim(), 10);
      expect(pid).toBeGreaterThan(0);

      // Activate inspector via _debugProcess
      await using debugProc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const debugStderr = await debugProc.stderr.text();
      expect(debugStderr).toBe("");
      expect(await debugProc.exited).toBe(0);

      // Wait for inspector to activate and extract WebSocket URL
      const { stderr: targetStderr } = await waitForDebuggerListening(targetProc.stderr);
      const wsMatch = targetStderr.match(/ws:\/\/[^\s]+/);
      expect(wsMatch).not.toBeNull();
      const wsUrl = wsMatch![0];

      // Connect via WebSocket to the inspector
      const ws = new WebSocket(wsUrl);
      const { promise: openPromise, resolve: openResolve, reject: openReject } = Promise.withResolvers<void>();
      ws.onopen = () => openResolve();
      ws.onerror = e => openReject(e);
      await openPromise;

      try {
        let msgId = 1;
        const pendingResponses = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
        const { promise: pausedPromise, resolve: pausedResolve } = Promise.withResolvers<any>();

        ws.onmessage = event => {
          const msg = JSON.parse(event.data as string);
          if (msg.id !== undefined) {
            const pending = pendingResponses.get(msg.id);
            if (pending) {
              pendingResponses.delete(msg.id);
              pending.resolve(msg);
            }
          }
          if (msg.method === "Debugger.paused") {
            pausedResolve(msg);
          }
        };

        function sendCDP(method: string, params: Record<string, any> = {}): Promise<any> {
          const id = msgId++;
          const { promise, resolve, reject } = Promise.withResolvers<any>();
          pendingResponses.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
          return promise;
        }

        // Enable Runtime and Debugger domains
        await sendCDP("Runtime.enable");
        await sendCDP("Debugger.enable");

        // Request pause - this should interrupt the while(true) loop
        await sendCDP("Debugger.pause");

        // Wait for Debugger.paused event (proves the JS thread was interrupted and paused)
        const pausedEvent = await pausedPromise;
        expect(pausedEvent.method).toBe("Debugger.paused");

        // Resume execution
        await sendCDP("Debugger.resume");
      } finally {
        ws.close();
        targetProc.kill();
        await targetProc.exited;
      }
    });

    test.skipIf(skipASAN)("CDP messages work after client reconnects", async () => {
      // Start target process - prints PID to stdout then stays alive
      await using targetProc = spawn({
        cmd: [bunExe(), "-e", `console.log(process.pid); setInterval(() => {}, 1000);`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Read PID from stdout (confirms JS is executing)
      const reader = targetProc.stdout.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      const pid = parseInt(new TextDecoder().decode(value).trim(), 10);
      expect(pid).toBeGreaterThan(0);

      // Activate inspector via _debugProcess
      await using debugProc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await debugProc.exited).toBe(0);

      // Wait for inspector banner and extract WS URL
      const { stderr: targetStderr } = await waitForDebuggerListening(targetProc.stderr);
      const wsMatch = targetStderr.match(/ws:\/\/[^\s]+/);
      expect(wsMatch).not.toBeNull();
      const wsUrl = wsMatch![0];

      // Helper to create a CDP WebSocket client
      function createCDPClient(url: string) {
        const ws = new WebSocket(url);
        let msgId = 1;
        const pendingResponses = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

        ws.onmessage = event => {
          const msg = JSON.parse(event.data as string);
          if (msg.id !== undefined) {
            const pending = pendingResponses.get(msg.id);
            if (pending) {
              pendingResponses.delete(msg.id);
              pending.resolve(msg);
            }
          }
        };

        function sendCDP(method: string, params: Record<string, any> = {}): Promise<any> {
          const id = msgId++;
          const { promise, resolve, reject } = Promise.withResolvers<any>();
          pendingResponses.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
          return promise;
        }

        async function waitForOpen(): Promise<void> {
          const { promise, resolve, reject } = Promise.withResolvers<void>();
          ws.onopen = () => resolve();
          ws.onerror = e => reject(e);
          return promise;
        }

        return { ws, sendCDP, waitForOpen };
      }

      // First connection: verify CDP works
      const client1 = createCDPClient(wsUrl);
      await client1.waitForOpen();

      const result1 = await client1.sendCDP("Runtime.evaluate", { expression: "1 + 1" });
      expect(result1.result.result.value).toBe(2);

      const { promise, resolve } = Promise.withResolvers<void>();
      client1.ws.onclose = () => resolve();
      client1.ws.close();
      await promise;

      // Second connection: verify CDP still works after reconnect
      const client2 = createCDPClient(wsUrl);
      await client2.waitForOpen();

      const result2 = await client2.sendCDP("Runtime.evaluate", { expression: "2 + 3" });
      expect(result2.result.result.value).toBe(5);

      client2.ws.close();
      targetProc.kill();
      await targetProc.exited;
    });
  });
});

// POSIX-only: --disable-sigusr1 test
// On POSIX, when --disable-sigusr1 is set, no SIGUSR1 handler is installed,
// so SIGUSR1 uses the default action (terminate process with exit code 128+30=158)
// This test is skipped on Windows since there's no SIGUSR1 signal there.

describe.skipIf(isWindows)("--disable-sigusr1", () => {
  test("prevents inspector activation and uses default signal behavior", async () => {
    // Start with --disable-sigusr1 - prints PID to stdout then stays alive
    await using targetProc = spawn({
      cmd: [bunExe(), "--disable-sigusr1", "-e", `console.log(process.pid); setInterval(() => {}, 1000);`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read PID from stdout (confirms JS is executing)
    const reader = targetProc.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    const pid = parseInt(new TextDecoder().decode(value).trim(), 10);

    // Send SIGUSR1 directly - without handler, this will terminate the process
    process.kill(pid, "SIGUSR1");

    const stderr = await targetProc.stderr.text();
    // Should NOT see Bun Inspector banner
    expect(stderr).not.toContain("Bun Inspector");
    // Process should be terminated by SIGUSR1
    // Exit code = 128 + signal number (macOS: SIGUSR1=30 -> 158, Linux: SIGUSR1=10 -> 138)
    expect(await targetProc.exited).toBeOneOf([158, 138]);
  });
});
