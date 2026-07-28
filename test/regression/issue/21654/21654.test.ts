// https://github.com/oven-sh/bun/issues/21654
//
// When paused at a debugger breakpoint, BunInspectorConnection::runWhilePaused
// used a busy spin loop that pinned one CPU core at 100%. This test attaches a
// WebSocket inspector client, pauses at a `debugger;` statement, leaves the
// process paused for a couple of seconds, then resumes and asserts that the
// child process consumed very little CPU time while paused.

import { expect, test } from "bun:test";
import { isASAN, tempDir } from "harness";
import { enableAndWaitForDebuggerPause, spawnInspectorWS } from "../../../cli/inspect/inspector-ws-helper";

// The WebSocket inspector transport is known to be unreliable under the CI
// ASAN build (see test/expectations.txt: `cli/inspect/inspect.test.ts`), so
// skip there. The condvar fix being tested is in C++ and behaves identically
// with or without ASAN; it is still exercised on every other lane and on the
// local debug build (which is built with ASAN but named `bun-debug`).
test.skipIf(isASAN)(
  "does not spin at 100% CPU while paused at a breakpoint",
  async () => {
    const sampleMs = 2000;

    using dir = tempDir("issue-21654", {
      "index.js": `
      const before = process.cpuUsage();
      const start = process.hrtime.bigint();
      debugger;
      const cpu = process.cpuUsage(before);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      const cpuMs = (cpu.user + cpu.system) / 1000;
      process.stdout.write(JSON.stringify({ cpuMs, elapsedMs }) + "\\n");
      process.exit(0);
    `,
    });

    await using session = await spawnInspectorWS({ args: ["index.js"], cwd: String(dir), urlPath: "/bun21654" });
    const { send, proc, stderr } = session;

    try {
      const paused = await enableAndWaitForDebuggerPause(session);
      expect(paused.reason).toBe("DebuggerStatement");

      // Stay paused. In the buggy implementation this busy-loops at 100% CPU.
      await Bun.sleep(sampleMs);

      // Verify the debugger is still responsive while paused, and measure how
      // long a round-trip takes. The paused thread must wake promptly when the
      // debugger thread enqueues a message.
      const rtStart = performance.now();
      const evalResult = await send("Runtime.evaluate", { expression: "1 + 1" });
      const roundTripMs = performance.now() - rtStart;
      expect(evalResult?.result?.value).toBe(2);

      await send("Debugger.resume");

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      const line = stdout
        .split("\n")
        .map(l => l.trim())
        .find(l => l.startsWith("{"));
      if (!line) {
        throw new Error(
          `No JSON output from child; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr())}`,
        );
      }

      const { cpuMs, elapsedMs } = JSON.parse(line) as { cpuMs: number; elapsedMs: number };

      // The child was paused for at least `sampleMs`. With a spin loop, cpuMs
      // would be roughly equal to elapsedMs (~100% of one core). With a proper
      // blocking wait it should be near zero. Allow up to 50% to leave a huge
      // margin for slow / contended CI machines while still reliably catching
      // the spin-loop regression (which measures ~90-100%).
      const cpuPercent = (cpuMs / elapsedMs) * 100;
      expect(elapsedMs).toBeGreaterThanOrEqual(sampleMs * 0.9);
      expect(
        cpuPercent,
        `CPU usage while paused at breakpoint: ${cpuPercent.toFixed(1)}% ` +
          `(cpuMs=${cpuMs.toFixed(1)}, elapsedMs=${elapsedMs.toFixed(1)})`,
      ).toBeLessThan(50);

      // The round-trip while paused should be fast (well under the 1s safety
      // timeout on the condition variable) since the debugger thread notifies
      // the paused thread as soon as a message is enqueued.
      expect(roundTripMs).toBeLessThan(500);

      expect(exitCode).toBe(0);
    } catch (err) {
      // Surface child process diagnostics alongside any failure.
      const exitCode = proc.exitCode ?? proc.signalCode ?? "(running)";
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\n` +
          `  child exit: ${exitCode}\n` +
          `  child stderr: ${JSON.stringify(stderr())}`,
        { cause: err },
      );
    }
  },
  30000,
);
