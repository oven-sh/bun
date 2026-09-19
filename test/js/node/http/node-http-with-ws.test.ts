import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as options } from "harness";
import http from "http";
import https from "https";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";
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

// The native upgrade adopts the connection, and the responses ahead of a pipelined Upgrade still
// write through it. So the upgrade waits for them, and its 101 follows them. Node with the npm
// package writes the 101 at once, into or ahead of the response in flight.
describe.concurrent("a WebSocket upgrade that is pipelined behind a pending response", () => {
  const getRequest = (path: string) => `GET ${path} HTTP/1.1\r\nHost: example.com\r\n\r\n`;
  const handshake = (path: string, version = 13) =>
    `GET ${path} HTTP/1.1\r\nHost: example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
    `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: ${version}\r\n\r\n`;
  // A masked text frame, as a client sends it.
  function textFrame(text: string) {
    const payload = Buffer.from(text);
    const mask = [1, 2, 3, 4];
    return Buffer.from([0x81, 0x80 | payload.length, ...mask, ...payload.map((byte, i) => byte ^ mask[i % 4])]);
  }
  // Replaces the header block of each response with its status line. The bodies and the frames stay.
  const statusLinesOnly = (received: string) =>
    received.replace(/(HTTP\/1\.1 \d{3} [^\r\n]+)\r\n(?:[^\r\n]+\r\n)*\r\n/g, "[$1]");
  const SWITCHED = "[HTTP/1.1 101 Switching Protocols]";

  function echoServer(events: string[], options: ConstructorParameters<typeof WebSocketServer>[0]) {
    const wss = new WebSocketServer(options);
    wss.on("connection", (ws, req) => {
      events.push(`connection ${req.url}`);
      ws.on("message", message => {
        events.push(`message ${message}`);
        ws.send(`echo:${message}`);
      });
    });
    return wss;
  }

  // The client writes `written` in one write. The server holds the response to /first until the
  // Upgrade has reached the 'upgrade' listeners: it ends inside that dispatch, in a later task with
  // `endFirstLater`, or never with `holdFirst`. The client sends one frame once it has the 101, and
  // leaves once it has the echo.
  async function exchange(scenario: {
    written: string;
    configure: (server: http.Server, events: string[]) => void;
    detachFirst?: boolean;
    endFirstLater?: boolean;
    holdFirst?: boolean;
    secure?: boolean;
  }) {
    const events: string[] = [];
    let first: http.ServerResponse | undefined;
    const { promise: firstClosed, resolve: onFirstClosed } = Promise.withResolvers<boolean>();
    const listener = (req: http.IncomingMessage, res: http.ServerResponse) => {
      events.push(`request ${req.url}`);
      if (req.url !== "/first") {
        // An Upgrade gets here only when it was not dispatched as 'upgrade'. The connection then
        // closes after the responses, so the result below is compared and nothing waits.
        if (req.headers.upgrade) {
          res.shouldKeepAlive = false;
          first!.end("first");
        }
        return void res.end(req.url);
      }
      first = res;
      res.on("finish", () => events.push("first finished"));
      res.on("close", () => onFirstClosed(res.writableFinished));
      if (scenario.detachFirst) res.detachSocket(res.socket!);
    };
    await using server = scenario.secure ? https.createServer(options, listener) : http.createServer(listener);
    scenario.configure(server, events);
    // Runs after the listeners of the WebSocketServers.
    const endFirst = () => first!.end("first");
    if (!scenario.holdFirst) server.on("upgrade", () => (scenario.endFirstLater ? setImmediate(endFirst) : endFirst()));
    await once(server.listen(0, "127.0.0.1"), "listening");

    const { port } = server.address() as AddressInfo;
    const client = scenario.secure
      ? tls.connect({ port, host: "127.0.0.1", ca: options.cert, servername: "localhost" })
      : net.connect(port, "127.0.0.1");
    try {
      let received = "";
      let sentFrame = false;
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
      client.on("error", () => {});
      client.on("close", () => onClosed());
      client.on("data", chunk => {
        received += chunk.toString("latin1");
        if (!sentFrame && statusLinesOnly(received).includes(SWITCHED)) {
          sentFrame = true;
          client.write(textFrame("hi"));
        }
        if (received.endsWith("echo:hi")) client.end();
      });
      client.write(scenario.written);
      await closed;
      if (!first) throw new Error("the connection closed before a request arrived");
      return { events, received: statusLinesOnly(received), firstFinished: await firstClosed };
    } finally {
      client.destroy();
    }
  }

  test.each([
    ["http", {}],
    ["https", { secure: true }],
    ["http, the response ends in a later task", { endFirstLater: true }],
    ["http, the response has detached its socket", { detachFirst: true }],
  ])("should follow that response and then work (%s)", async (_, variant) => {
    expect(
      await exchange({
        written: getRequest("/first") + handshake("/ws"),
        configure: (server, events) => void echoServer(events, { server }),
        ...variant,
      }),
    ).toEqual({
      events: ["request /first", "first finished", "connection /ws", "message hi"],
      received: `[HTTP/1.1 200 OK]first${SWITCHED}\x81\x07echo:hi`,
      firstFinished: true,
    });
  });

  test("should follow the responses that are queued ahead of it", async () => {
    expect(
      await exchange({
        written: getRequest("/first") + getRequest("/second") + handshake("/ws"),
        configure: (server, events) => void echoServer(events, { server }),
      }),
    ).toEqual({
      events: ["request /first", "request /second", "first finished", "connection /ws", "message hi"],
      received: `[HTTP/1.1 200 OK]first[HTTP/1.1 200 OK]/second${SWITCHED}\x81\x07echo:hi`,
      firstFinished: true,
    });
  });

  test("should answer an invalid handshake on the socket, not through the response ahead", async () => {
    // Like the npm package: the 400 goes out at once and the connection closes.
    expect(
      await exchange({
        written: getRequest("/first") + handshake("/ws", 7),
        configure: (server, events) => void echoServer(events, { server }),
        holdFirst: true,
      }),
    ).toEqual({
      events: ["request /first"],
      received: "[HTTP/1.1 400 Bad Request]Missing or invalid Sec-WebSocket-Version header",
      firstFinished: false,
    });
  });

  test("should stay with its WebSocketServer when another one does not handle the path", async () => {
    // The other server aborts a handshake that is not its own, unless the connection is taken.
    expect(
      await exchange({
        written: getRequest("/first") + handshake("/a"),
        configure: (server, events) => {
          echoServer(events, { server, path: "/a" });
          echoServer(events, { server, path: "/b" });
        },
      }),
    ).toEqual({
      events: ["request /first", "first finished", "connection /a", "message hi"],
      received: `[HTTP/1.1 200 OK]first${SWITCHED}\x81\x07echo:hi`,
      firstFinished: true,
    });
  });

  test("should throw for a second handleUpgrade() on the socket while it waits", async () => {
    expect(
      await exchange({
        written: getRequest("/first") + handshake("/ws"),
        configure: (server, events) => {
          const wss = echoServer(events, { noServer: true });
          server.on("upgrade", (req, socket, head) => {
            wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
            try {
              wss.handleUpgrade(req, socket, head, () => events.push("second callback"));
            } catch (err) {
              events.push(`second call: ${(err as Error).message}`);
            }
          });
        },
      }),
    ).toEqual({
      events: [
        "request /first",
        "second call: server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration",
        "first finished",
        "connection /ws",
        "message hi",
      ],
      received: `[HTTP/1.1 200 OK]first${SWITCHED}\x81\x07echo:hi`,
      firstFinished: true,
    });
  });

  test("should not cut short the parse of the connection whose request ends the response ahead", async () => {
    // The upgrade runs in a task of its own, not inside the dispatch of that request.
    let first: http.ServerResponse | undefined;
    const dispatched = Promise.withResolvers<void>();
    const { promise: upgradeDispatched, resolve: onUpgradeDispatched } = dispatched;
    const { promise: connected, resolve: onConnected } = Promise.withResolvers<void>();
    await using server = http.createServer((req, res) => {
      if (req.url === "/first") return void (first = res);
      if (req.url === "/ws") return void dispatched.reject(new Error("the Upgrade was dispatched as a request"));
      if (req.url === "/release") first!.end("first");
      res.end(req.url);
    });
    new WebSocketServer({ server }).on("connection", () => onConnected());
    server.on("upgrade", () => onUpgradeDispatched());
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const pipelining = net.connect(port, "127.0.0.1");
    const other = net.connect(port, "127.0.0.1");
    try {
      pipelining.on("error", () => {});
      pipelining.resume();
      pipelining.write(getRequest("/first") + handshake("/ws"));
      await upgradeDispatched;

      let received = "";
      const { promise: answered, resolve: onAnswered, reject: onFailure } = Promise.withResolvers<void>();
      other.on("data", chunk => {
        received += chunk;
        if (received.endsWith("/after")) onAnswered();
      });
      other.on("error", onFailure);
      other.on("close", () => onFailure(new Error(`closed after ${JSON.stringify(received)}`)));
      // One write: the server parses /after right after the dispatch that ends the response ahead.
      other.write(getRequest("/release") + getRequest("/after"));
      await Promise.all([answered, connected]);
      expect(statusLinesOnly(received)).toBe("[HTTP/1.1 200 OK]/release[HTTP/1.1 200 OK]/after");
    } finally {
      pipelining.destroy();
      other.destroy();
    }
  });

  test("should not let a throw from the 'connection' listener cut the events of the response ahead", async () => {
    const fixture = /* js */ `
      const http = require("node:http");
      const net = require("node:net");
      const { WebSocketServer } = require("ws");
      process.on("uncaughtException", err => console.log("uncaught:", err.message));
      let first;
      const server = http.createServer((req, res) => {
        if (req.url === "/ws") {
          console.log("the Upgrade was dispatched as a request");
          process.exit(1);
        }
        first = res;
        res.on("finish", () => console.log("first finish"));
        res.on("close", () => console.log("first close"));
      });
      new WebSocketServer({ server }).on("connection", () => {
        throw new Error("listener threw");
      });
      server.on("upgrade", () => first.end("first"));
      server.listen(0, "127.0.0.1", () => {
        const client = net.connect(server.address().port, "127.0.0.1");
        let received = "";
        client.on("data", chunk => {
          received += chunk;
          if (received.includes("101 Switching Protocols")) process.exit(0);
        });
        client.on("close", () => {
          console.log("closed after", JSON.stringify(received));
          process.exit(1);
        });
        client.write(${JSON.stringify(getRequest("/first") + handshake("/ws"))});
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "first finish\nfirst close\nuncaught: listener threw\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("server.upgrade() should refuse its response while the response ahead is pending", async () => {
    // What the ws module calls, without its wait. The response ahead must arrive intact.
    const fixture = /* js */ `
      const http = require("node:http");
      const net = require("node:net");
      const kInternals = Symbol.for("::bunternal::");
      let first;
      const server = http.createServer((req, res) => {
        if (req.url === "/ws") {
          console.log("the Upgrade was dispatched as a request");
          process.exit(1);
        }
        first = res;
        res.write("partial-");
      });
      server.on("upgrade", (req, socket) => {
        const handlers = { open() {}, message() {}, close() {}, drain() {}, ping() {}, pong() {} };
        console.log("upgraded:", server[kInternals].upgrade(socket[kInternals], { data: handlers }));
        first.write("more-");
        first.end("done");
      });
      server.listen(0, "127.0.0.1", () => {
        const client = net.connect(server.address().port, "127.0.0.1");
        let received = "";
        client.on("data", chunk => {
          received += chunk;
          if (!received.endsWith("0\\r\\n\\r\\n")) return;
          console.log(JSON.stringify(received.slice(received.indexOf("\\r\\n\\r\\n") + 4)));
          process.exit(0);
        });
        client.on("close", () => {
          console.log("closed after", JSON.stringify(received));
          process.exit(1);
        });
        client.write(${JSON.stringify(getRequest("/first") + handshake("/ws"))});
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `upgraded: false\n${JSON.stringify("8\r\npartial-\r\n5\r\nmore-\r\n4\r\ndone\r\n0\r\n\r\n")}\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});
