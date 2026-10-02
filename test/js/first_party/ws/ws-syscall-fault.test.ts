import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { WebSocketServer } from "ws";

const skip = !fault.available() || isWindows;

// The 'ws' module in Bun is a thirdparty shim over the native WebSocket
// client/server. These tests verify the shim's event surface (on('message'),
// on('error'), on('close')) under transport faults.
//
// One subprocess per test, because fault rules are process-global. Each
// fixture reports exactly once via report(): the scenario result, the first
// 'error' event, or a 30s watchdog carrying the partial state the scenario
// wedged at. The watchdog only fires when the test has already failed; it
// exists so a wedged faulted socket produces an attributable toEqual diff and
// a dead subprocess instead of a bare test timeout and an orphaned process.

async function runWsFixture(body: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", body],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(stdout);
  } catch {
    // Missing or half-written result line: put the raw stdout in the diff
    // next to stderr/exitCode/signal.
    result = { stdout };
  }
  return { ...result, stderr, exitCode, signal: proc.signalCode };
}

describe.concurrent.skipIf(skip)("ws (thirdparty) under injected syscall faults", () => {
  test("recv → short reads (1 byte) deliver complete echoed message", async () => {
    const r = await runWsFixture(/* js */ `
      const { WebSocketServer, WebSocket } = require("ws");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const report = r => { console.log(JSON.stringify(r)); process.exit(0); };
      let opened = false, data = null;
      setTimeout(() => report({ error: "timed out", opened, data }), 30_000);
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      wss.on("connection", ws => ws.on("message", m => ws.send(m)));
      wss.on("listening", () => {
        // Armed before the client connects, so the upgrade handshake is also
        // read 1 byte at a time.
        fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
        const c = new WebSocket("ws://127.0.0.1:" + wss.address().port);
        c.on("open", () => { opened = true; c.send("hello-ws"); });
        c.on("message", m => { data = m.toString(); c.close(); });
        c.on("close", (code, reason, wasClean) => report({ data, code, wasClean }));
        c.on("error", e => report({ error: e.message }));
      });
    `);
    expect(r).toEqual({ data: "hello-ws", code: 1000, wasClean: true, stderr: "", exitCode: 0, signal: null });
  });

  test("send → short writes (1 byte) deliver complete message and ping/pong round-trips", async () => {
    const r = await runWsFixture(/* js */ `
      const { WebSocketServer, WebSocket } = require("ws");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const report = r => { console.log(JSON.stringify(r)); process.exit(0); };
      let pong = false, echoed = null;
      setTimeout(() => report({ error: "timed out", pong, echoedBytes: echoed ? echoed.length : null }), 30_000);
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      wss.on("connection", ws => {
        ws.on("message", m => ws.send(m));
        ws.on("ping", () => {});
      });
      wss.on("listening", () => {
        fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
        const c = new WebSocket("ws://127.0.0.1:" + wss.address().port);
        // Close only once BOTH the echo and the pong have arrived: 'pong' is
        // a separate event with no ordering guarantee relative to 'message'.
        const maybeClose = () => { if (pong && echoed) c.close(); };
        // 1024 > 125 forces the 2-byte extended-length frame header, so the
        // length bytes themselves are also split across 1-byte writes.
        c.on("open", () => { c.ping(); c.send(Buffer.alloc(1024, 0x77)); });
        c.on("pong", () => { pong = true; maybeClose(); });
        c.on("message", m => { echoed = m; maybeClose(); });
        c.on("close", (code, reason, wasClean) =>
          report({
            pong,
            len: echoed ? echoed.length : -1,
            intact: !!echoed && echoed.every(b => b === 0x77),
            code,
            wasClean,
          }),
        );
        c.on("error", e => report({ error: e.message }));
      });
    `);
    expect(r).toEqual({
      pong: true,
      len: 1024,
      intact: true,
      code: 1000,
      wasClean: true,
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("recv → ECONNRESET fires 'error' then 'close' with abnormal code (split-process)", async () => {
    // Server runs in this process (no fault); client runs in a subprocess so
    // the process-global recv rule only affects the client side.
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    wss.on("connection", ws => {
      ws.on("error", () => {});
      ws.send("x");
    });
    await new Promise<void>(r => wss.on("listening", () => r()));
    const port = (wss.address() as import("node:net").AddressInfo).port;
    try {
      const r = await runWsFixture(/* js */ `
        const { WebSocket } = require("ws");
        const { socketFaultInjection: fault } = require("bun:internal-for-testing");
        const report = r => { console.log(JSON.stringify(r)); process.exit(0); };
        let errorMessage = null;
        setTimeout(() => report({ error: "timed out", errorMessage }), 30_000);
        // Arm before connecting so the upgrade-response recv fails: that
        // exercises the close(1006) path without depending on the server to
        // send a frame after 'open' (which would race the arm).
        fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
        const c = new WebSocket("ws://127.0.0.1:${port}");
        c.on("open", () => {});
        c.on("error", e => { errorMessage = e.message; });
        // errorMessage being set by the time 'close' fires proves 'error'
        // fired before 'close'.
        c.on("close", (code, reason, wasClean) => report({ errorMessage, code, reason, wasClean }));
      `);
      expect(r).toEqual({
        errorMessage: `WebSocket connection to 'ws://127.0.0.1:${port}/' failed: Connection ended`,
        code: 1006,
        reason: "Connection ended",
        wasClean: false,
        stderr: "",
        exitCode: 0,
        signal: null,
      });
    } finally {
      await new Promise<void>(r => wss.close(() => r()));
    }
  });
});
