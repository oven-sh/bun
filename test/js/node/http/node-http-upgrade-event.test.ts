import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

describe("HTTP ClientRequest upgrade event", () => {
  test("should emit 'upgrade' event instead of 'response' for HTTP 101 Switching Protocols", async () => {
    // Create a raw TCP server that responds with 101 Switching Protocols
    await using server = net.createServer(socket => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: tcp\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        socket.write("upgraded data");
      });
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port, address } = server.address() as AddressInfo;

    const { promise, resolve, reject } = Promise.withResolvers<{
      event: "upgrade" | "response";
      statusCode: number;
    }>();

    const req = http.request({
      hostname: address,
      port,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Connection: "Upgrade",
        Upgrade: "tcp",
      },
    });

    req.on("upgrade", (res, socket) => {
      resolve({ event: "upgrade", statusCode: res.statusCode! });
      socket.destroy();
    });

    req.on("response", res => {
      resolve({ event: "response", statusCode: res.statusCode! });
      res.destroy();
    });

    req.on("error", reject);
    req.end();

    const result = await promise;

    // Node.js behavior: should emit 'upgrade' event for 101 status
    expect(result.event).toBe("upgrade");
    expect(result.statusCode).toBe(101);
  });

  test("should emit 'upgrade' event with socket and head arguments", async () => {
    await using server = net.createServer(socket => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
      });
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port, address } = server.address() as AddressInfo;

    const { promise, resolve, reject } = Promise.withResolvers<{
      hasSocket: boolean;
      hasHead: boolean;
      headIsBuffer: boolean;
    }>();

    const req = http.request({
      hostname: address,
      port,
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    });

    req.on("upgrade", (_res, socket, head) => {
      resolve({
        hasSocket: socket != null,
        hasHead: head != null,
        headIsBuffer: Buffer.isBuffer(head),
      });
      socket.destroy();
    });

    req.on("response", () => {
      reject(new Error("Should not emit 'response' event for 101 status"));
    });

    req.on("error", reject);
    req.end();

    const result = await promise;

    expect(result.hasSocket).toBe(true);
    expect(result.hasHead).toBe(true);
    expect(result.headIsBuffer).toBe(true);
  });

  test("should emit 'response' event for non-101 status even with Upgrade header", async () => {
    await using server = net.createServer(socket => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello");
        socket.end();
      });
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port, address } = server.address() as AddressInfo;

    const { promise, resolve, reject } = Promise.withResolvers<{
      event: "upgrade" | "response";
      statusCode: number;
    }>();

    const req = http.request({
      hostname: address,
      port,
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "tcp",
      },
    });

    req.on("upgrade", (res, socket) => {
      resolve({ event: "upgrade", statusCode: res.statusCode! });
      socket.destroy();
    });

    req.on("response", res => {
      resolve({ event: "response", statusCode: res.statusCode! });
      res.resume();
    });

    req.on("error", reject);
    req.end();

    const result = await promise;

    expect(result.event).toBe("response");
    expect(result.statusCode).toBe(200);
  });
});
