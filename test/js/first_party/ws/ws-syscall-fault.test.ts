import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const skip = !fault.available() || isWindows;

// The 'ws' module in Bun is a thirdparty shim over the native WebSocket
// client/server. These tests verify the shim's event surface (on('message'),
// on('error'), on('close')) under transport faults.

async function runWsFixture(body: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", body],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { ...JSON.parse(stdout.trim() || "{}"), stderr, exitCode, signal: proc.signalCode };
}

// Each test spawns an isolated subprocess (fault injection is per-process), so they run concurrently.
describe.concurrent.skipIf(skip)("ws (thirdparty) under injected syscall faults", () => {
  test("recv → short reads (1 byte) deliver complete echoed message", async () => {
    const r = await runWsFixture(/* js */ `
      const { WebSocketServer, WebSocket } = require("ws");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      wss.on("connection", ws => ws.on("message", m => ws.send(m)));
      wss.on("listening", () => {
        fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
        const c = new WebSocket("ws://127.0.0.1:" + wss.address().port);
        c.on("open", () => c.send("hello-ws"));
        c.on("message", m => {
          console.log(JSON.stringify({ ok: true, data: m.toString() }));
          c.close();
        });
        c.on("close", () => { fault.clear(); wss.close(() => process.exit(0)); });
        c.on("error", () => console.log(JSON.stringify({ ok: false })));
      });
    `);
    expect(r).toMatchObject({ ok: true, data: "hello-ws", signal: null, exitCode: 0 });
  });

  test("send → short writes (1 byte) deliver complete message and ping/pong round-trips", async () => {
    const r = await runWsFixture(/* js */ `
      const { WebSocketServer, WebSocket } = require("ws");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      wss.on("connection", ws => {
        ws.on("message", m => ws.send(m));
        ws.on("ping", () => {});
      });
      wss.on("listening", () => {
        fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
        const c = new WebSocket("ws://127.0.0.1:" + wss.address().port);
        // Report only once BOTH the echo and the pong have arrived: 'pong' is
        // a separate event with no ordering guarantee relative to 'message'.
        let pong = false, echoed = null;
        const report = () => {
          if (!pong || !echoed) return;
          console.log(JSON.stringify({ ok: true, len: echoed.length, pong }));
          c.close();
        };
        c.on("open", () => { c.ping(); c.send(Buffer.alloc(1024, 0x77)); });
        c.on("pong", () => { pong = true; report(); });
        c.on("message", m => { echoed = m; report(); });
        c.on("close", () => { fault.clear(); wss.close(() => process.exit(0)); });
        c.on("error", () => console.log(JSON.stringify({ ok: false })));
      });
    `);
    expect(r).toMatchObject({ ok: true, len: 1024, pong: true, signal: null, exitCode: 0 });
  });

  test("recv → ECONNRESET fires 'close' with abnormal code (split-process)", async () => {
    // Server runs in this process (no fault); client runs in a subprocess so
    // the process-global recv rule only affects the client side.
    const { WebSocketServer } = require("ws");
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    wss.on("connection", (ws: import("ws").WebSocket) => {
      ws.on("error", () => {});
      ws.send("x");
    });
    await new Promise<void>(r => wss.on("listening", () => r()));
    const port = (wss.address() as import("node:net").AddressInfo).port;
    try {
      const r = await runWsFixture(/* js */ `
        const { WebSocket } = require("ws");
        const { socketFaultInjection: fault } = require("bun:internal-for-testing");
        // Arm before connecting so the upgrade-response recv fails — that
        // exercises the same close(1006) path without depending on the
        // server to send a frame after 'open' (which races the arm).
        fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
        const c = new WebSocket("ws://127.0.0.1:${port}");
        let errored = false;
        c.on("open", () => {});
        c.on("error", () => { errored = true; });
        c.on("close", code => {
          console.log(JSON.stringify({ ok: true, errored, code }));
          fault.clear();
          process.exit(0);
        });
      `);
      expect(r.signal).toBeNull();
      expect(r.ok).toBe(true);
      expect(r.code).toBe(1006);
      expect(r.errored).toBe(true);
    } finally {
      await new Promise<void>(r => wss.close(() => r()));
    }
  });
});
