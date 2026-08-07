import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { WebSocketServer } from "ws";

const skip = !fault.available() || isWindows;

// The 'ws' module in Bun is a thirdparty shim over the native WebSocket
// client/server. These tests verify the shim's event surface (on('message'),
// on('error'), on('close')) under transport faults.
//
// Fixtures print one JSON line per completed scenario ({ scenario, ...result })
// so a crash mid-fixture still attributes to the scenario that was running.

async function runWsFixture(body: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", body],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const scenarios: Record<string, unknown> = {};
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const { scenario, ...result } = JSON.parse(line);
      scenarios[scenario] = result;
    } catch {
      // A half-written line means the fixture died mid-print; the stderr,
      // exitCode and signal assertions report what happened.
    }
  }
  return { scenarios, stderr, exitCode, signal: proc.signalCode };
}

// Process startup dominates each subprocess (~2s in a debug build, vs ~100ms
// for a faulted round trip), so both short-I/O scenarios run sequentially in
// ONE subprocess: fault rules are process-global, armed after the scenario's
// server is listening (so the handshake is faulted too) and cleared before the
// next scenario. Lazily started so the describe-level skip spawns nothing.
let shortIoResult: ReturnType<typeof runWsFixture> | undefined;
const shortIoFixture = () =>
  (shortIoResult ??= runWsFixture(/* js */ `
    const { WebSocketServer, WebSocket } = require("ws");
    const { socketFaultInjection: fault } = require("bun:internal-for-testing");

    function listen(onConnection) {
      return new Promise(resolve => {
        const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
        wss.on("connection", onConnection);
        wss.on("listening", () => resolve(wss));
      });
    }

    async function scenario(name, rule, onConnection, drive) {
      const wss = await listen(onConnection);
      fault.set(rule);
      try {
        const result = await drive("ws://127.0.0.1:" + wss.address().port);
        console.log(JSON.stringify({ scenario: name, ...result }));
      } finally {
        fault.clear();
        await new Promise(resolve => wss.close(resolve));
      }
    }

    await scenario(
      "recv-short",
      { syscall: "recv", action: "short", bytes: 1, repeat: -1 },
      ws => ws.on("message", m => ws.send(m)),
      url =>
        new Promise(resolve => {
          const c = new WebSocket(url);
          let data = null;
          c.on("open", () => c.send("hello-ws"));
          c.on("message", m => { data = m.toString(); c.close(); });
          c.on("close", (code, reason, wasClean) => resolve({ data, code, wasClean }));
          c.on("error", e => resolve({ error: e.message }));
        }),
    );

    await scenario(
      "send-short",
      { syscall: "send", action: "short", bytes: 1, repeat: -1 },
      ws => {
        ws.on("message", m => ws.send(m));
        ws.on("ping", () => {});
      },
      url =>
        new Promise(resolve => {
          const c = new WebSocket(url);
          // Close only once BOTH the echo and the pong have arrived: 'pong' is
          // a separate event with no ordering guarantee relative to 'message'.
          let pong = false, echoed = null;
          const maybeClose = () => { if (pong && echoed) c.close(); };
          // 1024 > 125 forces the 2-byte extended-length frame header, so the
          // length bytes themselves are also split across 1-byte writes.
          c.on("open", () => { c.ping(); c.send(Buffer.alloc(1024, 0x77)); });
          c.on("pong", () => { pong = true; maybeClose(); });
          c.on("message", m => { echoed = m; maybeClose(); });
          c.on("close", (code, reason, wasClean) =>
            resolve({
              pong,
              len: echoed ? echoed.length : -1,
              intact: !!echoed && echoed.every(b => b === 0x77),
              code,
              wasClean,
            }),
          );
          c.on("error", e => resolve({ error: e.message }));
        }),
    );

    process.exit(0);
  `));

describe.concurrent.skipIf(skip)("ws (thirdparty) under injected syscall faults", () => {
  test("recv → short reads (1 byte) deliver complete echoed message", async () => {
    const { scenarios, ...outcome } = await shortIoFixture();
    expect(outcome).toEqual({ stderr: "", exitCode: 0, signal: null });
    expect(scenarios["recv-short"]).toEqual({ data: "hello-ws", code: 1000, wasClean: true });
  });

  test("send → short writes (1 byte) deliver complete message and ping/pong round-trips", async () => {
    const { scenarios, ...outcome } = await shortIoFixture();
    expect(outcome).toEqual({ stderr: "", exitCode: 0, signal: null });
    expect(scenarios["send-short"]).toEqual({ pong: true, len: 1024, intact: true, code: 1000, wasClean: true });
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
      const { scenarios, ...outcome } = await runWsFixture(/* js */ `
        const { WebSocket } = require("ws");
        const { socketFaultInjection: fault } = require("bun:internal-for-testing");
        // Arm before connecting so the upgrade-response recv fails: that
        // exercises the close(1006) path without depending on the server to
        // send a frame after 'open' (which would race the arm).
        fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
        const c = new WebSocket("ws://127.0.0.1:${port}");
        let errorMessage = null;
        c.on("open", () => {});
        c.on("error", e => { errorMessage = e.message; });
        c.on("close", (code, reason, wasClean) => {
          // errorMessage being set here proves 'error' fired before 'close'.
          console.log(JSON.stringify({ scenario: "recv-econnreset", errorMessage, code, reason, wasClean }));
          fault.clear();
          process.exit(0);
        });
      `);
      expect(outcome).toEqual({ stderr: "", exitCode: 0, signal: null });
      expect(scenarios["recv-econnreset"]).toEqual({
        errorMessage: `WebSocket connection to 'ws://127.0.0.1:${port}/' failed: Connection ended`,
        code: 1006,
        reason: "Connection ended",
        wasClean: false,
      });
    } finally {
      await new Promise<void>(r => wss.close(() => r()));
    }
  });
});
