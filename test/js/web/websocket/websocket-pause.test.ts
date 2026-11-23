import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { isLinux, isMacOS, tls } from "harness";
import { readdirSync } from "node:fs";
import net from "node:net";
import nodeTls from "node:tls";
import { WebSocket as WsWebSocket } from "ws";
import { closePayload, createPeer, encodeFrame, OP, response101 } from "./raw-peer";

const CHUNK = new Uint8Array(64 * 1024);
// SO_SNDBUF for every socket that sends toward the paused client.
const SEND_BUFFER = 64 * 1024;
// Must exceed what the kernel buffers for one loopback connection while the client
// isn't reading. With SEND_BUFFER that is under 1 MiB on Linux, through a proxy too. It wasn't
// measured elsewhere, where the default is 192 KiB on Windows and at most 2 x 8 MiB on macOS
// (kern.ipc.maxsockbuf). sendAll() fails the test if this is ever too small.
const TOTAL = isLinux ? 64 : 512; // 4 MiB or 32 MiB
const TOTAL_BYTES = TOTAL * CHUNK.byteLength;

type Signals = {
  stream: PromiseWithResolvers<Bun.ServerWebSocket<Signals>>;
  backpressured: PromiseWithResolvers<void>;
  drained: PromiseWithResolvers<void>;
};

// Streams TOTAL chunks. send() returning -1 means the chunk was enqueued
// under backpressure; wait for the drain callback instead of re-sending.
// The waiter is armed before send() because drain can fire synchronously
// inside it on a plain TCP socket. Rejects if a send is dropped or the stream
// never hits backpressure.
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
async function pipingConnectProxy(secure: boolean): Promise<{ port: number; close(): void }> {
  function onConnection(client: net.Socket) {
    client.once("data", head => {
      const match = /^CONNECT ([^:]+):(\d+) /.exec(head.toString("latin1"));
      if (!match) {
        client.destroy();
        return;
      }
      const upstream = net.connect(Number(match[2]), match[1], () => {
        setSocketOptions(client, 1, SEND_BUFFER);
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
// paused. pause() was called before the peer's first send(), so the peer must block
// on TCP (its send() hits backpressure) with nothing received, then drain it all on resume.
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
  setSocketOptions(stream, 1, SEND_BUFFER);
  const serverDone = sendAll(stream);

  expect(ws.isPaused).toBe(true);
  // The peer's send() went to -1: our kernel receive buffer is full and the
  // TCP window is closed. Racing `serverDone` fails the test immediately if sendAll() rejects.
  await Promise.race([signals.backpressured.promise, serverDone]);
  expect(getReceived()).toBe(0);
  await ioRoundtrips(clock, 20);
  expect(getReceived()).toBe(0);

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

const textFrames = (...messages: string[]) => Buffer.concat(messages.map(message => encodeFrame(OP.text, message)));
const closeFrame = (code: number) => encodeFrame(OP.close, closePayload(code));

// A connection to an echo server, for ioRoundtrips().
async function startClock() {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
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
  const clock = new WebSocket(`ws://127.0.0.1:${server.port}`);
  await open(clock);
  return { clock, [Symbol.dispose]: () => void server.stop(true) };
}

// One mode per socket type: TCP, TLS, and a TLS tunnel through a proxy.
const SOCKET_MODES = MODES.filter(mode => mode.proxy !== "https");

describe("frames sent in the same write as the 101", () => {
  const WITH_101 = ["m1", "m2", "m3"];
  const LATER = ["later 1", "later 2"];

  for (const mode of SOCKET_MODES) {
    const connect = async (url: string) => {
      const proxy = mode.proxy ? await pipingConnectProxy(false) : undefined;
      const ws = new WebSocket(url, {
        tls: { rejectUnauthorized: false },
        ...(proxy ? { proxy: `http://127.0.0.1:${proxy.port}` } : {}),
      });
      return { ws, [Symbol.dispose]: () => proxy?.close() };
    };

    // `open` and each message are dispatched as separate tasks, so microtasks run between them.
    it(`are delivered after onopen's microtasks (${mode.name})`, async () => {
      await using peer = await createPeer({ secure: mode.secure, afterUpgrade: textFrames("greeting") });
      using client = await connect(peer.url);
      const order: string[] = [];
      const { promise: done, resolve } = Promise.withResolvers<void>();
      client.ws.onopen = () => {
        order.push("open");
        queueMicrotask(() => order.push("microtask"));
        Promise.resolve().then(() => order.push("reaction"));
      };
      client.ws.onmessage = ({ data }) => {
        order.push(`message ${data}`);
        resolve();
      };
      await done;
      expect(order).toEqual(["open", "microtask", "reaction", "message greeting"]);
      client.ws.terminate();
    });

    it.each(["while CONNECTING", "inside onopen"])(`wait for resume() after pause() %s (${mode.name})`, async where => {
      await using peer = await createPeer({ secure: mode.secure, afterUpgrade: textFrames(...WITH_101) });
      using clockServer = await startClock();
      using client = await connect(peer.url);
      const { ws } = client;
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

      // The peer replies with more frames. They queue behind the buffered ones.
      ws.send("more");
      const connection = await peer.connection();
      await connection.nextFrame();
      connection.write(textFrames(...LATER));
      await ioRoundtrips(clockServer.clock, 5);
      expect({ received, isPaused: ws.isPaused }).toEqual({ received: [], isPaused: true });

      expect(ws.resume()).toBe(true);
      // resume() doesn't fire message events synchronously.
      expect(received).toEqual([]);
      await done;
      expect(received).toEqual([...WITH_101, ...LATER]);
      ws.onclose = null;
      ws.terminate();
    });

    it(`are delivered before the close event when a paused connection is reset (${mode.name})`, async () => {
      await using peer = await createPeer({ secure: mode.secure, afterUpgrade: textFrames(...WITH_101) });
      using clockServer = await startClock();
      using client = await connect(peer.url);
      const { ws } = client;
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
      await ioRoundtrips(clockServer.clock, 5);
      expect(events).toEqual([]);

      ws.send("reset");
      const connection = await peer.connection();
      await connection.nextFrame();
      connection.reset();
      // Some platforms don't report the reset while the socket is paused. In that case resume() surfaces it.
      await Promise.race([closed, ioRoundtrips(clockServer.clock, 20)]);
      ws.resume();
      await closed;
      expect(events).toEqual([...WITH_101, "close 1006"]);
    });

    // Sending the Pong and the Close echo may fail because the connection is already closed. That must not
    // stop parsing early.
    it(`are parsed up to the Close frame when the peer already ended the connection (${mode.name})`, async () => {
      await using peer = await createPeer({
        secure: mode.secure,
        // The 101, the frames and the FIN are sent together.
        respond(connection) {
          connection.socket.end(
            Buffer.concat([
              Buffer.from(response101(connection)),
              textFrames("m1"),
              encodeFrame(OP.ping, "ping"),
              textFrames("m2"),
              closeFrame(4001),
              textFrames("m3"),
            ]),
          );
          return null;
        },
      });
      using clockServer = await startClock();
      using client = await connect(peer.url);
      const { ws } = client;
      expect(ws.pause()).toBe(true);
      const received: string[] = [];
      ws.onmessage = ({ data }) => received.push(data);
      const closed = new Promise<CloseEvent>(resolve => (ws.onclose = resolve));
      await Promise.race([closed, ioRoundtrips(clockServer.clock, 20)]);
      ws.resume();
      expect({ code: (await closed).code, received }).toEqual({ code: 4001, received: ["m1", "m2"] });
    });

    it(`let close() finish cleanly when they include the peer's Close frame (${mode.name})`, async () => {
      await using peer = await createPeer({
        secure: mode.secure,
        // The close event waits for the peer's FIN.
        allowHalfOpen: false,
        afterUpgrade: Buffer.concat([textFrames("m1"), closeFrame(4002)]),
      });
      using clockServer = await startClock();
      using client = await connect(peer.url);
      const { ws } = client;
      expect(ws.pause()).toBe(true);
      const received: string[] = [];
      ws.onmessage = ({ data }) => received.push(data);
      const closed = new Promise<CloseEvent>(resolve => (ws.onclose = resolve));
      await open(ws);
      await ioRoundtrips(clockServer.clock, 5);
      ws.close(1000);
      const { code, wasClean } = await closed;
      // The WebSocket is already CLOSING when "m1" is parsed, so the message is dropped.
      expect({ code, wasClean, received }).toEqual({ code: 4002, wasClean: true, received: [] });
    });
  }
});

// The peer's Close frame and FIN are only seen by reading, and resume() is a no-op
// once the WebSocket is CLOSING, so close() has to resume the socket itself.
describe("WebSocket.close() while paused", () => {
  const closeEvent = (ws: WebSocket) => new Promise<CloseEvent>(resolve => (ws.onclose = resolve));

  describe.skipIf(!isLinux && !isMacOS)("doesn't leak file descriptors", () => {
    const openFds = () => readdirSync(isMacOS ? "/dev/fd" : "/proc/self/fd");

    // Closes a few connections with `closeOne`. Returns the file descriptors
    // that are still open afterwards but weren't open before.
    async function leakedFds(url: string, options: object, closeOne: (ws: WebSocket) => Promise<CloseEvent>) {
      // Keep one connection open for the whole run, so fds that the first
      // connection creates lazily are part of the baseline.
      const held = new WebSocket(`${url}/held`, options);
      await open(held);
      const before = new Set(openFds());
      try {
        for (let i = 0; i < 4; i++) {
          const { code, wasClean } = await closeOne(new WebSocket(url, options));
          expect({ code, wasClean }).toEqual({ code: 1000, wasClean: true });
        }
        // A closed connection's sockets (client, origin and proxy side) all close
        // within a few event loop iterations. A leaked one never does.
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

    for (const mode of SOCKET_MODES) {
      it(`pause(), then close() (${mode.name})`, async () => {
        const proxy = mode.proxy ? await pipingConnectProxy(false) : undefined;
        try {
          using server = streamServer(newSignals(), mode.secure);
          const url = `${mode.secure ? "wss" : "ws"}://localhost:${server.port}`;
          const options = {
            tls: { rejectUnauthorized: false },
            ...(proxy ? { proxy: `http://127.0.0.1:${proxy.port}` } : {}),
          };
          const leaked = await leakedFds(url, options, async ws => {
            await open(ws);
            const closed = closeEvent(ws);
            expect(ws.pause()).toBe(true);
            ws.close(1000);
            return closed;
          });
          expect(leaked).toEqual([]);
        } finally {
          proxy?.close();
        }
      });
    }

    it("pause() in the message handler, with the peer's Close frame in the same read", async () => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
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

    for (const order of ["pause(), then close()", "close(), then pause()"] as const) {
      it(`${order} with the Close frame queued behind unsent data`, async () => {
        // Completes the upgrade, then doesn't read until resumed. The client's 8-byte Close frame
        // is the last thing it sends, so the origin replies once it has read every expected byte.
        let origin!: net.Socket;
        await using peer = await createPeer({
          respond(connection) {
            origin = connection.socket;
            origin.pause();
            return response101(connection);
          },
        });
        const leaked = await leakedFds(peer.url, {}, async ws => {
          await open(ws);
          setSocketOptions(ws, 1, SEND_BUFFER);
          const closed = closeEvent(ws);
          // Fill the socket until the client has to buffer, then buffer more than the
          // kernel can accept when close() retries the write.
          let sent = 0;
          for (; ws.bufferedAmount === 0; sent++) {
            expect(sent).toBeLessThan(1024);
            ws.send(CHUNK);
          }
          for (let extra = 0; extra < (isLinux ? 16 : 64); extra++, sent++) ws.send(CHUNK);
          if (order === "pause(), then close()") {
            expect(ws.pause()).toBe(true);
            ws.close(1000);
          } else {
            ws.close(1000);
            expect(ws.pause()).toBe(false);
          }
          expect(ws.isPaused).toBe(false);
          // The Close frame is still buffered.
          expect(ws.bufferedAmount).toBeGreaterThan(0);
          let remaining = sent * (CHUNK.byteLength + 14) + 8;
          origin.on("data", chunk => {
            if ((remaining -= chunk.length) === 0) origin.end(closeFrame(1000));
          });
          origin.resume();
          return closed;
        });
        expect(leaked).toEqual([]);
      });
    }
  });
});

describe("ws package", () => {
  it("pause() inside the open handler buffers frames sent with the 101", async () => {
    const MESSAGES = ["m1", "m2", "m3"];
    await using peer = await createPeer({ afterUpgrade: textFrames(...MESSAGES) });
    using clockServer = await startClock();

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
    await ioRoundtrips(clockServer.clock, 5);
    expect({ received, isPaused: ws.isPaused }).toEqual({ received: [], isPaused: true });

    ws.resume();
    await done;
    expect(received).toEqual(MESSAGES);
    ws.removeAllListeners("close");
    ws.terminate();
  });

  it("pause()/resume()/isPaused reach the socket", async () => {
    const WS = WsWebSocket;
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
