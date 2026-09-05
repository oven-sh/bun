import { describe, expect, it } from "bun:test";
import { isWindows } from "harness";
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
  // >16KB sends take the direct write2 path and append() the unwritten tail;
  // drain exercises erase() as a head-cursor bump. Skipped on Windows: Winsock
  // loopback accepts the full payload so BackPressure is never reached there.
  it.skipIf(isWindows)("delivers a large direct send byte-for-byte while draining", async () => {
    const SIZE = 8 * 1024 * 1024;
    const payload = patternBuffer(SIZE, 0xabcd);
    const expectedHash = crypto.createHash("sha1").update(payload).digest("hex");

    let bufferedAfterSend = 0;
    let drainSawDecrease = true;
    let prev = Infinity;
    const opened = Promise.withResolvers<import("bun").ServerWebSocket<unknown>>();
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
          opened.resolve(ws);
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
    const ws = await opened.promise;
    // Send only after the client has paused its read side so the kernel send
    // buffer is the only sink; a non-empty remainder lands in BackPressure.
    ws.sendBinary(payload);
    bufferedAfterSend = ws.getBufferedAmount();
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

// Whatever closes a server socket, the client has to end up with every frame
// uws accepted, then the Close frame, then the TCP FIN. readToEnd() below only
// returns once the FIN has arrived, so a missing FIN fails these tests by the
// test timeout: uws's own fallback is the end() timer, 16 s at the default
// idleTimeout, which is why these tests do not lower it.
describe("close()", () => {
  type ServerWebSocket = import("bun").ServerWebSocket<unknown>;
  const FRAME = 1024 * 1024;
  const LIMIT = 2 * FRAME;
  // Server frame: FIN + binary, 64-bit extended length, no mask.
  const frameHeader = Buffer.from([0x82, 0x7f, 0, 0, 0, 0, 0, 0x10, 0, 0]);

  function closeFrame(code: number, reason: string): Buffer {
    return Buffer.concat([Buffer.from([0x88, 2 + reason.length, code >> 8, code & 0xff]), Buffer.from(reason)]);
  }

  // The client side of a Close frame must be masked.
  function maskedCloseFrame(code: number, reason: string): Buffer {
    const payload = closeFrame(code, reason).subarray(2);
    const mask = [0x12, 0x34, 0x56, 0x78];
    return Buffer.from([0x88, 0x80 | payload.length, ...mask, ...Array.from(payload, (byte, i) => byte ^ mask[i & 3])]);
  }

  // Counts the intact 1 MiB frames at the front of what the client read and
  // returns whatever follows them, so a failure shows where the stream ends.
  function splitStream(bytes: Buffer) {
    const perFrame = frameHeader.length + FRAME;
    let dataFrames = 0;
    while (
      bytes.length - dataFrames * perFrame >= perFrame &&
      bytes.subarray(dataFrames * perFrame, dataFrames * perFrame + frameHeader.length).equals(frameHeader)
    ) {
      dataFrames++;
    }
    const rest = bytes.subarray(dataFrames * perFrame);
    return { dataFrames, rest: rest.length <= 16 ? rest.toString("hex") : `${rest.length} bytes` };
  }

  // The expected shape of { ...splitStream(bytes), closeEvent }.
  function delivered(dataFrames: number, code: number, reason: string) {
    return { dataFrames, rest: closeFrame(code, reason).toString("hex"), closeEvent: { code, reason } };
  }

  // Sends 1 MiB frames until uws reports a drop (0) and returns how many it
  // accepted before that. Frames reported as sent (> 0) or buffered (-1) have
  // to reach the client.
  function fillPastLimit(ws: ServerWebSocket): number {
    const payload = Buffer.alloc(FRAME);
    let accepted = 0;
    while (ws.sendBinary(payload) !== 0) {
      if (++accepted === 64) throw new Error("send() never reported a drop");
    }
    expect(ws.getBufferedAmount()).toBeGreaterThan(LIMIT);
    return accepted;
  }

  // Lets the paused client read and returns everything after the handshake,
  // up to the server's FIN.
  async function readToEnd(sock: net.Socket, initial: Buffer): Promise<Buffer> {
    const chunks = [initial];
    const finished = new Promise<void>(resolve => {
      sock.once("end", resolve);
      sock.once("close", resolve);
    });
    sock.on("data", chunk => chunks.push(chunk));
    sock.resume();
    await finished;
    sock.destroy();
    return Buffer.concat(chunks);
  }

  function serve(options: {
    open?: (ws: ServerWebSocket) => void;
    drain?: (ws: ServerWebSocket) => void;
    // Upgrade from a later task. open() then runs from uws's own cork()
    // instead of inside the HTTP parser, which holds the cork of a
    // synchronous upgrade and uncorks the socket itself afterwards.
    asyncUpgrade?: boolean;
  }) {
    const closed = Promise.withResolvers<{ code: number; reason: string }>();
    const server = Bun.serve({
      port: 0,
      async fetch(req, s) {
        if (options.asyncUpgrade) await new Promise(resolve => setTimeout(resolve, 0));
        if (s.upgrade(req)) return;
        return new Response("no", { status: 500 });
      },
      websocket: {
        backpressureLimit: LIMIT,
        open: options.open ?? (() => {}),
        drain: options.drain,
        message() {},
        close(_ws, code, reason) {
          closed.resolve({ code, reason });
        },
      },
    });
    return { server, closed: closed.promise };
  }

  // Over backpressureLimit uws drops every further frame. The Close frame must
  // not be one of them: it has to queue behind the buffered data, and the FIN
  // has to wait until that data has drained.
  describe("while over backpressureLimit", () => {
    it("ws.close() delivers the buffered frames and then the Close frame", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port);
      const ws = await opened.promise;
      const accepted = fillPastLimit(ws);

      ws.close(1000, "bye");

      expect({ ...splitStream(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(accepted, 1000, "bye"),
      );
    });

    it("a Close frame from the client is answered behind the buffered frames", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port);
      const accepted = fillPastLimit(await opened.promise);

      // The client's read side is paused, but it can still write. uws answers
      // the peer's Close frame while the socket is still over the limit.
      sock.write(maskedCloseFrame(4001, "peer"));
      const closeEvent = await closed;

      expect({ ...splitStream(await readToEnd(sock, initial)), closeEvent }).toEqual(delivered(accepted, 4001, "peer"));
    });

    // The client cannot read anything before open() returns, so the socket is
    // over the limit when close() runs.
    it("ws.close() inside open() after a synchronous upgrade", async () => {
      const filled = Promise.withResolvers<number>();
      const { server, closed } = serve({
        open(ws) {
          try {
            filled.resolve(fillPastLimit(ws));
          } catch (error) {
            filled.reject(error);
          }
          ws.close(1000, "bye");
        },
      });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port);
      const accepted = await filled.promise;

      expect({ ...splitStream(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(accepted, 1000, "bye"),
      );
    });
  });

  // Bun runs every handler corked, so the Close frame only leaves the cork
  // buffer when the handler returns. end() has to flush it and send the FIN
  // itself: none of the places that uncork afterwards know about the close.
  describe("from a corked handler", () => {
    it("ws.close() inside open() after a synchronous upgrade", async () => {
      const { server, closed } = serve({ open: ws => ws.close(1000, "bye") });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port);

      expect({ ...splitStream(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(0, 1000, "bye"),
      );
    });

    it("ws.close() inside open() after an asynchronous upgrade", async () => {
      const { server, closed } = serve({ asyncUpgrade: true, open: ws => ws.close(1000, "bye") });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port);

      expect({ ...splitStream(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(0, 1000, "bye"),
      );
    });

    it("ws.close() inside ws.cork()", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port);
      const ws = await opened.promise;

      ws.cork(() => ws.close(1000, "bye"));

      expect({ ...splitStream(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(0, 1000, "bye"),
      );
    });

    it("ws.close() inside drain() once the buffer is empty", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({
        open: opened.resolve,
        drain(ws) {
          if (ws.getBufferedAmount() === 0) ws.close(1000, "bye");
        },
      });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port);
      const accepted = fillPastLimit(await opened.promise);

      expect({ ...splitStream(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(accepted, 1000, "bye"),
      );
    });

    // uws answers a Close frame from inside its corked data handler.
    it("a Close frame from the client is answered and followed by the FIN", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port);
      await opened.promise;

      sock.write(maskedCloseFrame(4001, "peer"));

      expect({ ...splitStream(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(0, 4001, "peer"),
      );
    });
  });
});
