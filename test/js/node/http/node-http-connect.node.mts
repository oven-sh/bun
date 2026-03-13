/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */

import { describe, test } from "node:test";
import assert from "node:assert";

function expect(value: any) {
  return {
    toBe: (expected: any) => {
      assert.strictEqual(value, expected);
    },
    toContain: (expected: any) => {
      assert.ok(value.includes(expected));
    },
    toBeInstanceOf: (expected: any) => {
      assert.ok(value instanceof expected);
    },
    toBeGreaterThan: (expected: any) => {
      assert.ok(value > expected);
    },
    toBeLessThan: (expected: any) => {
      assert.ok(value < expected);
    },
    toEqual: (expected: any) => {
      assert.deepStrictEqual(value, expected);
    },
    not: {
      toBe: (expected: any) => {
        assert.notStrictEqual(value, expected);
      },
      toContain: (expected: any) => {
        assert.ok(!value.includes(expected));
      },
      toBeInstanceOf: (expected: any) => {
        assert.ok(!(value instanceof expected));
      },
      toBeGreaterThan: (expected: any) => {
        assert.ok(!(value > expected));
      },
      toBeLessThan: (expected: any) => {
        assert.ok(!(value < expected));
      },
      toEqual: (expected: any) => {
        assert.notDeepStrictEqual(value, expected);
      },
    },
  };
}
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

const BIG_DATA = Buffer.alloc(1024 * 64, "bun").toString();

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

  test("should handle multiple concurrent CONNECT requests", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    await using targetServer = http.createServer((req, res) => {
      res.end(`Response for ${req.url}`);
    });

    let connectionCount = 0;
    proxyServer.on("connect", (req, socket, head) => {
      connectionCount++;
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, () => {
        socket.write(`HTTP/1.1 200 Connection established\r\n\r\n`);
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });

      serverSocket.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
      socket.on("error", () => serverSocket.destroy());
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    await once(targetServer.listen(0, "127.0.0.1"), "listening");

    const proxyAddress = proxyServer.address() as AddressInfo;
    const targetAddress = targetServer.address() as AddressInfo;

    // Create 5 concurrent connections
    const promises = Array.from({ length: 5 }, (_, i) => connectClient(proxyAddress, targetAddress, false));

    const results = await Promise.all(promises);
    expect(connectionCount).toBe(5);
    results.forEach(result => {
      expect(result).toContain("HTTP/1.1 200 OK");
    });
  });

  test("should handle CONNECT with invalid target", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    proxyServer.on("connect", (req, socket, head) => {
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port) || 80, host, () => {
        socket.write(`HTTP/1.1 200 Connection established\r\n\r\n`);
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });

      serverSocket.on("error", err => {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.end();
      });

      socket.on("error", () => serverSocket.destroy());
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write("CONNECT invalid.host.that.does.not.exist:9999 HTTP/1.1\r\nHost: invalid.host:9999\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<string>();
    const received: string[] = [];

    client.on("data", data => {
      received.push(data.toString());
    });

    client.on("end", () => {
      resolve(received.join(""));
    });

    const response = await promise;
    expect(response).toContain("502 Bad Gateway");
  });

  test("should handle CONNECT with authentication failure", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    proxyServer.on("connect", (req, socket, head) => {
      const auth = req.headers["proxy-authorization"];
      if (!auth || auth !== "Basic dXNlcjpwYXNzd29yZA==") {
        socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n");
        socket.write('Proxy-Authenticate: Basic realm="Proxy"\r\n\r\n');
        socket.end();
        return;
      }

      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      socket.end();
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    // Test without authentication
    const client1 = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client1.write("CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n");
    });

    const { promise: promise1, resolve: resolve1 } = Promise.withResolvers<string>();
    const received1: string[] = [];

    client1.on("data", data => {
      received1.push(data.toString());
    });

    client1.on("end", () => {
      resolve1(received1.join(""));
    });

    const response1 = await promise1;
    expect(response1).toContain("407 Proxy Authentication Required");

    // Test with correct authentication
    const client2 = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client2.write(
        "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nProxy-Authorization: Basic dXNlcjpwYXNzd29yZA==\r\n\r\n",
      );
    });

    const { promise: promise2, resolve: resolve2 } = Promise.withResolvers<string>();
    const received2: string[] = [];

    client2.on("data", data => {
      received2.push(data.toString());
    });

    client2.on("end", () => {
      resolve2(received2.join(""));
    });

    const response2 = await promise2;
    expect(response2).toContain("200 Connection established");
  });

  test("should handle partial writes and buffering", async () => {
    await using proxyServer = http.createServer();
    let bufferReceived = "";

    proxyServer.on("connect", (req, socket, head) => {
      socket.on("data", chunk => {
        bufferReceived += chunk.toString();
      });

      // Send response in small chunks
      socket.write("HTTP/1.1 ");
      setTimeout(() => socket.write("200 "), 10);
      setTimeout(() => socket.write("Connection "), 20);
      setTimeout(() => socket.write("established\r\n\r\n"), 30);
      setTimeout(() => {
        socket.write("Test data");
        socket.end();
      }, 40);
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      // Send request in chunks
      client.write("CONNECT example.com:80 ");
      setTimeout(() => client.write("HTTP/1.1\r\n"), 5);
      setTimeout(() => client.write("Host: example.com\r\n\r\n"), 10);
      setTimeout(() => client.write("Client data"), 35);
    });

    const { promise, resolve } = Promise.withResolvers<string>();
    const received: string[] = [];

    client.on("data", data => {
      received.push(data.toString());
    });

    client.on("end", () => {
      resolve(received.join(""));
    });

    const response = await promise;
    expect(response).toContain("200 Connection established");
    expect(response).toContain("Test data");
    expect(bufferReceived).toContain("Client data");
  });

  test("should handle keep-alive connections", async () => {
    await using proxyServer = http.createServer();
    await using targetServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Length": "5" });
      res.end("Hello");
    });

    proxyServer.on("connect", (req, socket, head) => {
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, () => {
        socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });

      serverSocket.on("error", () => socket.end());
      socket.on("error", () => serverSocket.destroy());
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    await once(targetServer.listen(0, "127.0.0.1"), "listening");

    const proxyAddress = proxyServer.address() as AddressInfo;
    const targetAddress = targetServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(
        `CONNECT ${targetAddress.address}:${targetAddress.port} HTTP/1.1\r\nHost: ${targetAddress.address}:${targetAddress.port}\r\n\r\n`,
      );
    });

    const { promise, resolve } = Promise.withResolvers<string[]>();
    const responses: string[] = [];
    let requestCount = 0;

    client.on("data", data => {
      const str = data.toString();
      responses.push(str);

      if (str.includes("200 Connection established") && requestCount === 0) {
        // Send first request
        client.write("GET /first HTTP/1.1\r\nHost: example.com\r\nConnection: keep-alive\r\n\r\n");
        requestCount++;
      } else if (str.includes("Hello") && requestCount === 1) {
        // Send second request on same connection
        client.write("GET /second HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
        requestCount++;
      } else if (str.includes("Hello") && requestCount === 2) {
        client.end();
        resolve(responses);
      }
    });

    const allResponses = await promise;
    const combined = allResponses.join("");
    expect(combined).toContain("200 Connection established");
    expect(combined.match(/Hello/g)?.length).toBe(2);
  });
});
