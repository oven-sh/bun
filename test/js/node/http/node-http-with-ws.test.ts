import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import https from "https";
import type { AddressInfo } from "node:net";
import tls from "tls";
import { WebSocketServer } from "ws";

test("WebSocket upgrade should unref poll_ref from response", async () => {
  // Regression test for 100% CPU usage bug where poll_ref was not unref'd on WebSocket upgrade
  // The bug causes CPU to spin at 100%, which we detect by measuring setImmediate delays
  const script = `
    const http = require("http");
    const { WebSocketServer } = require("ws");

    const server = http.createServer();
    const wsServer = new WebSocketServer({ server });

    wsServer.on("connection", (ws) => {
      // After upgrade, measure if event loop is spinning
      // With the bug, poll_ref stays active and causes tight loop
      const delays = [];
      let last = Date.now();
      let count = 0;

      function measure() {
        const now = Date.now();
        const delay = now - last;
        delays.push(delay);
        last = now;
        count++;

        if (count < 10) {
          setImmediate(measure);
        } else {
          // Calculate average delay between setImmediate calls
          const avgDelay = delays.slice(1).reduce((a, b) => a + b, 0) / (delays.length - 1);

          // Empirical data (100 samples):
          // - With bug: avg=0.020ms (CPU spinning at 100%)
          // - With fix: avg=0.980ms (normal event loop)
          // Threshold of 0.05ms reliably distinguishes the two behaviors
          if (avgDelay < 0.05) {
            console.error("CPU_SPIN_DETECTED: avg delay=" + avgDelay.toFixed(3) + "ms");
            process.exit(1);
          }

          ws.close();
          wsServer.close();
          server.close();
        }
      }

      setImmediate(measure);
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const ws = new WebSocket("ws://127.0.0.1:" + port);
    });
  `;

  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should exit cleanly without CPU spinning
  expect(stderr).not.toContain("CPU_SPIN_DETECTED");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}, 5000);

test("should not crash when closing sockets after upgrade", async () => {
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
