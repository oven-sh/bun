import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import https from "https";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import tls from "tls";
import { WebSocketServer } from "ws";

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

test.concurrent("server.upgrade(res) on a plain request returns false without corrupting the response", async () => {
  // A plain GET has no uWS upgrade context, so upgrade() must refuse BEFORE the one-shot
  // 101 preamble and the caller-supplied headers are committed to the socket — otherwise the
  // app's documented fallback response is appended after a bogus 101 (a desynced exchange).
  const kBunInternals = Symbol.for("::bunternal::");
  let upgradeResult: boolean | undefined;
  const server = http.createServer((req, res) => {
    const bunServer = (server as any)[kBunInternals];
    const handle = (req.socket as any)[kBunInternals];
    upgradeResult = bunServer.upgrade(handle, { headers: { "x-should-not-appear": "1" } });
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
    });
    socket.setEncoding("latin1");
    let raw = "";
    socket.on("data", chunk => (raw += chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(raw));
  });
  try {
    const raw = await promise;
    expect(upgradeResult).toBe(false);
    expect(raw).toStartWith("HTTP/1.1 200 ");
    expect(raw).not.toContain("101 Switching Protocols");
    expect(raw).not.toContain("x-should-not-appear");
    expect(raw.match(/HTTP\/1\.1 /g)).toHaveLength(1);
    expect(raw.split("\r\n\r\n").at(-1)).toBe("ok");
  } finally {
    server.close();
  }
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
