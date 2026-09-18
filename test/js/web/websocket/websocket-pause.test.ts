import { describe, expect, it } from "bun:test";
import { tls } from "harness";
import { createHash } from "node:crypto";
import net from "node:net";
import nodeTls from "node:tls";
import { WebSocket as WsWebSocket } from "ws";

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

// One unmasked server-to-client frame.
function frame(payload: string | Uint8Array, opcode = 1): Buffer {
  const body = Buffer.from(payload);
  const header =
    body.length < 126
      ? Buffer.from([0x80 | opcode, body.length])
      : Buffer.from([0x80 | opcode, 126, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([header, body]);
}

function closeFrame(code: number): Buffer {
  return frame(Buffer.from([code >> 8, code & 0xff]), 8);
}

// A peer that writes raw frames, so a test decides which bytes share a write
// with the 101 response. The client's upgrade parser reads those bytes
// together with the response: they are its handshake overflow. `end` closes
// the peer's side in that same write. After the upgrade, each chunk from the
// client runs the next entry of `then`.
async function rawPeer(
  secure: boolean,
  {
    withResponse,
    end = false,
    then = [],
  }: { withResponse: Buffer[]; end?: boolean; then?: ((socket: net.Socket) => void)[] },
) {
  const sockets = new Set<net.Socket>();
  function onConnection(socket: net.Socket) {
    sockets.add(socket);
    socket.on("error", () => {});
    const steps = [...then];
    let request: string | undefined = "";
    socket.on("data", chunk => {
      if (request === undefined) return steps.shift()?.(socket);
      request += chunk.toString("latin1");
      if (!request.includes("\r\n\r\n")) return;
      const key = /sec-websocket-key: (.*)\r\n/i.exec(request)![1];
      request = undefined;
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      const response =
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`;
      const flight = Buffer.concat([Buffer.from(response), ...withResponse]);
      if (end) socket.end(flight);
      else socket.write(flight);
    });
  }
  const server = secure
    ? nodeTls.createServer({ key: tls.key, cert: tls.cert }, onConnection)
    : net.createServer(onConnection);
  const port = await new Promise<number>(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
  return {
    url: `${secure ? "wss" : "ws"}://127.0.0.1:${port}`,
    [Symbol.dispose]() {
      server.close();
      for (const socket of sockets) socket.destroy();
    },
  };
}

function echoServer() {
  return Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response();
    },
    websocket: {
      message(ws, message) {
        ws.send(message);
      },
    },
  });
}

// 80 KB with the 101: more than one 64 KB chunk of a proxy tunnel's TLS
// session, so the chunks after the first reach the client while it is paused.
const FILL = Buffer.alloc(1024, "x").toString();
const WITH_101 = Array.from({ length: 80 }, (_, i) => `${i}:${FILL}`);
const LATER = ["later 1", "later 2", "later 3"];

for (const mode of MODES) {
  describe(`WebSocket.pause() and the frames that arrive with the 101 (${mode.name})`, () => {
    it.each(["while CONNECTING", "inside onopen"])("a pause %s holds them until resume()", async where => {
      const proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
      try {
        using peer = await rawPeer(mode.secure, {
          withResponse: WITH_101.map(m => frame(m)),
          then: [socket => socket.write(Buffer.concat(LATER.map(m => frame(m))))],
        });
        using echo = echoServer();

        const ws = new WebSocket(peer.url, {
          tls: { rejectUnauthorized: false },
          ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
        });
        const received: string[] = [];
        const { promise: done, resolve: resolveDone, reject } = Promise.withResolvers<void>();
        ws.onmessage = ({ data }) => {
          received.push(data);
          if (received.length === WITH_101.length + LATER.length) resolveDone();
        };
        ws.onerror = () => reject(new Error("unexpected error event"));
        ws.onclose = ({ code }) => reject(new Error(`unexpected close ${code}`));
        if (where === "while CONNECTING") expect(ws.pause()).toBe(true);
        await new Promise<void>(resolve => {
          ws.onopen = () => {
            if (where === "inside onopen") ws.pause();
            resolve();
          };
        });
        const clock = new WebSocket(`ws://localhost:${echo.port}`);
        await open(clock);

        // The peer answers with more frames. They wait behind the held ones.
        ws.send("more");
        await ioRoundtrips(clock, 5);
        expect({ received, isPaused: ws.isPaused }).toEqual({ received: [], isPaused: true });

        expect(ws.resume()).toBe(true);
        await done;
        expect(received).toEqual([...WITH_101, ...LATER]);
        ws.onclose = null;
        ws.close();
        clock.close();
      } finally {
        proxy?.close();
      }
    });
  });
}

// A platform can keep the end of a connection from a paused socket, or deliver
// it in a later read than the test expects. resume() shows it in both cases.
async function closedOrResumed(ws: WebSocket, clock: WebSocket, closed: Promise<unknown>) {
  await Promise.race([closed, ioRoundtrips(clock, 20)]);
  ws.resume();
  await closed;
}

describe.each([false, true])("WebSocket.pause() and a peer that ends the connection (tls: %p)", secure => {
  const options = { tls: { rejectUnauthorized: false } };
  const MESSAGES = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];

  it("a reset delivers the held frames before the close event", async () => {
    using peer = await rawPeer(secure, {
      withResponse: MESSAGES.map(m => frame(m)),
      then: [socket => socket.resetAndDestroy()],
    });
    using echo = echoServer();

    const ws = new WebSocket(peer.url, options);
    expect(ws.pause()).toBe(true);
    const events: string[] = [];
    ws.onmessage = ({ data }) => events.push(data);
    const closed = new Promise<void>(resolve => {
      ws.onclose = ({ code }) => {
        events.push(`close ${code}`);
        resolve();
      };
    });
    await open(ws);
    const clock = new WebSocket(`ws://localhost:${echo.port}`);
    await open(clock);
    await ioRoundtrips(clock, 5);
    expect(events).toEqual([]);

    ws.send("reset");
    await closedOrResumed(ws, clock, closed);
    expect(events).toEqual([...MESSAGES, "close 1006"]);
    clock.close();
  });
});

describe("frames, a Ping and a Close frame that arrive with the 101, and then the end of the connection", () => {
  const PING = frame("ping", 9);

  for (const mode of MODES) {
    for (const paused of [true, false]) {
      // A proxy tunnel answers the peer's close_notify before it delivers the last bytes, so an
      // unpaused client there can no longer write the Pong. That is not part of this behaviour.
      if (!paused && mode.secure && mode.proxy) continue;

      // A paused TLS client still sees the end of the session when it shares a read with the 101.
      // Then the held bytes are parsed with no socket left: no Pong, no echo, no reply goes out.
      it(`every frame and the close code count (${mode.name}, ${paused ? "paused" : "not paused"})`, async () => {
        const proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
        try {
          using peer = await rawPeer(mode.secure, {
            withResponse: [frame("m1"), PING, frame("m2"), closeFrame(4001)],
            end: true,
          });
          using echo = echoServer();
          const clock = new WebSocket(`ws://localhost:${echo.port}`);
          await open(clock);
          const ws = new WebSocket(peer.url, {
            tls: { rejectUnauthorized: false },
            ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
          });
          if (paused) expect(ws.pause()).toBe(true);
          const received: string[] = [];
          ws.onmessage = ({ data }) => {
            received.push(data);
            ws.send(`reply to ${data}`);
          };
          const closed = new Promise<CloseEvent>(resolve => (ws.onclose = resolve));
          await closedOrResumed(ws, clock, closed);
          const { code, wasClean } = await closed;
          expect({ received, code, wasClean }).toEqual({ received: ["m1", "m2"], code: 4001, wasClean: true });
          clock.close();
        } finally {
          proxy?.close();
        }
      });
    }
  }
});

describe("close() from a handler while a peer-ended connection delivers its held frames", () => {
  for (const mode of MODES) {
    it(`reports the code and the reason of that close() (${mode.name})`, async () => {
      const proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
      try {
        using peer = await rawPeer(mode.secure, { withResponse: [frame("m1"), frame("m2")], end: true });
        using echo = echoServer();
        const clock = new WebSocket(`ws://localhost:${echo.port}`);
        await open(clock);
        const ws = new WebSocket(peer.url, {
          tls: { rejectUnauthorized: false },
          ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
        });
        expect(ws.pause()).toBe(true);
        const received: string[] = [];
        ws.onmessage = ({ data }) => {
          received.push(data);
          ws.close(4000, "bye");
        };
        const closed = new Promise<CloseEvent>(resolve => (ws.onclose = resolve));
        await closedOrResumed(ws, clock, closed);
        const { code, reason, wasClean } = await closed;
        expect({ received, code, reason, wasClean }).toEqual({
          received: ["m1"],
          code: 4000,
          reason: "bye",
          wasClean: true,
        });
        clock.close();
      } finally {
        proxy?.close();
      }
    });
  }
});

describe("ws package", () => {
  it("pause() inside the open handler holds the frames that arrive with the 101", async () => {
    const MESSAGES = ["m1", "m2", "m3"];
    using peer = await rawPeer(false, { withResponse: MESSAGES.map(m => frame(m)) });
    using echo = echoServer();

    const ws = new WsWebSocket(peer.url);
    const received: string[] = [];
    const { promise: done, resolve: resolveDone, reject } = Promise.withResolvers<void>();
    ws.on("message", data => {
      received.push(String(data));
      if (received.length === MESSAGES.length) resolveDone();
    });
    ws.on("error", reject);
    ws.on("close", code => reject(new Error(`unexpected close ${code}`)));
    await new Promise<void>(resolve => {
      ws.once("open", () => {
        ws.pause();
        resolve();
      });
    });
    const clock = new WebSocket(`ws://localhost:${echo.port}`);
    await open(clock);
    await ioRoundtrips(clock, 5);
    expect({ received, isPaused: ws.isPaused }).toEqual({ received: [], isPaused: true });

    ws.resume();
    await done;
    expect(received).toEqual(MESSAGES);
    ws.removeAllListeners("close");
    ws.close();
    clock.close();
  });

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
