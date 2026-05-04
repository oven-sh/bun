import { expect, test } from "bun:test";
import { createServer } from "node:http";

function sendUpgradeRequest(
  socket: ReturnType<typeof Bun.connect extends (...args: any) => Promise<infer T> ? T : never>,
  port: number,
) {
  socket.write(
    "GET / HTTP/1.1\r\n" +
      `Host: localhost:${port}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
  );
}

test("socket.write() works in upgrade event handler", async () => {
  const { promise: serverReady, resolve: onListening } = Promise.withResolvers<void>();
  const { promise: clientDone, resolve: onClientDone, reject: onClientError } = Promise.withResolvers<void>();

  const server = createServer();
  try {
    server.on("upgrade", (req, socket, head) => {
      const response =
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: dummy\r\n" +
        "\r\n";

      const result = socket.write(response, () => {
        // after the write callback, bytesWritten should be > 0
        expect(socket.bytesWritten).toBeGreaterThan(0);
        socket.end();
      });
      expect(result).toBe(true);
    });

    server.listen(0, () => {
      onListening();
    });

    await serverReady;
    const port = (server.address() as any).port;

    await using conn = await Bun.connect({
      hostname: "localhost",
      port,
      socket: {
        data(socket, data) {
          const text = Buffer.from(data).toString();
          if (text.includes("101 Switching Protocols")) {
            onClientDone();
          }
        },
        error(socket, err) {
          onClientError(err);
        },
        open(socket) {
          sendUpgradeRequest(socket, port);
        },
      },
    });

    await clientDone;
  } finally {
    server.close();
  }
});

test("socket.write() sends data that the client receives in upgrade handler", async () => {
  const { promise: serverReady, resolve: onListening } = Promise.withResolvers<void>();
  const { promise: clientDone, resolve: onClientDone, reject: onClientError } = Promise.withResolvers<void>();

  const testPayload = "HELLO FROM UPGRADE";

  const server = createServer();
  try {
    server.on("upgrade", (req, socket, head) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n" +
          testPayload,
      );
    });

    server.listen(0, () => {
      onListening();
    });

    await serverReady;
    const port = (server.address() as any).port;

    let received = "";
    await using conn = await Bun.connect({
      hostname: "localhost",
      port,
      socket: {
        data(socket, data) {
          received += Buffer.from(data).toString();
          if (received.includes(testPayload)) {
            onClientDone();
          }
        },
        error(socket, err) {
          onClientError(err);
        },
        open(socket) {
          sendUpgradeRequest(socket, port);
        },
      },
    });

    await clientDone;
    expect(received).toContain("101 Switching Protocols");
    expect(received).toContain(testPayload);
  } finally {
    server.close();
  }
});

test("socket.pipe() works with upgrade sockets", async () => {
  const { promise: serverReady, resolve: onListening } = Promise.withResolvers<void>();
  const { promise: clientDone, resolve: onClientDone, reject: onClientError } = Promise.withResolvers<void>();

  const server = createServer();
  try {
    server.on("upgrade", (req, socket, head) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
      );

      // echo data back w/ pipe
      socket.pipe(socket);
    });

    server.listen(0, () => {
      onListening();
    });

    await serverReady;
    const port = (server.address() as any).port;

    const echoPayload = "ECHO_TEST_DATA";
    let receivedUpgrade = false;
    let received = "";

    await using conn = await Bun.connect({
      hostname: "localhost",
      port,
      socket: {
        data(socket, data) {
          const text = Buffer.from(data).toString();
          received += text;
          if (!receivedUpgrade && received.includes("\r\n\r\n")) {
            receivedUpgrade = true;
            // after upgrade completes, send data
            socket.write(echoPayload);
          } else if (receivedUpgrade && received.includes(echoPayload)) {
            onClientDone();
          }
        },
        error(socket, err) {
          onClientError(err);
        },
        open(socket) {
          sendUpgradeRequest(socket, port);
        },
      },
    });

    await clientDone;
  } finally {
    server.close();
  }
});
