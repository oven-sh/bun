import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import http from "http";
import https from "https";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
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

// A request that declares a body holds body_read_ref until uWS delivers the
// last chunk of the body. Once the socket is a WebSocket, uWS parses no more
// HTTP on it, so a last chunk that it has not delivered by then never comes.
test.concurrent(
  "WebSocket upgrade should unref body_read_ref from response",
  async () => {
    // later: handleUpgrade() runs in a later task, not inside the 'upgrade' event.
    // missingBytes: how much of the declared body the client never sends.
    const scenarios = [
      { later: false, missingBytes: 0 },
      { later: false, missingBytes: 5 },
      // Control: the last chunk arrives before the upgrade and releases the ref.
      { later: true, missingBytes: 0 },
      { later: true, missingBytes: 5 },
    ];

    const script = /* js */ `
      const http = require("http");
      const net = require("net");
      const { WebSocketServer } = require("ws");
      const { getEventLoopStats } = require("bun:internal-for-testing");

      const activeTasks = () => getEventLoopStats().activeTasks;

      // Resolves with the event loop refs the response holds after the upgrade
      // and after the WebSocket and the server closed.
      function upgrade({ later, missingBytes }) {
        const { promise, resolve, reject } = Promise.withResolvers();
        const before = activeTasks();
        const body = "hello";
        const server = http.createServer();
        const wsServer = new WebSocketServer({ noServer: true });
        let afterUpgrade;

        server.on("upgrade", (req, socket, head) => {
          const handleUpgrade = () =>
            wsServer.handleUpgrade(req, socket, head, ws => {
              afterUpgrade = activeTasks() - before;
              ws.on("close", () => {
                wsServer.close();
                server.close(() => resolve({ afterUpgrade, afterClose: activeTasks() - before }));
              });
            });
          if (later) setImmediate(handleUpgrade);
          else handleUpgrade();
        });

        server.listen(0, "127.0.0.1", () => {
          const client = net.connect(server.address().port, "127.0.0.1");
          client.on("error", reject);
          client.on("close", () => {
            if (afterUpgrade === undefined) reject(new Error("the connection closed before the upgrade"));
          });
          client.write(
            [
              "GET / HTTP/1.1",
              "Host: localhost",
              "Connection: Upgrade",
              "Upgrade: websocket",
              "Sec-WebSocket-Version: 13",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Content-Length: " + (body.length + missingBytes),
              "",
              body,
            ].join("\\r\\n"),
          );
          // The 101 is all the client waits for.
          client.once("data", () => client.destroy());
        });

        return promise;
      }

      (async () => {
        let held = false;
        for (const scenario of ${JSON.stringify(scenarios)}) {
          const refs = await upgrade(scenario);
          console.log(JSON.stringify({ ...scenario, ...refs }));
          held ||= refs.afterUpgrade !== 0 || refs.afterClose !== 0;
        }
        // A ref that is still held keeps the process alive, so do not wait for
        // an exit that does not come.
        if (held) process.exit(1);
      })().catch(err => {
        console.error(err);
        process.exit(1);
      });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // With the bug: afterUpgrade is 1 in every scenario but the control, and
    // afterClose is 1 for an upgrade inside the 'upgrade' event.
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: scenarios
        .map(scenario => JSON.stringify({ ...scenario, afterUpgrade: 0, afterClose: 0 }) + "\n")
        .join(""),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
  // A debug build on a busy machine needs 3 s to load node:http and ws. This test hit the default 5 s there.
  30_000,
);

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
