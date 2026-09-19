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

test.concurrent("a WebSocket upgrade pipelined behind a pending response completes the handshake", async () => {
  // The 'upgrade' listener gets the socket once the response ahead has finished, so the
  // WebSocketServer answers through the upgrade request's own response and not through the
  // response that was still in flight.
  const events: string[] = [];
  let first: http.ServerResponse | undefined;
  const { promise: finished, resolve: onFinished, reject: onFailure } = Promise.withResolvers<void>();
  await using server = http.createServer((req, res) => {
    events.push(`request ${req.url}`);
    if (req.headers.upgrade !== undefined) {
      onFailure(new Error(`dispatched as a request: ${events}`));
      return;
    }
    first = res;
    res.write("first");
  });
  server.on("clientError", onFailure);
  const wsServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    events.push(`upgrade ${req.url} upgrade=${req.upgrade}`);
    wsServer.handleUpgrade(req, socket, head, ws => {
      events.push("connection");
      ws.on("message", data => {
        events.push(`message ${data}`);
        ws.close();
      });
      ws.on("close", onFinished);
    });
    // The handshake completes only once the response ahead has finished.
    events.push("first end()");
    first!.end();
  });
  server.shouldUpgradeCallback = req => {
    events.push(`shouldUpgradeCallback ${req.url}`);
    return true;
  };
  await once(server.listen(0, "127.0.0.1"), "listening");

  const port = (server.address() as AddressInfo).port;
  const client = net.connect(port, "127.0.0.1");
  try {
    let received = Buffer.alloc(0);
    client.on("data", chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.includes("\r\n\r\n", received.indexOf("HTTP/1.1 101"))) {
        // A masked text frame "hi" (RFC 6455 5.7), sent once the handshake is complete.
        client.write(Buffer.from([0x81, 0x82, 0x01, 0x02, 0x03, 0x04, 0x68 ^ 0x01, 0x69 ^ 0x02]));
        client.removeAllListeners("data");
        client.resume();
      }
    });
    client.on("error", onFailure);
    client.write(
      `GET /first HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n` +
        `GET /ws HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    );
    await finished;
    expect(events).toEqual([
      "request /first",
      "shouldUpgradeCallback /ws",
      "upgrade /ws upgrade=true",
      "first end()",
      "connection",
      "message hi",
    ]);
    const text = received.toString("latin1");
    // The response ahead is complete before the 101 starts.
    expect(text.indexOf("5\r\nfirst\r\n0\r\n\r\n")).toBeGreaterThan(0);
    expect(text.indexOf("HTTP/1.1 101")).toBeGreaterThan(text.indexOf("5\r\nfirst\r\n0\r\n\r\n"));
  } finally {
    client.destroy();
    wsServer.close();
  }
});
