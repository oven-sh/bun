import { describe, expect, it } from "bun:test";
import { isLinux, isMacOS, tls } from "harness";
import crypto from "node:crypto";
import { readdirSync } from "node:fs";
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

// A closed WebSocket keeps its socket until a read sees the peer's FIN. Once
// the close is dispatched nothing can call resume(), so a socket that stays
// paused would never be closed.
describe("WebSocket.close() while paused", () => {
  function acceptUpgrade(sock: net.Socket, head: Buffer) {
    const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(head.toString("latin1"))![1].trim();
    const accept = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  }

  function listen(server: net.Server): Promise<number> {
    return new Promise(resolve =>
      server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
    );
  }

  it("still answers the peer's FIN (wss)", async () => {
    // A raw origin, to see the TCP connection itself: it answers the client's
    // Close frame with its own, sends FIN, and waits for the client's FIN.
    const { promise: originSocketClosed, resolve: resolveOriginSocketClosed } = Promise.withResolvers<void>();
    const server = nodeTls.createServer({ key: tls.key, cert: tls.cert }, sock => {
      sock.once("data", head => {
        acceptUpgrade(sock, head);
        sock.once("data", () => sock.end(Buffer.from([0x88, 0x02, 0x03, 0xe8])));
      });
      sock.on("error", () => {});
      sock.on("close", () => resolveOriginSocketClosed());
    });
    const port = await listen(server);
    try {
      const ws = new WebSocket(`wss://127.0.0.1:${port}`, { tls: { rejectUnauthorized: false } });
      await open(ws);
      expect(ws.pause()).toBe(true);
      const closed = new Promise<CloseEvent>(resolve => (ws.onclose = resolve));
      ws.close();
      const { code, wasClean } = await closed;
      expect({ code, wasClean }).toEqual({ code: 1000, wasClean: true });
      await originSocketClosed;
    } finally {
      server.close();
    }
  });

  // The plain-TCP client sends its FIN with the Close frame, so its peer cannot
  // tell whether the client ever closes the socket. Look at the file descriptors.
  //
  // The servers are in this process on purpose. The client's own shutdown raises
  // EPOLLHUP at once. A peer in another process can answer before the client
  // polls again, and data that arrives after shutdown(SHUT_RD) resets the
  // connection: the socket then closes on the error, paused or not.
  describe.skipIf(!isLinux && !isMacOS)("leaves no file descriptor open", () => {
    const openFds = () => readdirSync(isMacOS ? "/dev/fd" : "/proc/self/fd");

    // Closes a few connections with `closeOne`. Returns the file descriptors
    // that are open afterwards and were not open before.
    async function leakedFds(url: string, options: object, closeOne: (ws: WebSocket) => Promise<CloseEvent>) {
      // This connection stays open for the whole run. Whatever the first
      // connection creates lazily is part of the baseline with it.
      const held = new WebSocket(`${url}/held`, options);
      await open(held);
      const before = new Set(openFds());
      try {
        for (let i = 0; i < 4; i++) {
          const { code, wasClean } = await closeOne(new WebSocket(url, options));
          expect({ code, wasClean }).toEqual({ code: 1000, wasClean: true });
        }
        // Every socket of a closed connection (client, origin and proxy side)
        // closes within a few turns of the event loop. A leaked one never does.
        const leaked = () => openFds().filter(fd => !before.has(fd));
        const deadline = performance.now() + 3000;
        while (leaked().length > 0 && performance.now() < deadline) {
          await new Promise(resolve => setImmediate(resolve));
        }
        return leaked();
      } finally {
        held.terminate();
      }
    }

    function closeEvent(ws: WebSocket): Promise<CloseEvent> {
      return new Promise(resolve => (ws.onclose = resolve));
    }

    for (const mode of MODES) {
      it(`pause(), then close() (${mode.name})`, async () => {
        const proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
        try {
          using server = streamServer(newSignals(), mode.secure);
          const url = `${mode.secure ? "wss" : "ws"}://127.0.0.1:${server.port}`;
          const options = {
            tls: { rejectUnauthorized: false },
            ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
          };
          const leaked = await leakedFds(url, options, async ws => {
            await open(ws);
            const closed = closeEvent(ws);
            expect(ws.pause()).toBe(true);
            ws.close();
            return closed;
          });
          expect(leaked).toEqual([]);
        } finally {
          proxy?.close();
        }
      });
    }

    it("pause() in the message handler, with the peer's Close in the same read", async () => {
      using server = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req, { data: { held: new URL(req.url).pathname === "/held" } })) return;
          return new Response();
        },
        websocket: {
          open(ws: Bun.ServerWebSocket<{ held: boolean }>) {
            if (ws.data.held) return;
            ws.send("message");
            ws.close(1000, "bye");
          },
          message() {},
        },
      });
      const leaked = await leakedFds(`ws://127.0.0.1:${server.port}`, {}, ws => {
        ws.onmessage = () => ws.pause();
        return closeEvent(ws);
      });
      expect(leaked).toEqual([]);
    });

    // With unsent data queued, the Close frame queues behind it, and the close
    // is dispatched once it drains. Until then C++ still holds the native client.
    for (const order of ["pause(), then close()", "close(), then pause()"] as const) {
      it(`${order} with the Close frame behind unsent data`, async () => {
        // Completes the upgrade and then reads nothing until resumed.
        let origin!: net.Socket;
        const server = net.createServer(sock => {
          sock.once("data", head => {
            acceptUpgrade(sock, head);
            sock.pause();
            sock.on("data", () => {});
            origin = sock;
          });
          sock.on("error", () => {});
        });
        const port = await listen(server);
        try {
          const leaked = await leakedFds(`ws://127.0.0.1:${port}`, {}, async ws => {
            await open(ws);
            const closed = closeEvent(ws);
            // Fill the socket until the client has to queue.
            for (let sent = 0; ws.bufferedAmount === 0; sent++) {
              expect(sent).toBeLessThan(1024);
              ws.send(CHUNK);
            }
            if (order === "pause(), then close()") {
              expect(ws.pause()).toBe(true);
              ws.close();
            } else {
              ws.close();
              expect(ws.pause()).toBe(false);
              expect(ws.isPaused).toBe(false);
            }
            // The Close frame had to wait.
            expect(ws.bufferedAmount).toBeGreaterThan(0);
            origin.resume();
            return closed;
          });
          expect(leaked).toEqual([]);
        } finally {
          server.close();
        }
      });
    }
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
