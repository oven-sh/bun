import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { tls as cert, isWindows } from "harness";
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { closePayload, encodeFrame, OP } from "../../web/websocket/raw-peer";

// Drives the uws BackPressure buffer through its append / erase / resize paths
// and verifies the bytes that reach the client exactly match what was sent.

// SO_SNDBUF for the server's sockets. By default the kernel takes about 4 MiB before anything lands in BackPressure.
const SEND_BUFFER = 64 * 1024;

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
async function pausedClient(port: number, secure = false): Promise<{ sock: net.Socket; initial: Buffer }> {
  const sock = secure
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(port, "127.0.0.1");
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  sock.on("error", reject);
  sock.once("close", () => reject(new Error("socket closed before upgrade completed")));
  let buf: Buffer = Buffer.alloc(0);
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
  sock.on(secure ? "secureConnect" : "connect", () => {
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
  it("delivers a large direct send byte-for-byte while draining", async () => {
    const SIZE = 1024 * 1024;
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
        backpressureLimit: SIZE * 2,
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

    const { sock, initial } = await pausedClient(server.port!);
    const ws = await opened.promise;
    // Send only after the client has paused its read side so the kernel send
    // buffer is the only sink; a non-empty remainder lands in BackPressure.
    setSocketOptions(ws, 1, SEND_BUFFER);
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
    sock.on("data", (chunk: Buffer) => {
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
    // Exceeds WINDOW plus what the kernel takes, so the window fills. Winsock may take any write whole.
    const COUNT = isWindows ? 2048 : 512;
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
    const fill = (ws: import("bun").ServerWebSocket<undefined>) => {
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
        backpressureLimit: WINDOW * 4,
        idleTimeout: 0,
        open(ws) {
          setSocketOptions(ws, 1, SEND_BUFFER);
          fill(ws);
        },
        drain: fill,
        message() {},
        close() {
          drained.resolve();
        },
      },
    });

    const { sock, initial } = await pausedClient(server.port!);

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
    sock.on("data", (chunk: Buffer) => {
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

// However a server socket gets closed, the client must receive every frame uws
// accepted, then the Close frame, then the FIN. readToEnd() times the FIN. If
// end() doesn't send it, uws only closes when the end() timer fires, 16 s at
// the default idleTimeout, so don't lower idleTimeout in these tests.
describe.concurrent.each(["ws", "wss"] as const)("%s: close()", scheme => {
  type ServerWebSocket = import("bun").ServerWebSocket<unknown>;
  const secure = scheme === "wss";
  const FRAME = 1024 * 1024;
  const LIMIT = 2 * FRAME;
  // Server frame: FIN + binary, 64-bit extended length, no mask.
  const frameHeader = Buffer.from([0x82, 0x7f, 0, 0, 0, 0, 0, 0x10, 0, 0]);

  // Counts the complete 1 MiB frames at the start of the stream and returns the
  // trailing bytes, so a failure shows where the stream stopped.
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
    return { dataFrames, rest: rest.length <= 64 ? rest.toString("hex") : `${rest.length} bytes` };
  }

  // Expected value of { ...(await readToEnd()), closeEvent }.
  function delivered(dataFrames: number, code: number, reason: string, closeEvent = { code, reason }) {
    return {
      dataFrames,
      rest: encodeFrame(OP.close, closePayload(code, reason)).toString("hex"),
      finInTime: true,
      closeEvent,
    };
  }

  // Sends 1 MiB frames until uws drops one (returns 0). Returns how many it
  // accepted. Every frame reported as sent (> 0) or buffered (-1) must reach
  // the client.
  function fillPastLimit(ws: ServerWebSocket): number {
    setSocketOptions(ws, 1, SEND_BUFFER);
    const payload = Buffer.alloc(FRAME);
    let accepted = 0;
    while (ws.sendBinary(payload) !== 0) {
      if (++accepted === 64) throw new Error("send() never reported a drop");
    }
    expect(ws.getBufferedAmount()).toBeGreaterThan(LIMIT);
    return accepted;
  }

  // Resumes the paused client and reads until the server's FIN.
  async function readToEnd(sock: net.Socket, initial: Buffer) {
    const chunks = [initial];
    const finished = new Promise<void>(resolve => {
      sock.once("end", resolve);
      sock.once("close", resolve);
    });
    sock.on("data", chunk => chunks.push(chunk));
    const start = performance.now();
    sock.resume();
    await finished;
    const finInTime = performance.now() - start < 12_000;
    sock.destroy();
    return { ...splitStream(Buffer.concat(chunks)), finInTime };
  }

  function serve(options: {
    open?: (ws: ServerWebSocket) => void;
    drain?: (ws: ServerWebSocket) => void;
    // Upgrade from a later task, so open() runs inside uws's own cork(). On a
    // synchronous upgrade it runs inside the HTTP parser, which already holds
    // the cork and uncorks the socket afterwards.
    asyncUpgrade?: boolean;
  }) {
    const closed = Promise.withResolvers<{ code: number; reason: string }>();
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(secure ? { tls: cert } : {}),
      async fetch(req, s) {
        if (options.asyncUpgrade) await new Promise(resolve => setImmediate(resolve));
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

  // Once over backpressureLimit, uws drops new frames. It must not drop the
  // Close frame. That has to queue behind the buffered data, and the FIN has to
  // wait until the buffer drains.
  describe("while over backpressureLimit", () => {
    it("ws.close() flushes buffered frames before the Close frame", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port!, secure);
      const ws = await opened.promise;
      const accepted = fillPastLimit(ws);

      ws.close(1000, "bye");

      expect({ ...(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(accepted, 1000, "bye"),
      );
    });

    it("echoes the client's Close frame after the buffered frames", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port!, secure);
      const accepted = fillPastLimit(await opened.promise);

      // The client's read side is paused, but it can still write.
      sock.write(encodeFrame(OP.close, closePayload(4001, "peer"), { mask: true }));
      const closeEvent = await closed;

      expect({ ...(await readToEnd(sock, initial)), closeEvent }).toEqual(delivered(accepted, 4001, "peer"));
    });

    it("sends the 1002 Close frame for an invalid frame after the buffered frames", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port!, secure);
      const accepted = fillPastLimit(await opened.promise);

      sock.write(encodeFrame(3, "", { mask: true }));
      const closeEvent = await closed;

      expect({ ...(await readToEnd(sock, initial)), closeEvent }).toEqual(
        delivered(accepted, 1002, "Received invalid opcode", { code: 1006, reason: "Received invalid opcode" }),
      );
    });

    // The client can't read anything before open() returns, so the socket is
    // still over the limit when close() runs.
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
      const { sock, initial } = await pausedClient(server.port!, secure);
      const accepted = await filled.promise;

      expect({ ...(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(accepted, 1000, "bye"),
      );
    });
  });

  // Bun runs every handler corked, so the Close frame sits in the cork buffer
  // until the handler returns. end() has to flush it and send the FIN itself,
  // because the code that uncorks afterwards doesn't check for a pending close.
  describe("from a corked handler", () => {
    it("ws.close() inside open() after a synchronous upgrade", async () => {
      const { server, closed } = serve({ open: ws => ws.close(1000, "bye") });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port!, secure);

      expect({ ...(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(delivered(0, 1000, "bye"));
    });

    it("ws.close() inside open() after an asynchronous upgrade", async () => {
      const { server, closed } = serve({ asyncUpgrade: true, open: ws => ws.close(1000, "bye") });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port!, secure);

      expect({ ...(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(delivered(0, 1000, "bye"));
    });

    it("ws.close() inside ws.cork()", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port!, secure);
      const ws = await opened.promise;

      ws.cork(() => ws.close(1000, "bye"));

      expect({ ...(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(delivered(0, 1000, "bye"));
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
      const { sock, initial } = await pausedClient(server.port!, secure);
      const accepted = fillPastLimit(await opened.promise);

      expect({ ...(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(
        delivered(accepted, 1000, "bye"),
      );
    });

    // uws echoes a Close frame from inside its corked data handler.
    it("echoes the client's Close frame and then sends the FIN", async () => {
      const opened = Promise.withResolvers<ServerWebSocket>();
      const { server, closed } = serve({ open: opened.resolve });
      await using _server = server;
      const { sock, initial } = await pausedClient(server.port!, secure);
      await opened.promise;

      sock.write(encodeFrame(OP.close, closePayload(4001, "peer"), { mask: true }));

      expect({ ...(await readToEnd(sock, initial)), closeEvent: await closed }).toEqual(delivered(0, 4001, "peer"));
    });
  });
});

// The socket polls for writable after the upgrade (TLS), after pause() and after resume().
// None of those writable events should call drain().
describe.concurrent.each(["ws", "wss"] as const)("%s: drain()", scheme => {
  it("doesn't fire without backpressure", async () => {
    let drains = 0;
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(scheme === "wss" ? { tls: cert } : {}),
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("no", { status: 500 });
      },
      websocket: {
        message(ws, message) {
          if (message === "pause") {
            ws.pause();
            setImmediate(() => ws.resume());
          }
          ws.send(message);
        },
        drain() {
          drains++;
        },
      },
    });

    const client = new WebSocket(`${scheme}://127.0.0.1:${server.port}`, { tls: { rejectUnauthorized: false } });
    const echo = (message: string) => {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      client.onmessage = event => resolve(event.data);
      client.onclose = event => reject(new Error(`closed: ${event.code}`));
      client.send(message);
      return promise;
    };
    try {
      await new Promise((resolve, reject) => {
        client.onopen = resolve;
        client.onerror = reject;
      });
      // Each round trip runs the server's event loop at least once more.
      expect([await echo("first"), await echo("pause"), await echo("resumed"), await echo("last")]).toEqual([
        "first",
        "pause",
        "resumed",
        "last",
      ]);
      expect(drains).toBe(0);
    } finally {
      client.onclose = null;
      client.terminate();
    }
  });
});
