import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import http from "http";
import https from "https";
import type { AddressInfo } from "node:net";
import net from "node:net";
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

test.concurrent("RST on a ws-upgraded connection emits 'error' ECONNRESET then 'close' on the socket", async () => {
  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  const upgraded = Promise.withResolvers<void>();
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", ws => {
    ws.on("error", () => {});
    upgraded.resolve();
  });
  server.on("connection", socket => {
    events.push("connection");
    socket.on("end", () => events.push("socket-end"));
    socket.on("error", (e: any) => events.push("socket-error " + e.code));
    socket.on("close", () => {
      events.push("socket-close");
      closed.resolve();
    });
  });
  try {
    server.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const client = net.connect(port, "127.0.0.1");
    client.setNoDelay(true);
    client.on("error", () => {});
    client.on("connect", () => {
      client.write(
        `GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
    });
    let buf = "";
    const handshake = Promise.withResolvers<void>();
    client.on("data", chunk => {
      buf += chunk.toString("latin1");
      if (buf.includes("\r\n\r\n")) handshake.resolve();
    });
    await handshake.promise;
    expect(buf.slice(0, "HTTP/1.1 101".length)).toBe("HTTP/1.1 101");
    // The ws server has adopted the socket: the RST below exercises the
    // WebSocketContext onClose path, not the plain HTTP one.
    await upgraded.promise;
    client.resetAndDestroy();
    await closed.promise;
    expect(events).toEqual(["connection", "socket-error ECONNRESET", "socket-close"]);
  } finally {
    wss.close();
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
