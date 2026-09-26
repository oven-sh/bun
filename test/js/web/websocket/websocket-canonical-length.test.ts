import { expect, test } from "bun:test";
import net from "node:net";

const malformedLengths = [
  {
    name: "16-bit alias",
    clientFrame: Buffer.from([0x81, 0xfe, 0, 1, 0x12, 0x34, 0x56, 0x78]),
  },
  {
    name: "64-bit alias",
    clientFrame: Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0, 0, 0, 1, 0x12, 0x34, 0x56, 0x78]),
  },
  {
    name: "64-bit high bit",
    clientFrame: Buffer.from([0x81, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0, 0x12, 0x34, 0x56, 0x78]),
  },
];

const rawUpgrade =
  "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
  "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";

const maskedClientFrame = (opcode: number, payload: Buffer | string, fin = true) => {
  const body = Buffer.from(payload);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const frame = Buffer.alloc(2 + mask.length + body.length);
  frame[0] = (fin ? 0x80 : 0) | opcode;
  frame[1] = 0x80 | body.length;
  mask.copy(frame, 2);
  for (let i = 0; i < body.length; i++) frame[6 + i] = body[i] ^ mask[i & 3];
  return frame;
};

for (const { name, clientFrame } of malformedLengths) {
  test(`Bun.serve rejects a non-canonical client ${name} length`, async () => {
    let messages = 0;
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        message() {
          messages++;
        },
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      let response = Buffer.alloc(0);
      let sent = false;
      socket.on("data", chunk => {
        response = Buffer.concat([response, chunk]);
        if (sent || !response.includes("\r\n\r\n")) return;
        sent = true;
        expect(response.toString("latin1")).toStartWith("HTTP/1.1 101");
        socket.write(clientFrame);
      });
      socket.once("close", resolve);
      socket.once("error", reject);
      socket.write(rawUpgrade);
    });
    expect(messages).toBe(0);
  });
}

test("Bun.serve rejects a new binary frame during fragmented text", async () => {
  let messages = 0;
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      message(ws) {
        messages++;
        ws.close();
      },
    },
  });

  const malformed = Buffer.concat([maskedClientFrame(1, "first", false), maskedClientFrame(2, "second")]);
  const socket = net.connect(server.port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    let response = Buffer.alloc(0);
    let sent = false;
    socket.on("data", chunk => {
      response = Buffer.concat([response, chunk]);
      if (sent || !response.includes("\r\n\r\n")) return;
      sent = true;
      expect(response.toString("latin1")).toStartWith("HTTP/1.1 101");
      socket.write(malformed);
    });
    socket.once("close", resolve);
    socket.once("error", reject);
    socket.write(rawUpgrade);
  });
  expect(messages).toBe(0);
});
