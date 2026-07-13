// close()/terminate() during CONNECTING must transition to CLOSED, fire
// error + close events, and release the pending-activity ref so the
// WebSocket can be garbage-collected. Previously the Zig upgrade client
// was cancelled without any completion callback reaching C++, leaving
// the socket stuck in CLOSING with hasPendingActivity() permanently true
// — never GC'd, close event never fired, process never exited.

import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { createServer, type AddressInfo } from "net";

describe.each(["close", "terminate"] as const)("%s() during CONNECTING", method => {
  it("fires error + close events and transitions to CLOSED", async () => {
    // TCP server that accepts connections but never responds — keeps the
    // WebSocket in CONNECTING until we abort it.
    const listening = Promise.withResolvers<void>();
    const server = createServer(() => {}).listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    try {
      const port = (server.address() as AddressInfo).port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      expect(ws.readyState).toBe(WebSocket.CONNECTING);

      const events: { type: string; message?: string }[] = [];
      ws.onerror = e => events.push({ type: e.type, message: (e as ErrorEvent).message });
      const closed = new Promise<CloseEvent>(resolve => {
        ws.onclose = e => {
          events.push({ type: e.type });
          resolve(e);
        };
      });

      ws[method]();
      expect(ws.readyState).toBe(WebSocket.CLOSING);

      const ev = await closed;
      // Spec "fail the WebSocket connection": error event then close event.
      expect(events.map(e => e.type)).toEqual(["error", "close"]);
      expect(events[0].message).toContain("closed before the connection is established");
      expect({
        readyState: ws.readyState,
        code: ev.code,
        wasClean: ev.wasClean,
      }).toEqual({
        readyState: WebSocket.CLOSED,
        code: 1006,
        wasClean: false,
      });
    } finally {
      server.close();
    }
  });

  it("does not leak", async () => {
    function getWebSocketCount() {
      Bun.gc(true);
      return heapStats().objectTypeCounts?.WebSocket || 0;
    }

    const listening = Promise.withResolvers<void>();
    const server = createServer(() => {}).listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    try {
      const port = (server.address() as AddressInfo).port;
      const before = getWebSocketCount();

      const closes: Promise<unknown>[] = [];
      for (let i = 0; i < 64; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        closes.push(new Promise(resolve => (ws.onclose = resolve)));
        ws[method]();
      }
      await Promise.all(closes);

      // disablePendingActivity is posted as a separate task after the close
      // event fires; drain those plus any pending socket-close callbacks
      // before counting. Without the fix, all 64 instances remain alive.
      let after: number;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setImmediate(resolve));
        after = getWebSocketCount();
        if (after - before <= 5) break;
      }

      expect(after! - before).toBeLessThanOrEqual(5);
    } finally {
      server.close();
    }
  });
});

// A refused connect must fire error + close AND close the half-open socket in
// the core: detaching the handle before the close used to leave the failed fd
// registered forever — leaking one fd per attempt and spinning the event loop.
describe("failed connect (connection refused)", () => {
  it("fires error + close without leaking fds or spinning the event loop", async () => {
    // Grab a port that nothing listens on: bind, read it back, close.
    const listening = Promise.withResolvers<void>();
    const server = createServer(() => {}).listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    const port = (server.address() as AddressInfo).port;
    await new Promise(resolve => server.close(resolve));

    const src = `
      const fs = require("node:fs");
      const fdDir = process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd";
      const countFds = () => (process.platform === "win32" ? 0 : fs.readdirSync(fdDir).length);

      function failedConnect() {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket("ws://127.0.0.1:${port}");
          let errored = false;
          ws.onopen = () => reject(new Error("unexpected open"));
          ws.onerror = () => { errored = true; };
          ws.onclose = () => resolve(errored);
        });
      }

      const errored = await failedConnect();
      const before = countFds();
      for (let i = 0; i < 20; i++) await failedConnect();
      const after = countFds();

      // Spin check: with every failed socket closed, sleeping should use
      // almost no CPU; a leaked half-open fd keeps the poller hot.
      const t0 = performance.now();
      const cpu0 = process.cpuUsage();
      while (performance.now() - t0 < 250) await Bun.sleep(25);
      const wallMs = performance.now() - t0;
      const cpu = process.cpuUsage(cpu0);
      console.log(JSON.stringify({ errored, fdGrowth: after - before, cpuMs: (cpu.user + cpu.system) / 1000, wallMs }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim() || "{}");
    expect({ errored: result.errored, stderr: exitCode === 0 ? "" : stderr }).toEqual({ errored: true, stderr: "" });
    if (!isWindows) {
      expect(result.fdGrowth).toBeLessThanOrEqual(2);
    }
    expect(result.cpuMs).toBeLessThan(result.wallMs * 0.5);
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });
});
