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

// An Upgrade request can declare a body. The upgrade hands the socket to the WebSocket, so a body
// that has not arrived never does, and a keep-alive ref that waits for it never lets the process exit.
// Not concurrent: a debug build needs most of the default timeout to start this child, and more beside another.
test("WebSocket upgrade should unref body_read_ref from response", async () => {
  const script = /* js */ `
    const http = require("http");
    const net = require("net");
    const { once } = require("events");
    const { WebSocketServer } = require("ws");
    const { getEventLoopStats } = require("bun:internal-for-testing");

    async function upgradeRequestThatDeclaresABody(upgradeInLaterTask, sendBody) {
      const tasksBefore = getEventLoopStats().activeTasks;
      let requestEnded = false;
      // A request that is not taken for an upgrade gets an answer too, so the client never waits.
      const server = http.createServer((req, res) => res.writeHead(426).end());
      const wsServer = new WebSocketServer({ noServer: true });
      server.on("upgrade", (req, socket, head) => {
        const upgrade = () => {
          wsServer.handleUpgrade(req, socket, head, () => {});
          req.on("end", () => (requestEnded = true)).resume();
        };
        if (upgradeInLaterTask) setImmediate(upgrade);
        else upgrade();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");

      const body = '{"hello":"world"}';
      const client = net.connect(server.address().port, "127.0.0.1");
      client.write(
        [
          "GET / HTTP/1.1",
          "Host: localhost",
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Content-Length: " + body.length,
          "",
          sendBody ? body : "",
        ].join("\\r\\n"),
      );
      const { promise, resolve, reject } = Promise.withResolvers();
      let received = "";
      client.on("data", chunk => {
        received += chunk;
        if (!received.includes("\\r\\n\\r\\n")) return;
        // The response is in, so the upgrade and the callbacks it queued are over.
        const leakedTasks = getEventLoopStats().activeTasks - tasksBefore;
        resolve({ status: received.split("\\r\\n")[0], leakedTasks, requestEnded });
      });
      client.on("error", reject);
      client.on("close", () => reject(new Error("closed before the response: " + JSON.stringify(received))));
      const result = await promise;

      client.destroy();
      wsServer.close();
      await once(server.close(), "close");
      return result;
    }

    const results = {
      "in a later task, body not sent": await upgradeRequestThatDeclaresABody(true, false),
      // The body is complete before the upgrade: there is nothing left for the upgrade to release.
      "in a later task, body sent": await upgradeRequestThatDeclaresABody(true, true),
      "in the 'upgrade' event, body sent": await upgradeRequestThatDeclaresABody(false, true),
      "in the 'upgrade' event, body not sent": await upgradeRequestThatDeclaresABody(false, false),
    };
    console.log(JSON.stringify(results));
    // A leaked task keeps the event loop alive forever. Exit, so that the test fails fast.
    if (Object.values(results).some(result => result.leakedTasks !== 0)) process.exit(1);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const upgraded = { status: "HTTP/1.1 101 Switching Protocols", leakedTasks: 0, requestEnded: true };
  expect({
    results: stdout.startsWith("{") ? JSON.parse(stdout) : stdout,
    stderr,
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({
    results: {
      "in a later task, body not sent": upgraded,
      "in a later task, body sent": upgraded,
      "in the 'upgrade' event, body sent": upgraded,
      "in the 'upgrade' event, body not sent": upgraded,
    },
    stderr: "",
    // The script calls process.exit() only for a leak: the process has to exit by itself.
    exitCode: 0,
    signalCode: null,
  });
});

// The same handoff, seen from the stream of the request. The rest of the body can never arrive, so the
// stream ends at the upgrade. A reader that already waits for the body gets 'end', like a reader that starts
// later, and like every reader in Node.js up to 25. (Node.js 26 keeps reading the body from the socket.
// Here the WebSocket owns the socket.)
describe.concurrent("the request stream when ws upgrades before the declared body is complete", () => {
  const body = '{"hello":"world"}';

  type Reader =
    | "flowing"
    | "read() in the upgrade tick"
    | "paused, resumed in the upgrade tick"
    | "paused, starts after the upgrade";

  // `sent` is the part of the body that the client sends, in the same write as the head.
  async function upgradeBeforeTheBodyIsComplete(listenFor: "upgrade" | "request", sent: string, reader: Reader) {
    const events: string[] = [];
    let readerWaitedBeforeUpgrade = false;
    let duringUpgrade: string[] = [];
    // Stays undefined when the server answers without the listener. The result then shows the answer.
    let request: http.IncomingMessage | undefined;
    await using server = http.createServer();
    const wsServer = new WebSocketServer({ noServer: true });
    // With no 'upgrade' listener, the server gives the Upgrade request to the 'request' listener.
    server.on(listenFor, (req: http.IncomingMessage) => {
      request = req;
      let didRead = false;
      const read = req._read;
      req._read = function (size) {
        didRead = true;
        return read.call(this, size);
      };
      for (const name of ["end", "close", "aborted", "error"]) req.on(name, () => events.push(name));
      const listenForData = () => req.on("data", chunk => events.push("data:" + chunk));
      const upgrade = () => {
        readerWaitedBeforeUpgrade = didRead;
        const before = events.length;
        wsServer.handleUpgrade(req, req.socket, Buffer.alloc(0), ws => {
          events.push("connection");
          // A later task: the request has ended and closed by then, and the WebSocket still works.
          setImmediate(() => ws.send("hello"));
        });
        duringUpgrade = events.slice(before);
      };
      switch (reader) {
        case "flowing":
          // The 'data' listener starts the flow on the next tick.
          listenForData();
          return setImmediate(upgrade);
        case "read() in the upgrade tick":
          listenForData();
          req.read();
          return upgrade();
        case "paused, resumed in the upgrade tick":
          // After a read(), push() emits 'data' at once. While paused, the bytes wait in native code.
          req.read();
          req.pause();
          return setImmediate(() => {
            listenForData();
            req.resume();
            upgrade();
          });
        case "paused, starts after the upgrade":
          req.pause();
          return setImmediate(() => {
            upgrade();
            listenForData();
            req.resume();
          });
      }
    });
    await once(server.listen(0, "127.0.0.1"), "listening");

    const client = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    client.setEncoding("latin1");
    client.write(
      [
        "GET / HTTP/1.1",
        "Host: localhost",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Content-Length: " + body.length,
        "",
        sent,
      ].join("\r\n"),
    );
    // An unmasked text frame: FIN and opcode 1, length 5, "hello".
    const helloFrame = "810568656c6c6f";
    const response = Promise.withResolvers<string>();
    let received = "";
    client.on("data", chunk => {
      received += chunk;
      const headEnd = received.indexOf("\r\n\r\n");
      if (headEnd !== -1 && received.length >= headEnd + 4 + helloFrame.length / 2) response.resolve(received);
    });
    client.on("error", response.reject);
    client.on("close", () => response.reject(new Error("closed before the upgrade: " + JSON.stringify(received))));

    // The frame left in a task after the upgrade, so the callbacks that the upgrade queued are over.
    const text = await response.promise;
    const headEnd = text.indexOf("\r\n\r\n");
    const result = {
      status: text.slice(0, text.indexOf("\r\n")),
      afterHead: Buffer.from(text.slice(headEnd + 4), "latin1").toString("hex"),
      readerWaitedBeforeUpgrade,
      duringUpgrade,
      events: [...events],
      complete: request?.complete,
    };
    client.destroy();
    wsServer.close();
    return result;
  }

  const upgraded = { status: "HTTP/1.1 101 Switching Protocols", afterHead: "810568656c6c6f" };

  test.each([
    ["in the 'upgrade' event, from a later task", "upgrade", "flowing"],
    ["in the 'upgrade' event, in the same tick as req.read()", "upgrade", "read() in the upgrade tick"],
    ["in a 'request' listener, from a later task", "request", "flowing"],
  ] as const)("a reader that waits for the body gets 'end': handleUpgrade() %s", async (_when, listenFor, reader) => {
    expect(await upgradeBeforeTheBodyIsComplete(listenFor, "", reader)).toEqual({
      ...upgraded,
      readerWaitedBeforeUpgrade: true,
      duringUpgrade: ["connection"],
      events: ["connection", "end", "close"],
      complete: true,
    });
  });

  // The bytes arrived while the request was paused, so native code still holds them at the upgrade.
  test.each([
    ["the whole body, in a 'request' listener", "request", body],
    ["a part of the body, in the 'upgrade' event", "upgrade", body.slice(0, 5)],
  ] as const)("a reader that starts after the upgrade gets the buffered bytes: %s", async (_what, listenFor, sent) => {
    expect(await upgradeBeforeTheBodyIsComplete(listenFor, sent, "paused, starts after the upgrade")).toEqual({
      ...upgraded,
      readerWaitedBeforeUpgrade: false,
      duringUpgrade: ["connection"],
      events: ["connection", "data:" + sent, "end", "close"],
      complete: true,
    });
  });

  // This reader called read() before the pause, so nothing calls _read() again: resume() has to bring
  // the bytes. They come after handleUpgrade() returned. A 'data' listener that closed the socket inside
  // it left a closed WebSocket in wsServer.clients.
  test("a reader that paused and resumes in the upgrade tick gets the buffered bytes", async () => {
    const sent = body.slice(0, 5);
    expect(await upgradeBeforeTheBodyIsComplete("upgrade", sent, "paused, resumed in the upgrade tick")).toEqual({
      ...upgraded,
      readerWaitedBeforeUpgrade: true,
      duringUpgrade: ["connection"],
      events: ["connection", "data:" + sent, "end", "close"],
      complete: true,
    });
  });
});
