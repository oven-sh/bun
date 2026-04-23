import { expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

test("socket.write sends data in http upgrade event handler", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = http.createServer();
  server.on("upgrade", (_req, socket) => {
    socket.write("x", () => {
      // After the write completes, close the socket
      socket.end();
    });
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as net.AddressInfo;

    const client = net.createConnection(addr.port, "127.0.0.1", () => {
      client.write(
        "GET / HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });

    let received = "";
    client.on("data", (data: Buffer) => {
      received += data.toString();
    });

    client.on("end", () => {
      try {
        expect(received).toBe("x");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });

    client.on("error", (err: Error) => {
      server.close();
      reject(err);
    });
  });

  await promise;
});

test("socket.write with 101 handshake in http upgrade event handler", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = http.createServer();
  server.on("upgrade", (_req, socket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello from upgrade",
      () => {
        socket.end();
      },
    );
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as net.AddressInfo;

    const client = net.createConnection(addr.port, "127.0.0.1", () => {
      client.write(
        "GET / HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });

    let received = "";
    client.on("data", (data: Buffer) => {
      received += data.toString();
    });

    client.on("end", () => {
      try {
        expect(received).toContain("HTTP/1.1 101 Switching Protocols");
        expect(received).toContain("hello from upgrade");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });

    client.on("error", (err: Error) => {
      server.close();
      reject(err);
    });
  });

  await promise;
});

test("multiple socket.write calls in http upgrade event handler", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = http.createServer();
  server.on("upgrade", (_req, socket) => {
    socket.write("first");
    socket.write("second");
    socket.write("third", () => {
      socket.end();
    });
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as net.AddressInfo;

    const client = net.createConnection(addr.port, "127.0.0.1", () => {
      client.write(
        "GET / HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });

    let received = "";
    client.on("data", (data: Buffer) => {
      received += data.toString();
    });

    client.on("end", () => {
      try {
        expect(received).toContain("first");
        expect(received).toContain("second");
        expect(received).toContain("third");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });

    client.on("error", (err: Error) => {
      server.close();
      reject(err);
    });
  });

  await promise;
});
