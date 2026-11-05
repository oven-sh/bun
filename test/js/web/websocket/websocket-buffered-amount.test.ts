import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { tls } from "harness";
import crypto from "node:crypto";
import net from "node:net";
import nodeTls from "node:tls";
import { WebSocket as WS } from "ws";

const CHUNK = new Uint8Array(64 * 1024);
// Each binary frame is header (10 bytes for a 64 KiB payload) + 4-byte mask + payload.
const FRAME = CHUNK.byteLength + 14;
// Upper bound on what the kernel (and any in-process proxy) may absorb before
// the client has to start queueing. Far above what any platform takes on loopback.
const MAX_TO_SATURATE = 1024;
// Frames sent on top of a saturated socket. Every one of them must be counted.
const EXTRA = 16;
// SO_SNDBUF for every socket that sends toward the origin. By default the kernel takes about 4 MiB from each of them
// before the client has to queue.
const SEND_BUFFER = 64 * 1024;
const CLOSE_1000 = Buffer.from([0x88, 0x02, 0x03, 0xe8]);

// A raw origin that completes the WebSocket upgrade and then reads only when
// told to, so the client's send side has to queue. It sees plaintext frames
// (TLS, when any, terminates here or at the proxy), so the byte count it
// reports is payload plus framing.
function rawOrigin(secure: boolean) {
  const { promise: upgraded, resolve: resolveUpgraded } = Promise.withResolvers<net.Socket>();
  let received = 0;
  let tail = Buffer.alloc(0);
  let waitingFor = Infinity;
  let resolveReceived = () => {};
  const sockets = new Set<net.Socket>();
  function onConnection(sock: net.Socket) {
    sockets.add(sock);
    sock.once("data", head => {
      const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(head.toString("latin1"))![1].trim();
      const accept = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      sock.pause();
      sock.on("data", (chunk: Buffer) => {
        received += chunk.length;
        tail = Buffer.concat([tail, chunk]).subarray(-8);
        if (received >= waitingFor) resolveReceived();
      });
      resolveUpgraded(sock);
    });
    sock.on("error", () => {});
  }
  const server = secure
    ? nodeTls.createServer({ key: tls.key, cert: tls.cert }, onConnection)
    : net.createServer(onConnection);
  return {
    listen: () =>
      new Promise<number>(resolve =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
      ),
    upgraded,
    // The last 8 bytes received.
    tail: () => tail,
    // Resolves with the exact byte count once at least `bytes` have arrived.
    receive(bytes: number): Promise<number> {
      waitingFor = bytes;
      const { promise, resolve } = Promise.withResolvers<void>();
      resolveReceived = resolve;
      if (received >= waitingFor) resolve();
      return promise.then(() => received);
    },
    close: () => {
      for (const sock of sockets) sock.destroy();
      server.close();
    },
  };
}

async function pipingConnectProxy(secure: boolean): Promise<{ port: number; close(): void }> {
  function onConnection(client: net.Socket) {
    client.once("data", head => {
      const match = /^CONNECT ([^:]+):(\d+) /.exec(head.toString("latin1"));
      if (!match) {
        client.destroy();
        return;
      }
      const upstream = net.connect(Number(match[2]), match[1], () => {
        setSocketOptions(upstream, 1, SEND_BUFFER);
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

function open(ws: WebSocket): Promise<void> {
  return new Promise(resolve => {
    ws.onopen = () => {
      setSocketOptions(ws, 1, SEND_BUFFER);
      resolve();
    };
  });
}

// Sends 64 KiB frames to a peer that is not reading. The kernel absorbs the
// first few, so bufferedAmount stays 0 until the socket is saturated. From
// then on nothing drains until the event loop turns, so every further frame
// must add exactly its framed size. Returns the number of frames sent.
function sendUntilCounted(ws: { send(data: Uint8Array): void; readonly bufferedAmount: number }): number {
  expect(ws.bufferedAmount).toBe(0);
  let sent = 0;
  while (ws.bufferedAmount === 0 && sent < MAX_TO_SATURATE) {
    ws.send(CHUNK);
    sent++;
  }
  // At most the frame that did not fit (through a TLS proxy tunnel it is that
  // frame's ciphertext, a few record headers larger).
  const saturated = ws.bufferedAmount;
  expect(saturated).toBeGreaterThan(0);
  expect(saturated).toBeLessThan(2 * FRAME);

  for (let i = 0; i < EXTRA; i++) ws.send(CHUNK);
  sent += EXTRA;
  expect(ws.bufferedAmount).toBe(saturated + EXTRA * FRAME);
  return sent;
}

const MODES = [
  { name: "ws", secure: false, proxy: null },
  { name: "wss", secure: true, proxy: null },
  { name: "wss via http:// proxy", secure: true, proxy: "http" },
  { name: "wss via https:// proxy", secure: true, proxy: "https" },
  { name: "ws via https:// proxy", secure: false, proxy: "https" },
] as const;

// Opens a WebSocket to a raw origin, through a proxy if the mode has one. `peer` is the origin's paused socket.
async function connect(mode: (typeof MODES)[number]) {
  const origin = rawOrigin(mode.secure);
  const originPort = await origin.listen();
  const proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
  const ws = new WebSocket(`${mode.secure ? "wss" : "ws"}://127.0.0.1:${originPort}`, {
    tls: { rejectUnauthorized: false },
    ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
  });
  await open(ws);
  return {
    ws,
    origin,
    peer: await origin.upgraded,
    [Symbol.dispose]() {
      proxy?.close();
      origin.close();
    },
  };
}

for (const mode of MODES) {
  describe(`WebSocket.bufferedAmount (${mode.name})`, () => {
    it("counts bytes the peer has not accepted and drains to 0", async () => {
      using connection = await connect(mode);
      const { ws, origin, peer } = connection;

      const sent = sendUntilCounted(ws);
      const queued = ws.bufferedAmount;

      // Only what the kernel can still absorb drains while the peer isn't reading.
      await new Promise(resolve => setImmediate(resolve));
      expect(ws.bufferedAmount).toBeGreaterThan(0);
      expect(ws.bufferedAmount).toBeLessThanOrEqual(queued);

      peer.resume();
      expect(await origin.receive(sent * FRAME)).toBe(sent * FRAME);
      expect(ws.bufferedAmount).toBe(0);
      ws.close();
      expect(ws.bufferedAmount).toBe(0);
    });

    it("close() queues the Close frame behind pending frames", async () => {
      using connection = await connect(mode);
      const { ws, origin, peer } = connection;
      const closed = new Promise<CloseEvent>(resolve => (ws.onclose = resolve));

      const sent = sendUntilCounted(ws);
      ws.close(1000);
      peer.resume();
      // The Close frame is 8 bytes: 2 header, 4 mask, 2 status code.
      expect(await origin.receive(sent * FRAME + 8)).toBe(sent * FRAME + 8);
      // The Close frame must come last. Servers stop reading at it, so a frame after it would be lost.
      expect([...origin.tail().subarray(0, 2)]).toEqual([0x88, 0x82]);
      peer.end(CLOSE_1000);
      const { code, wasClean } = await closed;
      expect({ code, wasClean }).toEqual({ code: 1000, wasClean: true });
    });

    // The send queue starts as a 2048-byte ring buffer. When a frame ends exactly
    // at the end of the ring, later frames wrap to the start. The writable handler
    // used to flush only up to the end of the ring. That write succeeds in full, so
    // no other writable event fires, and the wrapped frames (and any Close frame
    // after them) stayed stuck in the queue.
    it("drains to 0 when the send queue wraps around its ring buffer", async () => {
      using connection = await connect(mode);
      const { ws, origin, peer } = connection;
      const closed = Promise.withResolvers<number>();
      ws.onclose = event => closed.resolve(event.code);
      const disconnected = new Promise<never>((_, reject) => {
        ws.onerror = event => reject(new Error(`WebSocket error: ${(event as ErrorEvent).message}`));
        peer.on("close", () => reject(new Error("connection closed before all bytes arrived")));
      });
      disconnected.catch(() => {});

      // Total bytes sent, including each frame's 8-byte header.
      let sent = 0;
      const send = (payload: number) => {
        ws.send(new Uint8Array(payload));
        sent += payload + 8;
      };
      const tunnel = mode.secure && mode.proxy !== null;
      if (tunnel) {
        // A TLS tunnel accepts each frame whole. A 1536-byte frame passes
        // through the queue and leaves its read position at 1536.
        while (ws.bufferedAmount === 0 && sent < MAX_TO_SATURATE * FRAME) send(1528);
        const bufferedInTunnel = ws.bufferedAmount;
        send(504);
        // Queued whole, filling the ring from 1536 to its end.
        expect(ws.bufferedAmount - bufferedInTunnel).toBe(512);
      } else {
        // A 1024-byte frame passes through the queue and leaves its read
        // position at 1024.
        send(1016);
        expect(ws.bufferedAmount).toBe(0);
        // Smaller frames skip the queue. Only the part of the last one that
        // the socket didn't accept is queued, starting at 1024.
        while (ws.bufferedAmount === 0 && sent < MAX_TO_SATURATE * FRAME) send(504);
        send(1024 - ws.bufferedAmount - 8);
        // The queue now ends exactly at the end of the ring.
        expect(ws.bufferedAmount).toBe(1024);
      }
      // A 13-byte frame that wraps to the start of the ring, then a 9-byte Close frame.
      ws.send("wrapped");
      ws.close(1000, "x");
      sent += 13 + 9;

      peer.resume();
      expect(await Promise.race([origin.receive(sent), disconnected])).toBe(sent);
      expect(ws.bufferedAmount).toBe(0);
      peer.end(CLOSE_1000);
      expect(await closed.promise).toBe(1000);
    });
  });
}

describe("WebSocket.bufferedAmount", () => {
  it("is 0 once a small message has been written", async () => {
    using server = Bun.serve({
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
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    await open(ws);
    const { promise: echoed, resolve } = Promise.withResolvers<string>();
    ws.onmessage = ({ data }) => resolve(data);
    ws.send("hello");
    expect(await echoed).toBe("hello");
    expect(ws.bufferedAmount).toBe(0);
    ws.close();
  });

  // "The bufferedAmount attribute does not reset to zero once the connection closes."
  it.each([
    ["terminate()", (ws: WebSocket) => ws.terminate()],
    ["a protocol error", (_ws: WebSocket, peer: net.Socket) => void peer.write(Buffer.from([0x83, 0x00]))],
    ["the peer disconnects", (_ws: WebSocket, peer: net.Socket) => void peer.destroy()],
    ["the server sends Close and disconnects", (_ws: WebSocket, peer: net.Socket) => void peer.end(CLOSE_1000)],
  ] as const)("keeps counting unsent bytes after %s, and send() still adds its payload", async (_label, disconnect) => {
    const origin = rawOrigin(false);
    const originPort = await origin.listen();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${originPort}`);
      await open(ws);
      const peer = await origin.upgraded;
      sendUntilCounted(ws);
      const queued = ws.bufferedAmount;
      const closed = new Promise(resolve => (ws.onclose = resolve));
      disconnect(ws, peer);
      await closed;
      const afterClose = ws.bufferedAmount;
      // The kernel may have accepted more bytes, and an 8-byte Close frame may have been queued.
      expect(afterClose).toBeGreaterThan(FRAME);
      expect(afterClose).toBeLessThanOrEqual(queued + 8);
      ws.send("12345");
      ws.ping();
      expect(ws.bufferedAmount).toBe(afterClose + 5);
    } finally {
      origin.close();
    }
  });

  it("ws package reports the same number", async () => {
    const origin = rawOrigin(false);
    const originPort = await origin.listen();
    try {
      const ws = new WS(`ws://127.0.0.1:${originPort}`);
      await new Promise(resolve => ws.once("open", resolve));
      setSocketOptions(ws, 1, SEND_BUFFER);
      const peer = await origin.upgraded;
      const sent = sendUntilCounted(ws);
      peer.resume();
      expect(await origin.receive(sent * FRAME)).toBe(sent * FRAME);
      expect(ws.bufferedAmount).toBe(0);
      ws.close();
    } finally {
      origin.close();
    }
  });
});
