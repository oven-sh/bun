/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */

import { describe, expect, test } from "bun:test";

import http from "http";
import { createProxy } from "proxy";

import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { C } from "node_modules/@electric-sql/pglite/dist/pglite-Csk75SCB";

function connectClient(proxyAddress: AddressInfo, targetAddress: AddressInfo, add_http_prefix: boolean) {
  const client = net.connect({ port: proxyAddress.port, host: proxyAddress.address }, () => {
    client.write(
      `CONNECT ${add_http_prefix ? "http://" : ""}${targetAddress.address}:${targetAddress.port} HTTP/1.1\r\nHost: ${targetAddress.address}:${targetAddress.port}\r\nProxy-Authorization: Basic dXNlcjpwYXNzd29yZA==\r\n\r\n`,
    );
  });

  const received: string[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<string>();

  client.on("data", data => {
    if (data.toString().includes("200 Connection established")) {
      client.write("GET / HTTP/1.1\r\nHost: www.example.com:80\r\nConnection: close\r\n\r\n");
    }
    received.push(data.toString());
  });
  client.on("error", reject);

  client.on("end", () => {
    resolve(received.join(""));
  });
  return promise;
}

const BIG_DATA = Buffer.alloc(1024 * 1024 * 64, "bun").toString();

describe("HTTP server CONNECT", () => {
  test("should work with proxy package", async () => {
    await using targetServer = http.createServer((req, res) => {
      res.end("Hello World from target server");
    });
    await using proxyServer = createProxy(http.createServer());
    let proxyHeaders = {};
    proxyServer.authenticate = req => {
      proxyHeaders = req.headers;
      return true;
    };
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    await once(targetServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;
    const targetAddress = targetServer.address() as AddressInfo;

    {
      // server should support http prefix but the proxy package it self does not
      // this behavior is consistent with node.js
      const response = await connectClient(proxyAddress, targetAddress, true);
      expect(proxyHeaders["proxy-authorization"]).toBe("Basic dXNlcjpwYXNzd29yZA==");
      expect(response).toContain("HTTP/1.1 404 Not Found");
    }

    {
      proxyHeaders = {};
      const response = await connectClient(proxyAddress, targetAddress, false);
      expect(proxyHeaders["proxy-authorization"]).toBe("Basic dXNlcjpwYXNzd29yZA==");
      expect(response).toContain("HTTP/1.1 200 OK");
      expect(response).toContain("Hello World from target server");
    }
  });

  test("should work with raw sockets", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });
    await using targetServer = http.createServer((req, res) => {
      res.end("Hello World from target server");
    });
    let proxyHeaders = {};
    proxyServer.on("connect", (req, socket, head) => {
      proxyHeaders = req.headers;
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, () => {
        socket.write(`HTTP/1.1 200 Connection established\r\nConnection: close\r\n\r\n`);
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });
      serverSocket.on("error", err => {
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      });
      socket.on("error", err => {
        serverSocket.destroy();
      });

      socket.on("end", () => serverSocket.end());
      serverSocket.on("end", () => socket.end());
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;
    await once(targetServer.listen(0, "127.0.0.1"), "listening");
    const targetAddress = targetServer.address() as AddressInfo;

    {
      const response = await connectClient(proxyAddress, targetAddress, false);
      expect(proxyHeaders["proxy-authorization"]).toBe("Basic dXNlcjpwYXNzd29yZA==");
      expect(response).toContain("HTTP/1.1 200 OK");
      expect(response).toContain("Hello World from target server");
    }
  });

  test("should handle backpressure", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });
    await using targetServer = net.createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
      socket.end(BIG_DATA);
    });
    let proxyHeaders = {};
    proxyServer.on("connect", (req, socket, head) => {
      proxyHeaders = req.headers;
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, () => {
        socket.write(`HTTP/1.1 200 Connection established\r\nConnection: close\r\n\r\n`);
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });
      serverSocket.on("error", err => {
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      });
      socket.on("error", err => {
        serverSocket.destroy();
      });

      socket.on("end", () => serverSocket.end());
      serverSocket.on("end", () => socket.end());
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    await once(targetServer.listen(0, "127.0.0.1"), "listening");
    const targetAddress = targetServer.address() as AddressInfo;

    {
      const response = await connectClient(proxyAddress, targetAddress, false);
      expect(proxyHeaders["proxy-authorization"]).toBe("Basic dXNlcjpwYXNzd29yZA==");
      expect(response).toContain("HTTP/1.1 200 OK");
      expect(response).toContain(BIG_DATA);
    }
  });

  test("should handle data, drain, end and close events", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;
    let data_received: string[] = [];
    let client_data_received: string[] = [];
    let proxy_drain_received = false;
    let proxy_end_received = false;

    const { promise, resolve, reject } = Promise.withResolvers<string>();

    const { promise: clientPromise, resolve: clientResolve, reject: clientReject } = Promise.withResolvers<string>();
    const clientSocket = net.connect(proxyAddress.port, proxyAddress.address, () => {
      clientSocket.on("error", clientReject);
      clientSocket.on("data", chunk => {
        client_data_received.push(chunk?.toString());
      });
      clientSocket.on("end", () => {
        clientSocket.end();
        clientResolve(client_data_received.join(""));
      });

      clientSocket.write("CONNECT localhost:80 HTTP/1.1\r\nHost: localhost:80\r\nConnection: close\r\n\r\n");
    });

    proxyServer.on("connect", (req, socket, head) => {
      expect(head).toBeInstanceOf(Buffer);
      socket.on("data", chunk => {
        data_received.push(chunk?.toString());
      });
      socket.on("end", () => {
        proxy_end_received = true;
      });
      socket.on("close", () => {
        resolve(data_received.join(""));
      });
      socket.on("drain", () => {
        proxy_drain_received = true;
        socket.end();
      });
      socket.on("error", reject);
      proxy_drain_received = false;
      // should not able to flush the data to the client immediately
      expect(socket.write(BIG_DATA)).toBe(false);
      clientSocket.write("Hello World");
    });

    expect(await promise).toContain("Hello World");
    expect(await clientPromise).toContain(BIG_DATA);
    expect(proxy_drain_received).toBe(true);
    expect(proxy_end_received).toBe(true);
  });

  test("close event should fire when the client ends", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    await using server = http.createServer(async (req, res) => {
      res.socket?.on("close", resolve);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.on("error", reject);
      client.write("GET / HTTP/1.1\r\nHost: localhost:80\r\nConnection: close\r\nContent-Length: 10\r\n\r\n");
      client.end();
    });
    await promise;
  });
});
