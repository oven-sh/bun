// A forced close of a Bun.serve WebSocket (terminate(), or a frame that fails
// the connection) runs the close handler immediately and reports 1006.
// Over TLS it must not wait for the peer's close_notify: a peer that does not
// read never answers.
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls } from "harness";
import { RawClient } from "../../web/websocket/raw-peer";

function serve(secure: boolean, websocket: WebSocketHandler<undefined>, asyncUpgrade = false) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    ...(secure ? { tls } : {}),
    async fetch(req, server) {
      if (asyncUpgrade) await new Promise(resolve => setImmediate(resolve));
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket,
  });
}

describe.concurrent.each(["ws", "wss"] as const)("%s: forced close with a peer that does not read", scheme => {
  const secure = scheme === "wss";

  function listen(websocket: WebSocketHandler<undefined>) {
    return serve(secure, websocket);
  }

  // The server settles `pending` first when a test passes. A client that fails or closes before that rejects it.
  function connect(port: number, pending: PromiseWithResolvers<void>) {
    const client = new WebSocket(`${scheme}://127.0.0.1:${port}`, { tls: { rejectUnauthorized: false } });
    client.onerror = event => pending.reject(new Error(`client error: ${(event as ErrorEvent).message}`));
    client.onclose = event => pending.reject(new Error(`client closed early: ${event.code}`));
    return client;
  }

  test("terminate() runs the close handler before it returns", async () => {
    const events: string[] = [];
    const terminated = Promise.withResolvers<void>();
    await using server = listen({
      open(ws) {
        ws.send("ready");
      },
      message(ws, message) {
        events.push(`message: ${message}`);
        ws.terminate();
        events.push("terminate() returned");
        terminated.resolve();
      },
      close(ws, code, reason) {
        events.push(`close: ${code} ${JSON.stringify(reason)}`);
      },
    });

    const client = connect(server.port!, terminated);
    try {
      client.onmessage = () => {
        client.pause();
        client.send("terminate");
      };
      await terminated.promise;
      expect(events).toEqual(["message: terminate", 'close: 1006 ""', "terminate() returned"]);
    } finally {
      client.terminate();
    }
  });

  test("terminate() runs the close handler before it returns under backpressure", async () => {
    const chunk = Buffer.alloc(64 * 1024, "x");
    const events: string[] = [];
    const terminated = Promise.withResolvers<void>();
    await using server = listen({
      message(ws) {
        // The client is paused, so the kernel buffers fill and send() reports backpressure (-1).
        setSocketOptions(ws, 1, chunk.length);
        let status = 1;
        for (let i = 0; i < 1024 && status > 0; i++) status = ws.send(chunk);
        events.push(`last send(): ${status}`);
        ws.terminate();
        events.push("terminate() returned");
        terminated.resolve();
      },
      close(ws, code, reason) {
        events.push(`close: ${code} ${JSON.stringify(reason)}`);
      },
    });

    const client = connect(server.port!, terminated);
    try {
      client.onopen = () => {
        client.pause();
        client.send("flood");
      };
      await terminated.promise;
      expect(events).toEqual(["last send(): -1", 'close: 1006 ""', "terminate() returned"]);
    } finally {
      client.terminate();
    }
  });

  test("a frame with a reserved opcode closes the socket", async () => {
    const closed = Promise.withResolvers<{ code: number; reason: string }>();
    await using server = listen({
      message() {},
      close(ws, code, reason) {
        closed.resolve({ code, reason });
      },
    });

    // Masked frame, FIN set, opcode 3 (reserved, RFC 6455 section 5.2), empty payload.
    const reservedOpcodeFrame = Buffer.from([0x83, 0x80, 0x12, 0x34, 0x56, 0x78]);
    function upgrade(socket: Bun.Socket) {
      socket.write(
        "GET / HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${server.port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    }
    let head = "";
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port!,
      ...(secure ? { tls: { rejectUnauthorized: false } } : {}),
      socket: {
        open(socket) {
          if (!secure) upgrade(socket);
        },
        handshake(socket) {
          upgrade(socket);
        },
        data(socket, data) {
          if (head.includes("\r\n\r\n")) return;
          head += data.toString("latin1");
          if (!head.includes("\r\n\r\n")) return;
          if (!head.startsWith("HTTP/1.1 101 ")) return closed.reject(new Error(`upgrade failed: ${head}`));
          // The 101 is in. Stop reading, then break the protocol.
          socket.pause();
          socket.write(reservedOpcodeFrame);
        },
        error(socket, error) {
          closed.reject(error);
        },
        close() {
          closed.reject(new Error("the client socket closed before the server reported close"));
        },
      },
    });
    try {
      expect(await closed.promise).toEqual({ code: 1006, reason: "Received invalid opcode" });
    } finally {
      socket.terminate();
    }
  });
});

// publish() queues small messages per subscriber until the end of the tick, and send() inside a
// handler stays in the cork buffer until the handler returns.
describe.concurrent.each(["ws", "wss"] as const)("%s: flushes accepted send() and publish() messages", scheme => {
  const secure = scheme === "wss";

  test("before terminate() closes the socket", async () => {
    const sockets: ServerWebSocket<undefined>[] = [];
    const bothOpen = Promise.withResolvers<void>();
    let results: number[] = [];
    await using server = serve(secure, {
      open(ws) {
        ws.subscribe("room");
        if (sockets.push(ws) === 2) bothOpen.resolve();
      },
      message(ws) {
        results = [ws.send("sent"), ...[0, 1, 2].map(i => server.publish("room", "bye" + i))];
        for (const socket of sockets) socket.terminate();
      },
    });

    using a = new RawClient(server.port!, { secure });
    using b = new RawClient(server.port!, { secure });
    await bothOpen.promise;
    a.text("go");
    const [fromA, fromB] = await Promise.all([a.remainingFrames(), b.remainingFrames()]);
    expect({ results, a: fromA, b: fromB }).toEqual({
      results: [4, 4, 4, 4],
      a: ['text "sent"', 'text "bye0"', 'text "bye1"', 'text "bye2"'],
      b: ['text "bye0"', 'text "bye1"', 'text "bye2"'],
    });
  });

  // server.upgrade() already returned true, so the 101 has to be sent whether or not it's still corked.
  test.each(["synchronous", "asynchronous"])("when open() throws after a %s upgrade", async kind => {
    await using server = serve(
      secure,
      {
        open(ws) {
          ws.send("before the throw");
          throw new Error("open threw");
        },
        message() {},
        error() {},
      },
      kind === "asynchronous",
    );

    using client = new RawClient(server.port!, { secure });
    expect({ status: (await client.response).status, frames: await client.remainingFrames() }).toEqual({
      status: "HTTP/1.1 101 Switching Protocols",
      frames: ['text "before the throw"'],
    });
  });
});

// The event loop doesn't run again after this tick, so exiting has to flush these messages.
// Skipped on Windows: exiting resets the connection, and the reset can discard data the client hasn't read yet.
describe.concurrent.each([
  { from: "a timer", exit: "server.unref()" },
  { from: "a timer", exit: "process.exit(0)" },
  { from: "the message handler", exit: "process.exit(0)" },
])("$exit from $from after send() and publish()", ({ from, exit }) => {
  test.skipIf(isWindows)("flushes the messages before the process exits", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(req, server) {
              return server.upgrade(req) ? undefined : new Response("no", { status: 400 });
            },
            websocket: {
              open(ws) {
                ws.subscribe("room");
              },
              message(ws) {
                function sendThenExit() {
                  console.log(JSON.stringify([ws.send("sent"), ...[0, 1, 2].map(i => server.publish("room", "bye" + i))]));
                  ${exit};
                }
                ${from === "a timer" ? "setTimeout(sendThenExit, 0)" : "sendThenExit()"};
              },
            },
          });
          console.log(server.port);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    async function readLine() {
      while (!stdout.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });
      }
      const line = stdout.slice(0, stdout.indexOf("\n"));
      stdout = stdout.slice(line.length + 1);
      return line;
    }

    using client = await RawClient.upgrade(parseInt(await readLine()));
    client.text("go");
    const [results, frames, stderr, exitCode] = await Promise.all([
      readLine(),
      client.remainingFrames(),
      proc.stderr.text(),
      proc.exited,
    ]);
    // ASAN builds tear down the VM at exit to find leaks. That stops the server, which sends a 1001 Close frame.
    if (frames.at(-1) === 'close 1001 "Server closed"') frames.pop();
    expect({ results, frames, stderr }).toEqual({
      results: "[4,4,4,4]",
      frames: ['text "sent"', 'text "bye0"', 'text "bye1"', 'text "bye2"'],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});

// uws corks the 101 in a 128 KB buffer. Headers that overflow it make server.upgrade() flush partway through the
// 101. Over TLS a failed write closes the socket, so it can't be upgraded to a WebSocket.
// The header sizes step across the buffer boundary in increments smaller than what uws itself adds to the 101.
test.concurrent("server.upgrade() returns false when a TLS client resets during a large 101", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const tls = require("node:tls");

        let client;
        let lastHeaderSize = 10700;
        const results = new Set();
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          tls: { cert: process.env.TLS_CERT, key: process.env.TLS_KEY },
          fetch(req, server) {
            client.resetAndDestroy();
            const headers = {};
            for (let i = 0; i < 8; i++) headers["x-long-" + i] = Buffer.alloc(15000, "a").toString();
            headers["x-long-8"] = Buffer.alloc(lastHeaderSize, "a").toString();
            results.add(server.upgrade(req, { headers }));
          },
          websocket: { message() {} },
        });

        function next() {
          if ((lastHeaderSize += 50) > 11000) {
            console.log(JSON.stringify([...results].sort()));
            return server.stop(true);
          }
          client = tls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false });
          client.on("error", () => {});
          client.on("close", next);
          client.write(
            "GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n" +
              "Sec-WebSocket-Version: 13\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\n\\r\\n",
          );
        }
        next();
      `,
    ],
    env: { ...bunEnv, TLS_CERT: tls.cert, TLS_KEY: tls.key },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // true while the whole 101 fits in the buffer, false once it overflows and the write fails before the upgrade.
  expect({ stdout, stderr }).toEqual({ stdout: "[false,true]\n", stderr: "" });
  expect(exitCode).toBe(0);
});
