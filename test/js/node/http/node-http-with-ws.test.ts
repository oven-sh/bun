import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import http from "http";
import https from "https";
import { once } from "node:events";
import { createRequire } from "node:module";
import { connect, type AddressInfo, type Socket } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import tls from "tls";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";

const require = createRequire(import.meta.url);
const wsPackageRoot = path.resolve(import.meta.dir, "../../../node_modules/ws");
const NpmWebSocket: typeof import("ws").WebSocket = require(path.join(wsPackageRoot, "lib/websocket.js"));
const NpmWebSocketServer: typeof import("ws").WebSocketServer = require(
  path.join(wsPackageRoot, "lib/websocket-server.js"),
);

async function listen(server: http.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function finishKeepAliveRequest(port: number, agent: http.Agent): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = http.get({ agent, host: "127.0.0.1", path: "/warmup", port }, res => {
      res.on("error", reject);
      res.resume();
      res.once("end", resolve);
    });
    req.once("error", reject);
  });
}

function waitForWebSocketOpen(ws: import("ws").WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ws.off("open", onOpen);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before opening"));
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

async function closeWebSocketServer(wss: import("ws").WebSocketServer): Promise<void> {
  for (const ws of wss.clients) {
    ws.terminate();
  }
  await new Promise<void>(resolve => wss.close(() => resolve()));
}

async function openWebSocketWithAgent(params: {
  ServerClass: typeof import("ws").WebSocketServer;
  reuse: boolean;
  onClient?: (ws: import("ws").WebSocket) => void;
  onConnection?: (ws: import("ws").WebSocket) => void;
  serverOptions?: http.ServerOptions;
}) {
  let warmupSocket: Socket | undefined;
  const server = http.createServer(params.serverOptions ?? {}, (req, res) => {
    warmupSocket = req.socket;
    res.end("ok");
  });
  const wss = new params.ServerClass({ noServer: true });
  const upgraded = Promise.withResolvers<{
    head: Buffer;
    socket: Duplex;
    ws: import("ws").WebSocket;
  }>();
  server.on("upgrade", (req, socket, head) => {
    try {
      wss.handleUpgrade(req, socket, head, ws => {
        params.onConnection?.(ws);
        upgraded.resolve({ head, socket, ws });
      });
    } catch (error) {
      upgraded.reject(error);
    }
  });
  const port = await listen(server);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  if (params.reuse) {
    await finishKeepAliveRequest(port, agent);
  }
  const client = new NpmWebSocket(`ws://127.0.0.1:${port}/upgrade`, { agent });
  params.onClient?.(client);
  try {
    await waitForWebSocketOpen(client);
    const accepted = await upgraded.promise;
    if (params.reuse) {
      expect(accepted.socket === warmupSocket).toBe(true);
    }
    return { accepted, agent, client, server, wss };
  } catch (error) {
    client.terminate();
    agent.destroy();
    await closeWebSocketServer(wss);
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw error;
  }
}

async function closeWebSocketFixture(fixture: Awaited<ReturnType<typeof openWebSocketWithAgent>>) {
  fixture.client.terminate();
  fixture.agent.destroy();
  await closeWebSocketServer(fixture.wss);
  await new Promise<void>(resolve => fixture.server.close(() => resolve()));
}

function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const frame = Buffer.alloc(2 + mask.length + payload.length);
  frame[0] = 0x81;
  frame[1] = 0x80 | payload.length;
  mask.copy(frame, 2);
  for (let i = 0; i < payload.length; i++) {
    frame[6 + i] = payload[i] ^ mask[i % mask.length];
  }
  return frame;
}

class SocketReader {
  #buffer = Buffer.alloc(0);
  #failure: Error | undefined;
  #waiters = new Set<{
    reject: (error: Error) => void;
    resolve: () => void;
  }>();

  constructor(readonly socket: Socket) {
    socket.on("data", this.#onData);
    socket.once("error", this.#onError);
    socket.once("close", this.#onClose);
  }

  async readThrough(marker: Buffer): Promise<Buffer> {
    for (;;) {
      const index = this.#buffer.indexOf(marker);
      if (index !== -1) {
        const end = index + marker.length;
        const value = this.#buffer.subarray(0, end);
        this.#buffer = this.#buffer.subarray(end);
        return value;
      }
      if (this.#failure) {
        throw this.#failure;
      }
      await new Promise<void>((resolve, reject) => {
        this.#waiters.add({ reject, resolve });
      });
    }
  }

  close(): void {
    this.socket.off("data", this.#onData);
    this.socket.off("error", this.#onError);
    this.socket.off("close", this.#onClose);
    this.socket.destroy();
  }

  #settleWaiters(): void {
    for (const waiter of this.#waiters) {
      if (this.#failure) waiter.reject(this.#failure);
      else waiter.resolve();
    }
    this.#waiters.clear();
  }

  #onData = (chunk: Buffer) => {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    this.#settleWaiters();
  };

  #onError = (error: Error) => {
    this.#failure = error;
    this.#settleWaiters();
  };

  #onClose = () => {
    this.#failure ??= new Error("Socket closed before the expected bytes arrived");
    this.#settleWaiters();
  };
}

describe.concurrent("npm ws on node:http upgrade sockets", () => {
  test.each([
    ["fresh", false],
    ["reused keep-alive", true],
  ] as const)("delivers the 101 and an immediate callback write on a %s socket", async (_name, reuse) => {
    let connection!: import("ws").WebSocket;
    const message = Promise.withResolvers<Buffer>();
    const fixture = await openWebSocketWithAgent({
      ServerClass: NpmWebSocketServer,
      reuse,
      onClient(ws) {
        ws.once("message", data => message.resolve(Buffer.from(data as Buffer)));
      },
      onConnection(ws) {
        connection = ws;
        ws.send("ready");
      },
    });
    try {
      expect(connection).toBe(fixture.accepted.ws);
      expect(fixture.accepted.head).toEqual(Buffer.alloc(0));
      expect((await message.promise).toString()).toBe("ready");
    } finally {
      await closeWebSocketFixture(fixture);
    }
  });

  test("preserves upgrade head bytes on a reused keep-alive socket", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    const wss = new NpmWebSocketServer({ noServer: true });
    const upgraded = Promise.withResolvers<{ head: Buffer; message: Promise<Buffer> }>();
    server.on("upgrade", (req, socket, head) => {
      const receivedHead = Buffer.from(head);
      try {
        wss.handleUpgrade(req, socket, head, ws => {
          const message = new Promise<Buffer>((resolve, reject) => {
            ws.once("message", data => resolve(Buffer.from(data as Buffer)));
            ws.once("error", reject);
            ws.once("close", () => reject(new Error("WebSocket closed before delivering upgrade head")));
          });
          upgraded.resolve({ head: receivedHead, message });
        });
      } catch (error) {
        upgraded.reject(error);
      }
    });
    const port = await listen(server);
    const socket = connect(port, "127.0.0.1");
    const reader = new SocketReader(socket);
    await once(socket, "connect");
    socket.write("GET /warmup HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await reader.readThrough(Buffer.from("\r\n\r\nok"));
    const frame = maskedTextFrame("head");
    socket.write(
      Buffer.concat([
        Buffer.from(
          "GET /upgrade HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
        ),
        frame,
      ]),
    );
    try {
      const accepted = await upgraded.promise;
      expect(accepted.head).toEqual(frame);
      expect((await accepted.message).toString()).toBe("head");
      expect((await reader.readThrough(Buffer.from("\r\n\r\n"))).toString()).toStartWith(
        "HTTP/1.1 101 Switching Protocols\r\n",
      );
    } finally {
      reader.close();
      await closeWebSocketServer(wss);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test("settles callback and backpressure after a reused keep-alive upgrade", async () => {
    const send = Promise.withResolvers<Error | null | undefined>();
    const drained = Promise.withResolvers<void>();
    let needDrain = false;
    const payload = Buffer.alloc(128 * 1024, 0x61);
    const message = Promise.withResolvers<Buffer>();
    const fixture = await openWebSocketWithAgent({
      ServerClass: NpmWebSocketServer,
      reuse: true,
      serverOptions: { highWaterMark: 16 },
      onClient(ws) {
        ws.once("message", data => message.resolve(Buffer.from(data as Buffer)));
      },
      onConnection(ws) {
        const socket = (ws as WsWebSocket & { _socket: Socket })._socket;
        socket.once("drain", drained.resolve);
        ws.send(payload, error => send.resolve(error));
        needDrain = socket.writableNeedDrain;
        if (!needDrain) {
          drained.reject(new Error("WebSocket payload did not enter stream backpressure"));
        }
      },
    });
    try {
      const [data, sendError] = await Promise.all([message.promise, send.promise, drained.promise]);
      expect(needDrain).toBe(true);
      expect(sendError).toBeNull();
      expect(data).toEqual(payload);
    } finally {
      await closeWebSocketFixture(fixture);
    }
  });

  test("preserves close and protocol-error delivery after a reused keep-alive upgrade", async () => {
    const fixture = await openWebSocketWithAgent({ ServerClass: NpmWebSocketServer, reuse: true });
    const serverError = once(fixture.accepted.ws, "error");
    const serverClose = new Promise<number>(resolve => {
      fixture.accepted.ws.once("close", code => resolve(code));
    });
    try {
      const clientSocket = (fixture.client as import("ws").WebSocket & { _socket: Socket })._socket;
      clientSocket.write(Buffer.from([0x81, 0x01, 0x78]));
      const [[error], code] = await Promise.all([serverError, serverClose]);
      expect((error as Error & { code?: string }).code).toBe("WS_ERR_EXPECTED_MASK");
      expect(code).toBe(1006);
    } finally {
      await closeWebSocketFixture(fixture);
    }
  });

  test.each([
    ["fresh", false],
    ["reused keep-alive", true],
  ] as const)("does not regress Bun's native ws upgrade on a %s socket", async (_name, reuse) => {
    const message = Promise.withResolvers<Buffer>();
    const fixture = await openWebSocketWithAgent({
      ServerClass: WebSocketServer,
      reuse,
      onClient(ws) {
        ws.once("message", data => message.resolve(Buffer.from(data as Buffer)));
      },
      onConnection(ws) {
        ws.send("native");
      },
    });
    try {
      expect((await message.promise).toString()).toBe("native");
    } finally {
      await closeWebSocketFixture(fixture);
    }
  });
});

test.concurrent("WebSocket upgrade should unref poll_ref from response", async () => {
  // Regression test for bug where poll_ref was not unref'd on WebSocket upgrade
  // The bug: NodeHTTPResponse.poll_ref stayed active after upgrade
  // This test verifies activeTasks is correctly decremented after upgrade
  const script = /* js */ `
    const http = require("http");
    const { WebSocketServer } = require("ws");
    const { getEventLoopStats } = require("bun:internal-for-testing");

    const server = http.createServer();
    const wsServer = new WebSocketServer({ server });

    let initialStats;
    process.exitCode = 1;

    wsServer.on("connection", (ws) => {
      // After WebSocket upgrade completes, check active tasks
      const stats = getEventLoopStats();
      ws.close();
      wsServer.close();
      server.close();

      // With the bug: poll_ref from NodeHTTPResponse stays active (activeTasks = 1)
      // With the fix: poll_ref.unref() was called on upgrade (activeTasks should be 0)
      if (stats.activeTasks !== initialStats.activeTasks) {
        console.error("BUG_DETECTED: activeTasks=" + stats.activeTasks + " (expected 0 after upgrade)");
        process.exit(1);
      }

      process.exitCode = 0;
    });

    initialStats = getEventLoopStats();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const ws = new WebSocket("ws://127.0.0.1:" + port);
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should exit cleanly without detecting the bug
  expect(stderr).not.toContain("BUG_DETECTED");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("should not crash when closing sockets after upgrade", async () => {
  const { promise, resolve } = Promise.withResolvers();
  let http_sockets: tls.TLSSocket[] = [];

  const server = https.createServer(options, (req, res) => {
    http_sockets.push(res.socket as tls.TLSSocket);
    res.writeHead(200, { "Content-Type": "text/plain", "Connection": "Keep-Alive" });
    res.end("okay");
    res.detachSocket(res.socket!);
  });

  server.listen(0, "127.0.0.1", () => {
    const wsServer = new WebSocketServer({ server });
    wsServer.on("connection", socket => {});

    const port = (server.address() as AddressInfo).port;
    const socket = tls.connect({ port, ca: options.cert }, () => {
      // normal request keep the socket alive
      socket.write(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Keep-Alive\r\nContent-Length: 0\r\n\r\n`);
      socket.write(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Keep-Alive\r\nContent-Length: 0\r\n\r\n`);
      socket.write(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Keep-Alive\r\nContent-Length: 0\r\n\r\n`);
      // upgrade to websocket
      socket.write(
        `GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
      );
    });
    socket.on("data", data => {
      const isWebSocket = data?.toString().includes("Upgrade: websocket");
      if (isWebSocket) {
        socket.destroy();
        setTimeout(() => {
          http_sockets.forEach(http_socket => {
            http_socket?.destroy();
          });
          server.closeAllConnections();
          resolve();
        }, 10);
      }
    });
  });

  await promise;
  expect().pass();
});

// ws.close() on a server-side socket runs the native close callback before it
// returns. A node:http 'request' or 'upgrade' handler that calls it must still
// run to completion first: the nextTick and promise callbacks the handler
// queued run once it has returned, as in Node.js. They used to run inside the
// close() call.
describe.concurrent("request handlers run to completion before the callbacks they queued", () => {
  function queueThen(order: string[], nativeCall: () => void) {
    process.nextTick(() => order.push("nextTick"));
    Promise.resolve().then(() => order.push("microtask"));
    nativeCall();
    order.push("rest of handler");
  }

  async function listen(server: http.Server) {
    await once(server.listen(0, "127.0.0.1"), "listening");
    return (server.address() as AddressInfo).port;
  }

  // Resolves once the server has closed the socket (or the handshake failed).
  function connectUntilClosed(port: number) {
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    return promise;
  }

  test("the 'connection' handler of a WebSocketServer, run from the upgrade request", async () => {
    const order: string[] = [];
    await using server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on("connection", ws => queueThen(order, () => ws.close()));

    await connectUntilClosed(await listen(server));
    expect(order).toEqual(["rest of handler", "nextTick", "microtask"]);
  });

  test("a 'request' handler closing an open WebSocketServer socket", async () => {
    const order: string[] = [];
    const connected = Promise.withResolvers<WsWebSocket>();
    let held: WsWebSocket;
    await using server = http.createServer((req, res) => {
      queueThen(order, () => held.close());
      res.end("ok");
    });
    const wss = new WebSocketServer({ server });
    wss.on("connection", connected.resolve);

    const port = await listen(server);
    const closed = connectUntilClosed(port);
    held = await connected.promise;
    expect(await fetch(`http://127.0.0.1:${port}/`).then(res => res.text())).toBe("ok");
    await closed;
    expect(order).toEqual(["rest of handler", "nextTick", "microtask"]);
  });
});
