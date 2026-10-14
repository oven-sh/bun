// A forced close of a Bun.serve WebSocket (terminate(), or a frame that fails
// the connection) runs the close handler at once and reports 1006.
// Over TLS it must not wait for the peer's close_notify: a peer that does not
// read never answers.
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls } from "harness";
import net from "node:net";
import nodeTls from "node:tls";

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

function maskedText(text: string): Buffer {
  const mask = [0x12, 0x34, 0x56, 0x78];
  return Buffer.from([0x81, 0x80 | text.length, ...mask, ...Array.from(Buffer.from(text), (b, i) => b ^ mask[i & 3])]);
}

// Upgrades over a raw socket. `ended` resolves when the connection is gone, with the status line
// ("" if there was none) and every frame the server sent.
function rawClient(port: number, secure: boolean) {
  const socket = secure
    ? nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect({ port, host: "127.0.0.1" });
  const ended = Promise.withResolvers<{ status: string; frames: string[] }>();
  let received = Buffer.alloc(0);
  socket.on("data", chunk => {
    received = Buffer.concat([received, chunk]);
  });
  // "close" follows.
  socket.on("error", () => {});
  socket.on("close", () => {
    const headEnd = received.indexOf("\r\n\r\n");
    const status = received.subarray(0, Math.max(received.indexOf("\r\n"), 0)).toString();
    const frames: string[] = [];
    let rest = headEnd === -1 ? Buffer.alloc(0) : received.subarray(headEnd + 4);
    while (rest.length >= 2 && rest.length >= 2 + rest[1]) {
      const payload = rest.subarray(2, 2 + rest[1]);
      frames.push(
        (rest[0] & 0xf) === 0x8
          ? `CLOSE ${payload.readUInt16BE(0)} ${JSON.stringify(payload.subarray(2).toString())}`
          : payload.toString(),
      );
      rest = rest.subarray(2 + rest[1]);
    }
    ended.resolve({ status, frames });
  });
  socket.write(
    "GET / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n\r\n",
  );
  return { socket, ended: ended.promise };
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
// handler lands in the cork buffer until the handler returns.
describe.concurrent.each(["ws", "wss"] as const)("%s: what send() and publish() accepted is delivered", scheme => {
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

    const a = rawClient(server.port!, secure);
    const b = rawClient(server.port!, secure);
    try {
      await bothOpen.promise;
      a.socket.write(maskedText("go"));
      const [fromA, fromB] = await Promise.all([a.ended, b.ended]);
      expect({ results, a: fromA.frames, b: fromB.frames }).toEqual({
        results: [4, 4, 4, 4],
        a: ["sent", "bye0", "bye1", "bye2"],
        b: ["bye0", "bye1", "bye2"],
      });
    } finally {
      a.socket.destroy();
      b.socket.destroy();
    }
  });

  // server.upgrade() has returned true by then, whether the 101 is still corked or not.
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

    const client = rawClient(server.port!, secure);
    try {
      expect(await client.ended).toEqual({
        status: "HTTP/1.1 101 Switching Protocols",
        frames: ["before the throw"],
      });
    } finally {
      client.socket.destroy();
    }
  });
});

// The loop does not tick again after the last turn, so nothing else writes these out.
// On Windows the exit resets the connection, and the reset can discard what the client has not read yet.
describe.concurrent.each([
  { from: "a timer", exit: "server.unref()" },
  { from: "a timer", exit: "process.exit(0)" },
  { from: "the message handler", exit: "process.exit(0)" },
])("send() and publish(), then $exit from $from", ({ from, exit }) => {
  test.skipIf(isWindows)("are delivered before the process exits", async () => {
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
                function act() {
                  console.log(JSON.stringify([ws.send("sent"), ...[0, 1, 2].map(i => server.publish("room", "bye" + i))]));
                  ${exit};
                }
                ${from === "a timer" ? "setTimeout(act, 0)" : "act()"};
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

    const client = rawClient(parseInt(await readLine()), false);
    try {
      client.socket.once("data", () => client.socket.write(maskedText("go")));
      const [results, { frames }, stderr, exitCode] = await Promise.all([
        readLine(),
        client.ended,
        proc.stderr.text(),
        proc.exited,
      ]);
      expect({ results, frames, stderr }).toEqual({
        results: "[4,4,4,4]",
        frames: ["sent", "bye0", "bye1", "bye2"],
        stderr: "",
      });
      expect(exitCode).toBe(0);
    } finally {
      client.socket.destroy();
    }
  });
});

// uws runs timeouts on a 4 second tick. With idleTimeout: 8 (the smallest) it pings after one idle
// tick and closes one tick later. What the server itself sends in between says nothing about the peer.
test.concurrent(
  "a ping the client does not answer closes the connection while the server keeps sending",
  async () => {
    const closed = Promise.withResolvers<{ code: number; reason: string }>();
    let pusher: ReturnType<typeof setInterval> | undefined;
    await using server = serve(false, {
      idleTimeout: 8,
      open(ws) {
        pusher = setInterval(() => ws.send("tick"), 100);
      },
      message() {},
      close(ws, code, reason) {
        clearInterval(pusher);
        closed.resolve({ code, reason });
      },
    });

    // Fails at the next tick instead of never, if the server pings again.
    const secondPing = Promise.withResolvers<never>();
    let pings = 0;
    const client = rawClient(server.port!, false);
    client.socket.on("data", chunk => {
      // Every frame of this server is "tick" or an empty ping, and 0x89 is in neither payload.
      for (const byte of chunk) {
        if (byte === 0x89 && ++pings === 2) secondPing.reject(new Error("the server pinged again instead of closing"));
      }
    });
    try {
      expect(await Promise.race([closed.promise, secondPing.promise])).toEqual({
        code: 1006,
        reason: "WebSocket timed out from inactivity",
      });
      expect(pings).toBe(1);
    } finally {
      clearInterval(pusher);
      client.socket.destroy();
    }
  },
  30_000,
);
