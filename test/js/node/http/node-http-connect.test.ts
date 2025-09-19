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
    await once(proxyServer.listen(0), "listening");
    await once(targetServer.listen(0), "listening");
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
    const data = Buffer.alloc(1024 * 1024 * 64, "bun").toString();
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });
    await using targetServer = net.createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
      socket.end(data);
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
      expect(response).toContain(data);
    }
  });
});
