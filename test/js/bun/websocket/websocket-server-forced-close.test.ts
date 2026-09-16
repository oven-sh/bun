// A forced close of a Bun.serve WebSocket (terminate(), or a frame that fails
// the connection) closes the socket at once and reports 1006 with no reason.
// Over TLS it must not wait for the peer's close_notify: a peer that does not
// read never answers.
import type { WebSocketHandler } from "bun";
import { describe, expect, test } from "bun:test";
import { tls } from "harness";

for (const scheme of ["ws", "wss"] as const) {
  describe.concurrent(`${scheme}: forced close with a peer that does not read`, () => {
    const secure = scheme === "wss";

    function listen(websocket: WebSocketHandler<undefined>) {
      return Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        ...(secure ? { tls } : {}),
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("upgrade failed", { status: 400 });
        },
        websocket,
      });
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

      const client = new WebSocket(`${scheme}://127.0.0.1:${server.port}`, { tls: { rejectUnauthorized: false } });
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

      const client = new WebSocket(`${scheme}://127.0.0.1:${server.port}`, { tls: { rejectUnauthorized: false } });
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
        port: server.port,
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
            // The 101 is in. Stop reading, then break the protocol.
            socket.pause();
            socket.write(reservedOpcodeFrame);
          },
        },
      });
      try {
        expect(await closed.promise).toEqual({ code: 1006, reason: "" });
        expect(head).toStartWith("HTTP/1.1 101 ");
      } finally {
        socket.terminate();
      }
    });
  });
}
