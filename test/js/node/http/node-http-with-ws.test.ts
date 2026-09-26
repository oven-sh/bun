import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import http from "http";
import https from "https";
import { once } from "node:events";
import { connect, type AddressInfo } from "node:net";
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

const upgradeRequest =
  "GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
  "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
// A frame masked with a zero key. 0x81 is a whole text message, 0x01 and 0x80 are the first and
// the last fragment of one, 0x89 is a ping.
const frame = (first: number, payload: string) =>
  Buffer.concat([Buffer.from([first, 0x80 | payload.length, 0, 0, 0, 0]), Buffer.from(payload)]);

// node:http stops reading a connection while response bytes are unsent, and parks the requests it
// already received until they drain (flood prevention). A WebSocket upgrade takes the socket out
// of HTTP with that pause still on. Only HTTP lifted it, so the WebSocket never read a frame.
describe.concurrent.each(["http", "https"])(
  "a WebSocket upgrade on an %s connection with unsent response bytes",
  scheme => {
    const get = (path: string) => `GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`;

    // Sends `pipelined` in one write and `afterSwitch` once the 101 is in. Resolves with the message
    // that the WebSocket server received.
    async function messageAfterUpgrade(pipelined: (string | Buffer)[], afterSwitch: Buffer) {
      // Larger than the loopback socket buffers: most of it is still unsent when the handler returns.
      const big = Buffer.alloc(16 * 1024 * 1024, "a");
      const message = Promise.withResolvers<string>();
      const switched = Promise.withResolvers<void>();
      // A test that fails before it awaits these must not add an unhandled rejection.
      message.promise.catch(() => {});
      switched.promise.catch(() => {});
      const onRequest: http.RequestListener = (req, res) => void res.end(req.url === "/big" ? big : "small");
      await using server = scheme === "https" ? https.createServer(options, onRequest) : http.createServer(onRequest);
      const wss = new WebSocketServer({ server });
      wss.on("connection", ws => {
        ws.on("message", data => message.resolve(String(data)));
        ws.on("close", code => message.reject(new Error(`the WebSocket closed with ${code}`)));
      });
      await once(server.listen(0, "127.0.0.1"), "listening");

      const { port } = server.address() as AddressInfo;
      const client =
        scheme === "https" ? tls.connect({ port, host: "127.0.0.1", ca: options.cert }) : connect(port, "127.0.0.1");
      try {
        // A connection that ends early ends both waits, the second one also after the 101.
        const fail = (error: Error) => {
          switched.reject(error);
          message.reject(error);
        };
        client.on("error", fail);
        client.on("close", () => fail(new Error("the connection closed before the server received the message")));
        // The 101 is the last thing the server sends, so it is at the end of what the client has.
        let tail = Buffer.alloc(0);
        client.on("data", chunk => {
          tail = Buffer.concat([tail, chunk]).subarray(-512);
          const status = tail.indexOf("HTTP/1.1 101 ");
          if (status !== -1 && tail.includes("\r\n\r\n", status)) switched.resolve();
        });
        await once(client, scheme === "https" ? "secureConnect" : "connect");
        client.write(Buffer.concat(pipelined.map(part => Buffer.from(part))));
        await switched.promise;
        client.write(afterSwitch);
        return await message.promise;
      } finally {
        client.destroy();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
      }
    }

    test("the Upgrade request is dispatched right behind the response", async () => {
      expect(await messageAfterUpgrade([get("/big"), upgradeRequest], frame(0x81, "later"))).toBe("later");
    });

    test("the Upgrade request is parked, and replayed once the response has drained", async () => {
      const pipelined = [get("/big"), get("/small"), upgradeRequest];
      expect(await messageAfterUpgrade(pipelined, frame(0x81, "later"))).toBe("later");
    });

    // The replay went on after the upgrade and read the WebSocket's state as the HTTP state it
    // replaced. A buffered fragment read as "requests were parked again", and reads stayed paused.
    test("the parked Upgrade request is followed by the first fragment of a message", async () => {
      const pipelined = [get("/big"), get("/small"), upgradeRequest, frame(0x01, "ear")];
      expect(await messageAfterUpgrade(pipelined, frame(0x80, "ly"))).toBe("early");
    });
  },
);

// A request that is still readable keeps the native handle of its connection, and the handle
// outlives a WebSocket upgrade by a later request on that connection. Resuming the earlier
// request then ran the HTTP read machinery over the WebSocket's own state: it cleared the
// length of the buffered fragment, so the message lost everything before the last fragment.
test("resuming an earlier request after a WebSocket upgrade leaves the WebSocket alone", async () => {
  const message = Promise.withResolvers<string>();
  const pinged = Promise.withResolvers<void>();
  const answered = Promise.withResolvers<void>();
  const switched = Promise.withResolvers<void>();
  for (const { promise } of [message, pinged, answered, switched]) promise.catch(() => {});

  // The 'request' listener accepts the upgrade, so the connection never enters tunnel mode.
  // Tunnel mode is the one thing that held the earlier request's resume() back.
  const wss = new WebSocketServer({ noServer: true });
  let earlier!: http.IncomingMessage;
  await using server = http.createServer((req, res) => {
    if (req.headers.upgrade) {
      wss.handleUpgrade(req, req.socket, Buffer.alloc(0), ws => {
        ws.on("ping", () => pinged.resolve());
        ws.on("message", data => message.resolve(String(data)));
        ws.on("close", code => message.reject(new Error(`the WebSocket closed with ${code}`)));
      });
      return;
    }
    earlier = req;
    // A consumed and paused request is not dumped when the response ends, so it stays
    // readable and keeps its handle.
    req.on("data", () => {});
    req.pause();
    res.end("ok");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const client = connect((server.address() as AddressInfo).port, "127.0.0.1");
  try {
    const fail = (error: Error) => {
      for (const { reject } of [message, pinged, answered, switched]) reject(error);
    };
    client.on("error", fail);
    client.on("close", () => fail(new Error("the connection closed before the server received the message")));
    let seen = Buffer.alloc(0);
    client.on("data", chunk => {
      seen = Buffer.concat([seen, chunk]);
      if (seen.includes("ok")) answered.resolve();
      const status = seen.indexOf("HTTP/1.1 101 ");
      if (status !== -1 && seen.includes("\r\n\r\n", status)) switched.resolve();
    });
    await once(client, "connect");
    client.write("POST /earlier HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello");
    await answered.promise;
    client.write(upgradeRequest);
    await switched.promise;

    // The ping follows the fragment in the same read, so the server has buffered the fragment
    // by the time it answers.
    client.write(Buffer.concat([frame(0x01, "hel"), frame(0x89, "p")]));
    await pinged.promise;
    earlier.resume();
    client.write(frame(0x80, "lo"));
    expect(await message.promise).toBe("hello");
  } finally {
    client.destroy();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  }
});
