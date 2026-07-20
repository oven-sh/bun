import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";

// Drives the uws BackPressure buffer through its append / erase / resize paths
// and verifies the bytes that reach the client exactly match what was sent.

function patternBuffer(len: number, seed: number): Buffer {
  const b = Buffer.allocUnsafe(len);
  let x = seed | 1;
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = x >>> 24;
  }
  return b;
}

// Resolves once the raw socket has completed the WS upgrade and paused, so the
// server's outgoing writes land in the BackPressure buffer. Returns the paused
// socket and any frame bytes that arrived after the handshake headers.
async function pausedClient(port: number): Promise<{ sock: net.Socket; initial: Buffer }> {
  const sock = net.connect(port, "127.0.0.1");
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  sock.on("error", reject);
  sock.once("close", () => reject(new Error("socket closed before upgrade completed")));
  let buf = Buffer.alloc(0);
  const onData = (d: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    const i = buf.indexOf("\r\n\r\n");
    if (i < 0) return;
    sock.pause();
    sock.off("data", onData);
    if (!buf.subarray(0, i).toString("latin1").includes(" 101 ")) {
      reject(new Error("upgrade failed: " + buf.subarray(0, i)));
      return;
    }
    resolve(buf.subarray(i + 4));
  };
  sock.on("data", onData);
  sock.on("connect", () => {
    sock.write(
      "GET / HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
  });
  const initial = await promise;
  sock.off("error", reject);
  sock.on("error", () => {});
  return { sock, initial };
}

describe("BackPressure buffer", () => {
  // >16KB sends take the direct us_socket_write2 path and then append() the
  // unwritten tail into BackPressure; drain exercises erase() as a pure
  // head-cursor bump.
  it("delivers a large direct send byte-for-byte while draining", async () => {
    const SIZE = 8 * 1024 * 1024;
    const payload = patternBuffer(SIZE, 0xabcd);
    const expectedHash = crypto.createHash("sha1").update(payload).digest("hex");

    let bufferedAfterSend = 0;
    let drainSawDecrease = true;
    let prev = Infinity;
    const sentSignal = Promise.withResolvers<void>();
    const drained = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("no", { status: 500 });
      },
      websocket: {
        maxBackpressure: SIZE * 2,
        idleTimeout: 0,
        open(ws) {
          ws.sendBinary(payload);
          bufferedAfterSend = ws.getBufferedAmount();
          sentSignal.resolve();
        },
        drain(ws) {
          const b = ws.getBufferedAmount();
          if (b > prev) drainSawDecrease = false;
          prev = b;
          if (b === 0) drained.resolve();
        },
        message() {},
        close() {
          drained.resolve();
        },
      },
    });

    const { sock, initial } = await pausedClient(server.port);
    await sentSignal.promise;

    // 8MB cannot fit in the kernel send buffer, so a non-empty remainder must
    // have been copied into the BackPressure buffer.
    expect(bufferedAfterSend).toBeGreaterThan(0);
    expect(bufferedAfterSend).toBeLessThanOrEqual(SIZE + 10);

    // Drain: read until we have the full 10-byte header + SIZE payload bytes.
    const target = 10 + SIZE;
    const hash = crypto.createHash("sha1");
    let received = 0;
    const consume = (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length && received < target) {
        if (received < 10) {
          const skip = Math.min(10 - received, chunk.length - off);
          received += skip;
          off += skip;
          continue;
        }
        const take = Math.min(target - received, chunk.length - off);
        hash.update(chunk.subarray(off, off + take));
        received += take;
        off += take;
      }
    };
    consume(initial);
    const allReceived = Promise.withResolvers<void>();
    if (received >= target) allReceived.resolve();
    sock.on("data", chunk => {
      consume(chunk);
      if (received >= target) allReceived.resolve();
    });
    sock.on("close", () => allReceived.resolve());
    sock.resume();

    await allReceived.promise;
    await drained.promise;
    sock.destroy();

    expect(drainSawDecrease).toBe(true);
    expect(received).toBe(target);
    expect(hash.digest("hex")).toBe(expectedHash);
  });

  // Small (<16KB) sends go through getSendBuffer(): cork overflow hits
  // BackPressure.resize() then erase(); keeping the window full makes
  // append() compact into the drained head gap instead of reallocating.
  it("delivers many corked frames while appending into a partly-drained buffer", async () => {
    const FRAME = 4096;
    const COUNT = 2048; // 8MB: exceeds Linux tcp_wmem max (4MB) so the window fills
    const WINDOW = 1 * 1024 * 1024;
    const headerLen = 4; // server frame, 16-bit extended length, no mask

    const expected = crypto.createHash("sha1");
    const frames: Buffer[] = [];
    for (let i = 0; i < COUNT; i++) {
      const p = patternBuffer(FRAME, i);
      frames.push(p);
      expected.update(p);
    }
    const expectedHash = expected.digest("hex");

    let sent = 0;
    let sawBufferedAboveWindow = false;
    const drained = Promise.withResolvers<void>();
    const fill = (ws: import("bun").ServerWebSocket<unknown>) => {
      while (sent < COUNT) {
        ws.sendBinary(frames[sent]);
        sent++;
        if (ws.getBufferedAmount() >= WINDOW) {
          sawBufferedAboveWindow = true;
          return;
        }
      }
      if (ws.getBufferedAmount() === 0) drained.resolve();
    };
    await using server = Bun.serve({
      port: 0,
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("no", { status: 500 });
      },
      websocket: {
        maxBackpressure: WINDOW * 4,
        idleTimeout: 0,
        open: fill,
        drain: fill,
        message() {},
        close() {
          drained.resolve();
        },
      },
    });

    const { sock, initial } = await pausedClient(server.port);

    const perFrame = headerLen + FRAME;
    const target = COUNT * perFrame;
    const hash = crypto.createHash("sha1");
    let received = 0;
    let frameOff = 0;
    const consume = (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length && received < target) {
        if (frameOff < headerLen) {
          const skip = Math.min(headerLen - frameOff, chunk.length - off);
          frameOff += skip;
          received += skip;
          off += skip;
          continue;
        }
        const take = Math.min(perFrame - frameOff, chunk.length - off);
        hash.update(chunk.subarray(off, off + take));
        frameOff += take;
        received += take;
        off += take;
        if (frameOff === perFrame) frameOff = 0;
      }
    };
    consume(initial);
    const allReceived = Promise.withResolvers<void>();
    if (received >= target) allReceived.resolve();
    sock.on("data", chunk => {
      consume(chunk);
      if (received >= target) allReceived.resolve();
    });
    sock.on("close", () => allReceived.resolve());
    sock.resume();

    await allReceived.promise;
    await drained.promise;
    sock.destroy();

    expect(sawBufferedAboveWindow).toBe(true);
    expect(sent).toBe(COUNT);
    expect(received).toBe(target);
    expect(hash.digest("hex")).toBe(expectedHash);
  });
});
