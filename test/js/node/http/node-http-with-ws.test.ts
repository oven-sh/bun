import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import http from "http";
import https from "https";
import { once } from "node:events";
import net, { type AddressInfo } from "node:net";
import tls from "tls";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";

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

const kBunInternals = Symbol.for("::bunternal::");
const websocketHandshakeHeaders =
  "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n";

function responseComplete(raw: string): boolean {
  const headEnd = raw.indexOf("\r\n\r\n");
  if (headEnd === -1) return false;
  if (raw.startsWith("HTTP/1.1 101 ")) return true;
  const contentLength = /\r\ncontent-length: (\d+)\r\n/i.exec(raw.slice(0, headEnd + 2));
  return contentLength !== null && raw.length >= headEnd + 4 + Number(contentLength[1]);
}

async function rawUpgradeExchange(server: http.Server, requestHeaders: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\n${requestHeaders}\r\n`);
    });
    socket.setEncoding("latin1");
    let raw = "";
    socket.on("data", chunk => {
      raw += chunk;
      if (responseComplete(raw)) socket.destroy();
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(raw));
  });
  try {
    return await promise;
  } finally {
    server.close();
  }
}

const websocketData = { open() {}, message() {}, close() {}, drain() {}, ping() {}, pong() {} };

test.concurrent("server.upgrade(res) on a plain request returns false without corrupting the response", async () => {
  let upgradeResult: boolean | undefined;
  const server = http.createServer((req, res) => {
    const bunServer = (server as any)[kBunInternals];
    const handle = (req.socket as any)[kBunInternals];
    upgradeResult = bunServer.upgrade(handle, { headers: { "x-should-not-appear": "1" } });
    res.writeHead(200, { "content-type": "text/plain", "content-length": "2" });
    res.end("ok");
  });
  const raw = await rawUpgradeExchange(server, "Connection: close\r\n");
  expect(upgradeResult).toBe(false);
  expect(raw).toStartWith("HTTP/1.1 200 ");
  expect(raw).not.toContain("101 Switching Protocols");
  expect(raw).not.toContain("x-should-not-appear");
  expect(raw.match(/HTTP\/1\.1 /g)).toHaveLength(1);
  expect(raw.split("\r\n\r\n").at(-1)).toBe("ok");
});

test.concurrent("server.upgrade(res) on a websocket handshake delivered to 'request' succeeds", async () => {
  let upgradeResult: boolean | undefined;
  const server = http.createServer(req => {
    const bunServer = (server as any)[kBunInternals];
    const handle = (req.socket as any)[kBunInternals];
    upgradeResult = bunServer.upgrade(handle, { data: websocketData, headers: { "x-accepted": "1" } });
  });
  const raw = await rawUpgradeExchange(server, websocketHandshakeHeaders);
  expect(upgradeResult).toBe(true);
  expect(raw).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
  expect(raw).toContain("\r\nx-accepted: 1\r\n");
});

for (const getter of ["headers", "data"] as const) {
  test.concurrent(`server.upgrade(res) refuses when the ${getter} option getter ends the response`, async () => {
    let upgradeResult: boolean | undefined;
    let getterCalls = 0;
    const server = http.createServer((req, res) => {
      const bunServer = (server as any)[kBunInternals];
      const handle = (req.socket as any)[kBunInternals];
      const options: Record<string, unknown> = getter === "headers" ? { data: websocketData } : {};
      Object.defineProperty(options, getter, {
        enumerable: true,
        get() {
          getterCalls++;
          res.writeHead(200, { "content-type": "text/plain", "content-length": "4" });
          res.end("nope");
          return getter === "headers" ? { "x-should-not-appear": "1" } : websocketData;
        },
      });
      upgradeResult = bunServer.upgrade(handle, options);
    });
    const raw = await rawUpgradeExchange(server, websocketHandshakeHeaders);
    expect(getterCalls).toBe(1);
    expect(upgradeResult).toBe(false);
    expect(raw).toStartWith("HTTP/1.1 200 ");
    expect(raw).not.toContain("101 Switching Protocols");
    expect(raw).not.toContain("x-should-not-appear");
    expect(raw.match(/HTTP\/1\.1 /g)).toHaveLength(1);
    expect(raw.split("\r\n\r\n").at(-1)).toBe("nope");
  });
}

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
