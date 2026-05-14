import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import https from "https";
import { createHash } from "node:crypto";
import http from "node:http";
import { connect as netConnect, type AddressInfo } from "node:net";
import tls from "tls";
import { WebSocketServer } from "ws";

// RFC 6455 GUID appended to Sec-WebSocket-Key before hashing.
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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

// Regression test for the rsbuild HMR failure reported in #30661 (duplicate of
// #9882, #18945, #14522, #26924): `server.on("upgrade", (req, socket) =>
// socket.write(response))` was a silent no-op because the upgrade socket was
// not handed off to userland. The 101 handshake never left the server, the
// browser's WebSocket attempt timed out, and rsbuild surfaced that as an HMR
// error. Any `ws`-based stack (vite, webpack-dev-server, http-proxy, socket.io)
// hits the same path.
test.concurrent("server.on('upgrade') hands the raw socket off to userland", async () => {
  await using server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end("not upgrade");
  });

  const serverReceived: Buffer[] = [];
  const { promise: serverGotData, resolve: resolveServerData } = Promise.withResolvers<void>();
  const { promise: serverClosed, resolve: resolveServerClosed } = Promise.withResolvers<void>();

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"] as string;
    const accept = createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on("data", chunk => {
      serverReceived.push(chunk);
      resolveServerData();
    });
    socket.on("close", () => resolveServerClosed());
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  const client = netConnect(port, "127.0.0.1");
  const handshakeBuf: Buffer[] = [];
  const { promise: handshakeDone, resolve: resolveHandshake } = Promise.withResolvers<string>();
  client.on("data", chunk => {
    handshakeBuf.push(chunk);
    const joined = Buffer.concat(handshakeBuf).toString("utf8");
    if (joined.includes("\r\n\r\n")) resolveHandshake(joined);
  });
  client.write(
    "GET /hmr HTTP/1.1\r\n" +
      `Host: 127.0.0.1:${port}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
  );

  const handshake = await handshakeDone;
  expect(handshake).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
  expect(handshake).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  // Only one HTTP status line — the response lifecycle must not sneak a 200 OK
  // onto the wire after the handshake.
  expect(handshake.split("HTTP/1.1").length - 1).toBe(1);

  // Post-upgrade bytes from the client must reach the server's `data` listener
  // (uWS would otherwise keep parsing the socket as HTTP and drop the payload).
  client.write(Buffer.from([0x81, 0x83, 0x00, 0x00, 0x00, 0x00, 0x66, 0x6f, 0x6f]));
  await serverGotData;
  expect(Buffer.concat(serverReceived)).toEqual(Buffer.from([0x81, 0x83, 0x00, 0x00, 0x00, 0x00, 0x66, 0x6f, 0x6f]));

  client.end();
  await serverClosed;
});

test.concurrent("server.on('upgrade') works over TLS (https)", async () => {
  await using server = https.createServer(options, (_req, res) => {
    res.writeHead(200);
    res.end("not upgrade");
  });

  const serverReceived: Buffer[] = [];
  const { promise: serverGotData, resolve: resolveServerData } = Promise.withResolvers<void>();

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"] as string;
    const accept = createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on("data", chunk => {
      serverReceived.push(chunk);
      resolveServerData();
    });
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  const client = tls.connect({ port, host: "127.0.0.1", ca: options.cert, rejectUnauthorized: false });
  const handshakeBuf: Buffer[] = [];
  const { promise: handshakeDone, resolve: resolveHandshake } = Promise.withResolvers<string>();
  client.on("data", chunk => {
    handshakeBuf.push(chunk);
    const joined = Buffer.concat(handshakeBuf).toString("utf8");
    if (joined.includes("\r\n\r\n")) resolveHandshake(joined);
  });
  await new Promise<void>(r => client.on("secureConnect", r));
  client.write(
    "GET /hmr HTTP/1.1\r\n" +
      `Host: 127.0.0.1:${port}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
  );

  const handshake = await handshakeDone;
  expect(handshake).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
  expect(handshake).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");

  client.write(Buffer.from([0x81, 0x83, 0x00, 0x00, 0x00, 0x00, 0x66, 0x6f, 0x6f]));
  await serverGotData;
  expect(Buffer.concat(serverReceived)).toEqual(Buffer.from([0x81, 0x83, 0x00, 0x00, 0x00, 0x00, 0x66, 0x6f, 0x6f]));

  client.end();
});
