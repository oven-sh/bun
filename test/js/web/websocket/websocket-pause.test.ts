import { describe, expect, it } from "bun:test";
import { tls } from "harness";
import net from "node:net";
import nodeTls from "node:tls";
import { WebSocket as WS } from "ws";

const CHUNK = new Uint8Array(64 * 1024);
// The origin's send() has to return -1 (TCP backpressure) before the stream
// ends, so TOTAL_BYTES must exceed what the kernel buffers of one loopback
// connection hold while the client does not read. Measured: 2.5 MiB on Linux
// (sndbuf autotunes to 2.5 MiB, rcvbuf stays at its 128 KiB default), 192 KiB
// on Windows. macOS caps a socket buffer at kern.ipc.maxsockbuf (8 MiB), so
// 32 MiB keeps a 2x margin even over two such buffers. sendAll() fails the
// test instead of hanging if the stream ever ends without backpressure.
const TOTAL = 512; // 32 MiB
const TOTAL_BYTES = TOTAL * CHUNK.byteLength;

type Signals = {
  stream: PromiseWithResolvers<Bun.ServerWebSocket<Signals>>;
  backpressured: PromiseWithResolvers<void>;
  drained: PromiseWithResolvers<void>;
};

// Streams TOTAL chunks. send() returning -1 means the chunk was enqueued
// under backpressure; wait for the drain callback instead of re-sending.
// The waiter is armed before send() because drain can fire synchronously
// inside it on a plain TCP socket. Resolves to the number of sends that
// backpressured; rejects if a send is dropped or the stream never backs up.
async function sendAll(ws: Bun.ServerWebSocket<Signals>): Promise<number> {
  let backpressured = 0;
  for (let i = 0; i < TOTAL; i++) {
    ws.data.drained = Promise.withResolvers();
    const status = ws.send(CHUNK);
    if (status === -1) {
      backpressured++;
      ws.data.backpressured.resolve();
      await ws.data.drained.promise;
    } else if (status !== CHUNK.byteLength) {
      throw new Error(`send() returned ${status} for chunk ${i}`);
    }
  }
  if (backpressured === 0) {
    throw new Error(`sent ${TOTAL_BYTES} bytes to a paused peer without backpressure`);
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
async function pipingConnectProxy(secure: boolean): Promise<{ port: number; [Symbol.dispose](): void }> {
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
  return { port, [Symbol.dispose]: () => server.close() };
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
// we are paused. pause() preceded its first send(), so we must see the peer
// block on TCP (its send() backpressures) with our received count still at
// zero, then drain it all on resume. Resolves to what resume() returned.
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
}): Promise<unknown> {
  const stream = await signals.stream.promise;
  const serverDone = sendAll(stream);

  // The peer's send() went to -1: our kernel receive buffer is full and the
  // TCP window is closed. Nothing may arrive from here on. The race fails
  // the test at once if sendAll() rejects before that first -1.
  await Promise.race([signals.backpressured.promise, serverDone]);
  const receivedAtBackpressure = getReceived();
  await ioRoundtrips(clock, 20);
  expect({
    isPaused: ws.isPaused,
    receivedAtBackpressure,
    receivedAfterRoundtrips: getReceived(),
  }).toEqual({
    isPaused: true,
    receivedAtBackpressure: 0,
    receivedAfterRoundtrips: 0,
  });

  const resumed = ws.resume();
  const isPausedAfterResume = ws.isPaused;
  const backpressured = await serverDone;
  await done;
  expect({ isPausedAfterResume, received: getReceived() }).toEqual({
    isPausedAfterResume: false,
    received: TOTAL_BYTES,
  });
  expect(backpressured).toBeGreaterThan(0);
  return resumed;
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

// The tests stay sequential on purpose: all of the work (framing, TLS, the
// proxy copies) runs on this one thread, so concurrent tests only interleave
// and each one's own duration grows toward the timeout.
for (const mode of MODES) {
  const { secure } = mode;
  describe(`WebSocket.pause() / resume() (${mode.name})`, () => {
    it("stops reads while paused and drains after resume", async () => {
      using proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
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

      expect({ isPausedBefore: ws.isPaused, paused: ws.pause(), isPausedAfterPause: ws.isPaused }).toEqual({
        isPausedBefore: false,
        paused: true,
        isPausedAfterPause: true,
      });
      expect(await expectPauseHolds({ ws, signals, clock, getReceived: () => received, done })).toBe(true);

      ws.close();
      clock.close();
    });

    it("pause() and resume() are idempotent", async () => {
      using proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
      const signals = newSignals();
      using server = streamServer(signals, secure);
      const url = `${secure ? "wss" : "ws"}://localhost:${server.port}`;
      const options = {
        tls: { rejectUnauthorized: false },
        ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
      };
      const ws = new WebSocket(url, options);
      await open(ws);

      // Each entry records the return value and the state right after the call.
      const transitions = [
        { call: "resume", returned: ws.resume(), isPaused: ws.isPaused },
        { call: "pause", returned: ws.pause(), isPaused: ws.isPaused },
        { call: "pause", returned: ws.pause(), isPaused: ws.isPaused },
        { call: "resume", returned: ws.resume(), isPaused: ws.isPaused },
        { call: "resume", returned: ws.resume(), isPaused: ws.isPaused },
      ];
      expect(transitions).toEqual([
        { call: "resume", returned: true, isPaused: false },
        { call: "pause", returned: true, isPaused: true },
        { call: "pause", returned: true, isPaused: true },
        { call: "resume", returned: true, isPaused: false },
        { call: "resume", returned: true, isPaused: false },
      ]);

      // Still a working connection after the churn.
      const { promise: echoed, resolve } = Promise.withResolvers<string>();
      ws.onmessage = ({ data }) => resolve(data);
      ws.send("still alive");
      expect(await echoed).toBe("still alive");

      const closed = new Promise(resolve => (ws.onclose = resolve));
      ws.close();
      await closed;
      expect({ pause: ws.pause(), resume: ws.resume() }).toEqual({ pause: false, resume: false });
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
    const paused = ws.pause();
    const isPausedWhileConnecting = ws.isPaused;
    let received = 0;
    const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>();
    ws.onmessage = ({ data }) => {
      received += (data as ArrayBuffer).byteLength;
      if (received >= TOTAL_BYTES) resolveDone();
    };
    await open(ws);
    expect({ paused, isPausedWhileConnecting, isPausedAfterOpen: ws.isPaused }).toEqual({
      paused: true,
      isPausedWhileConnecting: true,
      isPausedAfterOpen: true,
    });
    const clock = new WebSocket(url);
    await open(clock);

    expect(await expectPauseHolds({ ws, signals, clock, getReceived: () => received, done })).toBe(true);
    ws.close();
    clock.close();
  });

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
    const paused = ws.pause();
    const resumed = ws.resume();
    const isPausedWhileConnecting = ws.isPaused;
    const { promise: got, resolve } = Promise.withResolvers<string>();
    ws.onmessage = ({ data }) => resolve(data);
    await open(ws);
    expect({
      paused,
      resumed,
      isPausedWhileConnecting,
      isPausedAfterOpen: ws.isPaused,
      firstMessage: await got,
    }).toEqual({
      paused: true,
      resumed: true,
      isPausedWhileConnecting: false,
      isPausedAfterOpen: false,
      firstMessage: "a",
    });
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
    const pausedWhileConnecting = ws.pause();
    const closed = new Promise(resolve => (ws.onclose = resolve));
    ws.onerror = () => {};
    await closed;
    expect({
      pausedWhileConnecting,
      readyState: ws.readyState,
      pause: ws.pause(),
      resume: ws.resume(),
    }).toEqual({
      pausedWhileConnecting: true,
      readyState: WebSocket.CLOSED,
      pause: false,
      resume: false,
    });
  });
});

describe("ws package", () => {
  it("pause()/resume()/isPaused reach the socket", async () => {
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

    // npm ws returns undefined from pause() and resume().
    expect({ isPausedBefore: ws.isPaused, paused: ws.pause(), isPausedAfterPause: ws.isPaused }).toEqual({
      isPausedBefore: false,
      paused: undefined,
      isPausedAfterPause: true,
    });
    expect(await expectPauseHolds({ ws, signals, clock, getReceived: () => received, done })).toBeUndefined();
    ws.close();
    clock.close();
  });
});
