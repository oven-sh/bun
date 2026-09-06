import { describe, expect, it } from "bun:test";
import { tls } from "harness";
import net from "node:net";
import nodeTls from "node:tls";

const CHUNK = new Uint8Array(64 * 1024);
const TOTAL = 4096; // 256 MiB, far past any socket/TLS buffer
const TOTAL_BYTES = TOTAL * CHUNK.byteLength;

type Signals = {
  stream: PromiseWithResolvers<Bun.ServerWebSocket<Signals>>;
  backpressured: PromiseWithResolvers<void>;
  drained: PromiseWithResolvers<void>;
};

// Streams TOTAL chunks. send() returning -1 means the chunk was enqueued
// under backpressure; wait for the drain callback instead of re-sending.
// The waiter is armed before send() because drain can fire synchronously
// inside it on a plain TCP socket.
async function sendAll(ws: Bun.ServerWebSocket<Signals>): Promise<number> {
  let backpressured = 0;
  for (let i = 0; i < TOTAL; i++) {
    ws.data.drained = Promise.withResolvers();
    if (ws.send(CHUNK) === -1) {
      backpressured++;
      ws.data.backpressured.resolve();
      await ws.data.drained.promise;
    }
  }
  return backpressured;
}

// Every connection to this server echoes messages; the stream connection
// (first to open) is handed back through `signals.stream`.
function streamServer(signals: Signals, secure: boolean) {
  return Bun.serve<Signals>({
    port: 0,
    ...(secure ? { tls } : {}),
    fetch(req, server) {
      if (server.upgrade(req, { data: signals })) return;
      return new Response();
    },
    websocket: {
      open(ws) {
        ws.data.stream.resolve(ws);
      },
      message(ws, message) {
        ws.send(message);
      },
      drain(ws) {
        ws.data.drained.resolve();
      },
    },
  });
}

// A CONNECT proxy that pipes both directions, so backpressure propagates
// end to end: with the client paused, the origin server's send() must back
// up through the proxy. (proxy-test-utils copies with on("data") → write(),
// which would absorb the whole stream in memory instead.)
async function pipingConnectProxy(secure: boolean): Promise<{ port: number; close(): void }> {
  function onConnection(client: net.Socket) {
    client.once("data", head => {
      const match = /^CONNECT ([^:]+):(\d+) /.exec(head.toString("latin1"));
      if (!match) {
        client.destroy();
        return;
      }
      const upstream = net.connect(Number(match[2]), match[1], () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    });
  }
  const server = secure
    ? nodeTls.createServer({ key: tls.key, cert: tls.cert }, onConnection)
    : net.createServer(onConnection);
  const port = await new Promise<number>(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
  return { port, close: () => server.close() };
}

// Forces the event loop through `n` I/O roundtrips without a timer. A
// paused socket that still had readable data would be delivered during
// these polls, so "nothing arrived across N roundtrips" is the assertion.
async function ioRoundtrips(clock: WebSocket, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    clock.onmessage = () => resolve();
    clock.send("tick");
    await promise;
  }
}

function open(ws: WebSocket): Promise<void> {
  return new Promise(resolve => (ws.onopen = () => resolve()));
}

// Minimal surface shared by the global WebSocket and the `ws` package.
type Pausable = {
  pause(): unknown;
  resume(): unknown;
  readonly isPaused: boolean;
};

// The scenario every variant runs: the peer streams TOTAL_BYTES at us while
// paused; we must see the peer block on TCP (its send() backpressures) with
// our received count frozen far below the total, then drain it all on resume.
async function expectPauseHolds({
  ws,
  signals,
  clock,
  getReceived,
  done,
}: {
  ws: Pausable;
  signals: Signals;
  clock: WebSocket;
  getReceived: () => number;
  done: Promise<void>;
}) {
  const stream = await signals.stream.promise;
  const serverDone = sendAll(stream);

  expect(ws.isPaused).toBe(true);
  // The peer's send() went to -1: our kernel receive buffer is full and the
  // TCP window is closed. Frames decoded before the pause may already have
  // dispatched; nothing more may arrive from here on.
  await signals.backpressured.promise;
  const baseline = getReceived();
  await ioRoundtrips(clock, 20);
  expect(getReceived()).toBe(baseline);
  // Far below the total: the peer is blocked on TCP, not buffering in us.
  expect(baseline).toBeLessThan(TOTAL_BYTES / 8);

  ws.resume();
  expect(ws.isPaused).toBe(false);
  await done;
  expect(getReceived()).toBe(TOTAL_BYTES);
  expect(await serverDone).toBeGreaterThan(0);
}

function newSignals(): Signals {
  return {
    stream: Promise.withResolvers(),
    backpressured: Promise.withResolvers(),
    drained: Promise.withResolvers(),
  };
}

// Each mode lands on a different socket underneath the WebSocket:
//   ws / wss           — uSockets TCP / TLS socket, adopted directly
//   wss via http://    — WebSocketProxyTunnel over a plain proxy socket (TLS in the tunnel)
//   wss via https://   — WebSocketProxyTunnel over a TLS proxy socket (TLS in TLS)
//   ws  via https://   — TLS socket to the proxy, no tunnel (ProxyTLS → ClientSSL)
// pause() has to reach the bottom one in every case.
const MODES = [
  { name: "ws", secure: false, proxy: null },
  { name: "wss", secure: true, proxy: null },
  { name: "wss via http:// proxy", secure: true, proxy: "http" },
  { name: "wss via https:// proxy", secure: true, proxy: "https" },
  { name: "ws via https:// proxy", secure: false, proxy: "https" },
] as const;

for (const mode of MODES) {
  const { secure } = mode;
  describe(`WebSocket.pause() / resume() (${mode.name})`, () => {
    it("stops reads while paused and drains after resume", async () => {
      const proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
      try {
        const signals = newSignals();
        using server = streamServer(signals, secure);
        const url = `${secure ? "wss" : "ws"}://localhost:${server.port}`;
        const options = {
          tls: { rejectUnauthorized: false },
          ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
        };

        const ws = new WebSocket(url, options);
        ws.binaryType = "arraybuffer";
        let received = 0;
        const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>();
        ws.onmessage = ({ data }) => {
          received += (data as ArrayBuffer).byteLength;
          if (received >= TOTAL_BYTES) resolveDone();
        };
        await open(ws);
        const clock = new WebSocket(url, options);
        await open(clock);

        expect(ws.isPaused).toBe(false);
        expect(ws.pause()).toBe(true);
        await expectPauseHolds({ ws, signals, clock, getReceived: () => received, done });

        ws.close();
        clock.close();
      } finally {
        proxy?.close();
      }
    }, 60_000);

    it("pause() and resume() are idempotent", async () => {
      const proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
      try {
        const signals = newSignals();
        using server = streamServer(signals, secure);
        const url = `${secure ? "wss" : "ws"}://localhost:${server.port}`;
        const options = {
          tls: { rejectUnauthorized: false },
          ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
        };
        const ws = new WebSocket(url, options);
        await open(ws);
        expect(ws.resume()).toBe(true);
        expect(ws.isPaused).toBe(false);
        expect(ws.pause()).toBe(true);
        expect(ws.pause()).toBe(true);
        expect(ws.isPaused).toBe(true);
        expect(ws.resume()).toBe(true);
        expect(ws.resume()).toBe(true);
        expect(ws.isPaused).toBe(false);

        // Still a working connection after the churn.
        const { promise: echoed, resolve } = Promise.withResolvers<string>();
        ws.onmessage = ({ data }) => resolve(data);
        ws.send("still alive");
        expect(await echoed).toBe("still alive");

        const closed = new Promise(resolve => (ws.onclose = resolve));
        ws.close();
        await closed;
        expect(ws.pause()).toBe(false);
        expect(ws.resume()).toBe(false);
      } finally {
        proxy?.close();
      }
    });
  });
}

describe("WebSocket.pause() before open", () => {
  it("latches and applies once connected", async () => {
    const signals = newSignals();
    using server = streamServer(signals, false);
    const url = `ws://localhost:${server.port}`;

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    expect(ws.pause()).toBe(true);
    expect(ws.isPaused).toBe(true);
    let received = 0;
    const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>();
    ws.onmessage = ({ data }) => {
      received += (data as ArrayBuffer).byteLength;
      if (received >= TOTAL_BYTES) resolveDone();
    };
    await open(ws);
    expect(ws.isPaused).toBe(true);
    const clock = new WebSocket(url);
    await open(clock);

    await expectPauseHolds({ ws, signals, clock, getReceived: () => received, done });
    ws.close();
    clock.close();
  }, 60_000);

  it("resume() before open clears the latch", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response();
      },
      websocket: {
        open(ws) {
          ws.send("a");
        },
        message() {},
      },
    });
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    expect(ws.pause()).toBe(true);
    expect(ws.resume()).toBe(true);
    expect(ws.isPaused).toBe(false);
    const { promise: got, resolve } = Promise.withResolvers<string>();
    ws.onmessage = ({ data }) => resolve(data);
    expect(await got).toBe("a");
    ws.close();
  });

  it("a latched pause is dropped when the connection fails", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("nope", { status: 403 });
      },
      websocket: { message() {} },
    });
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    expect(ws.pause()).toBe(true);
    const closed = new Promise(resolve => (ws.onclose = resolve));
    ws.onerror = () => {};
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(ws.pause()).toBe(false);
    expect(ws.resume()).toBe(false);
  });
});

describe("ws package", () => {
  it("pause()/resume()/isPaused reach the socket", async () => {
    const { WebSocket: WS } = await import("ws");
    const signals = newSignals();
    using server = streamServer(signals, false);
    const url = `ws://localhost:${server.port}`;

    const ws = new WS(url);
    let received = 0;
    const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>();
    ws.on("message", (data: Buffer) => {
      received += data.byteLength;
      if (received >= TOTAL_BYTES) resolveDone();
    });
    await new Promise(resolve => ws.once("open", resolve));
    const clock = new WebSocket(url);
    await open(clock);

    expect(ws.isPaused).toBe(false);
    ws.pause();
    await expectPauseHolds({ ws, signals, clock, getReceived: () => received, done });
    ws.close();
    clock.close();
  }, 60_000);
});
