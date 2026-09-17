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

// A client may send frames before it has the 101 (RFC 6455 tells it to wait,
// but npm ws on Node.js delivers them anyway). They reach the server either in
// the head of the 'upgrade' event or as data on the raw socket while a
// deferred handleUpgrade() waits. Both must reach the WebSocket's parser.
describe.concurrent("frames the client sends before the 101", () => {
  const upgradeRequest =
    "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";

  // FIN + opcode, masked with a zero key (a server only requires that the mask bit is set).
  function maskedFrame(opcode: number, payload: string) {
    return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length, 0, 0, 0, 0]), Buffer.from(payload)]);
  }
  const text = (payload: string) => maskedFrame(0x1, payload);
  const ping = (payload: string) => maskedFrame(0x9, payload);

  // 'pushed-after-handoff': the server pushes the early bytes into the socket
  // right after handleUpgrade() returns, like the task that delivers a chunk
  // net.Socket read just before the handoff.
  type Mode = "in-event" | "deferred" | "verifyClient" | "later-read" | "pushed-after-handoff";
  const modes: Mode[] = ["in-event", "deferred", "verifyClient", "later-read", "pushed-after-handoff"];

  // Runs one connection. `early` goes out before the 101, `afterUpgrade` right
  // after it. Resolves with what the server's 'message' listener saw and the
  // pong payloads the client received, once the "later" text frame has arrived
  // at the server and `expectedPongs` pongs at the client.
  async function run(mode: Mode, secure: boolean, early: Buffer, afterUpgrade: Buffer[], expectedPongs = 0) {
    const seen: string[] = [];
    const pongs: string[] = [];
    const done = Promise.withResolvers<{ seen: string[]; pongs: string[] }>();
    const settle = () => {
      if (seen.includes("later") && pongs.length >= expectedPongs) done.resolve({ seen, pongs });
    };
    const onConnection = (ws: WsWebSocket) => {
      ws.on("message", data => {
        seen.push(String(data));
        settle();
      });
    };

    await using server = secure ? https.createServer(options) : http.createServer();
    // 'later-read' mode: the client writes the early frame only once the
    // server has the request, and the server upgrades only once that frame
    // reached the raw socket.
    const gotRequest = Promise.withResolvers<void>();
    if (mode === "verifyClient") {
      new WebSocketServer({ server, verifyClient: (_info, cb) => setImmediate(() => cb(true)) }).on(
        "connection",
        onConnection,
      );
    } else {
      const wss = new WebSocketServer({ noServer: true });
      server.on("upgrade", (req, socket, head) => {
        const upgrade = () => wss.handleUpgrade(req, socket, head, onConnection);
        if (mode === "in-event") upgrade();
        else if (mode === "deferred") setImmediate(upgrade);
        else if (mode === "pushed-after-handoff") {
          upgrade();
          socket.push(early);
        } else {
          socket.once("readable", () => setImmediate(upgrade));
          gotRequest.resolve();
        }
      });
    }
    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as AddressInfo).port;

    const client: net.Socket = secure
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
      : net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    client.on("close", () => done.reject(new Error(`connection closed, server saw ${JSON.stringify(seen)}`)));
    await once(client, secure ? "secureConnect" : "connect");
    if (mode === "later-read") {
      client.write(upgradeRequest);
      await gotRequest.promise;
      client.write(early);
    } else if (mode === "pushed-after-handoff") {
      client.write(upgradeRequest);
    } else {
      client.write(Buffer.concat([Buffer.from(upgradeRequest), early]));
    }

    let buffered = Buffer.alloc(0);
    let gotHead = false;
    client.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!gotHead) {
        const end = buffered.indexOf("\r\n\r\n");
        if (end === -1) return;
        const status = buffered.subarray(0, end).toString().split("\r\n")[0];
        if (status !== "HTTP/1.1 101 Switching Protocols") {
          done.reject(new Error(`upgrade failed: ${status}`));
          return;
        }
        gotHead = true;
        buffered = buffered.subarray(end + 4);
        for (const frame of afterUpgrade) client.write(frame);
      }
      // Server frames are unmasked and short here: [opcode, length, payload].
      while (buffered.length >= 2 && buffered.length >= 2 + (buffered[1] & 0x7f)) {
        const length = buffered[1] & 0x7f;
        if ((buffered[0] & 0x0f) === 0xa) pongs.push(buffered.subarray(2, 2 + length).toString());
        buffered = buffered.subarray(2 + length);
      }
      settle();
    });

    try {
      return await done.promise;
    } finally {
      client.destroy();
    }
  }

  for (const secure of [false, true]) {
    describe(secure ? "over TLS" : "over TCP", () => {
      test.each(modes)("a whole frame, handleUpgrade() %s", async mode => {
        expect(await run(mode, secure, text("early"), [text("later")])).toEqual({
          seen: ["early", "later"],
          pongs: [],
        });
      });

      test.each(modes)("a frame cut in two by the 101, handleUpgrade() %s", async mode => {
        const frame = text("early");
        expect(await run(mode, secure, frame.subarray(0, 3), [frame.subarray(3), text("later")])).toEqual({
          seen: ["early", "later"],
          pongs: [],
        });
      });

      test.each(modes)("a ping among the early frames, handleUpgrade() %s", async mode => {
        expect(await run(mode, secure, Buffer.concat([text("early"), ping("k")]), [text("later")], 1)).toEqual({
          seen: ["early", "later"],
          pongs: ["k"],
        });
      });
    });
  }
});
