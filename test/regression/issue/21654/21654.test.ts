// https://github.com/oven-sh/bun/issues/21654
//
// When paused at a debugger breakpoint, BunInspectorConnection::runWhilePaused
// used a busy spin loop that pinned one CPU core at 100%. This test attaches a
// WebSocket inspector client, pauses at a `debugger;` statement, leaves the
// process paused for a couple of seconds, then resumes and asserts that the
// child process consumed very little CPU time while paused.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--inspect-wait=ws://127.0.0.1:0/bun21654", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain stderr in the background so it never back-pressures the child, and
    // pull the WebSocket URL from the inspector banner. Only scan complete
    // (newline-terminated) lines so a chunk boundary can't yield a truncated
    // URL.
    let stderrBuf = "";
    let stderrLineBuf = "";
    const { promise: urlPromise, resolve: urlResolve, reject: urlReject } = Promise.withResolvers<URL>();
    let urlFound = false;
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
        const text = decoder.decode(chunk);
        stderrBuf += text;
        if (!urlFound) {
          stderrLineBuf += text;
          const lines = stderrLineBuf.split("\n");
          stderrLineBuf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const u = new URL(trimmed);
              if (u.protocol === "ws:" || u.protocol === "wss:") {
                urlFound = true;
                urlResolve(u);
                break;
              }
            } catch {}
          }
        }
      }
      if (!urlFound) {
        urlReject(new Error(`Inspector URL not found before child stderr closed: ${JSON.stringify(stderrBuf)}`));
      }
    })().catch(err => {
      if (!urlFound) urlReject(err);
    });

    const url = await urlPromise;

    const ws = new WebSocket(url);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", e => reject(new Error("WebSocket error", { cause: e })), { once: true });
        ws.addEventListener("close", e => reject(new Error("WebSocket closed", { cause: e })), { once: true });
      });

      let nextId = 1;
      type Waiter = { resolve: (value: any) => void; reject: (error: Error) => void };
      const pending = new Map<number, Waiter>();
      const eventWaiters = new Map<string, Waiter>();
      let closeError: Error | undefined;

      const failAll = (error: Error) => {
        if (closeError) return;
        closeError = error;
        for (const w of pending.values()) w.reject(error);
        pending.clear();
        for (const w of eventWaiters.values()) w.reject(error);
        eventWaiters.clear();
      };
      ws.addEventListener("error", e => failAll(new Error("WebSocket error", { cause: e })));
      ws.addEventListener("close", e => failAll(new Error(`WebSocket closed (${e.code})`, { cause: e })));

      ws.addEventListener("message", ev => {
        const msg = JSON.parse(String(ev.data));
        if (typeof msg.id === "number") {
          const w = pending.get(msg.id);
          if (w) {
            pending.delete(msg.id);
            w.resolve(msg);
          }
        } else if (typeof msg.method === "string") {
          const w = eventWaiters.get(msg.method);
          if (w) {
            eventWaiters.delete(msg.method);
            w.resolve(msg.params);
          }
        }
      });

      const send = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<any>((resolve, reject) => {
          if (closeError) return reject(closeError);
          const id = nextId++;
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        });

      const waitForEvent = (method: string) =>
        new Promise<any>((resolve, reject) => {
          if (closeError) return reject(closeError);
          eventWaiters.set(method, { resolve, reject });
        });

      // Enable the debugger and opt into pausing on `debugger;` statements.
      // Wait for the responses so we know the JS thread has fully processed
      // them before we send `Inspector.initialized`, which releases
      // --inspect-wait and lets the script begin executing.
      await Promise.all([
        send("Inspector.enable"),
        send("Debugger.enable"),
        send("Debugger.setBreakpointsActive", { active: true }),
        send("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
      ]);

      const pausedPromise = waitForEvent("Debugger.paused");
      send("Inspector.initialized").catch(() => {});

      const paused = await pausedPromise;
      expect(paused.reason).toBe("DebuggerStatement");

      // Stay paused. In the buggy implementation this busy-loops at 100% CPU.
      await Bun.sleep(sampleMs);

      // Verify the debugger is still responsive while paused, and measure how
      // long a round-trip takes. The paused thread must wake promptly when the
      // debugger thread enqueues a message.
      const rtStart = performance.now();
      const evalResult = await send("Runtime.evaluate", { expression: "1 + 1" });
      const roundTripMs = performance.now() - rtStart;
      expect(evalResult?.result?.result?.value).toBe(2);

      await send("Debugger.resume");

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      const line = stdout
        .split("\n")
        .map(l => l.trim())
        .find(l => l.startsWith("{"));
      if (!line) {
        throw new Error(
          `No JSON output from child; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderrBuf)}`,
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
          `  child stderr: ${JSON.stringify(stderrBuf)}`,
        { cause: err },
      );
    } finally {
      try {
        ws.close();
      } catch {}
    }
  },
  30000,
);
