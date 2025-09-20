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

  test("should be able to send data to the client using socket", async () => {
    for (let payload of ["Hello World", Buffer.alloc(1024 * 64, "bun").toString(), BIG_DATA]) {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      await using server = http.createServer((req, res) => {
        res.socket?.write(payload);
        res.socket?.end();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const serverAddress = server.address() as AddressInfo;
      const client = net.connect(serverAddress.port, serverAddress.address, () => {
        client.on("error", reject);
        const data_received: string[] = [];
        client.on("data", chunk => {
          data_received.push(chunk?.toString());
        });
        client.write("GET / HTTP/1.1\r\nHost: localhost:80\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        client.on("end", () => {
          resolve(data_received.join(""));
          client.end();
        });
      });
      expect(await promise).toBe(payload);
    }
  });

  test("should be able to read data from the client using socket", async () => {
    for (let payload of ["Hello World", Buffer.alloc(1024 * 64, "bun").toString(), BIG_DATA]) {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      let server_data_received: string[] = [];
      let client;
      await using server = http.createServer((req, res) => {
        const socket = res.socket!;
        socket.on("data", chunk => {
          server_data_received.push(chunk?.toString());
        });
        socket.on("end", () => {
          resolve(server_data_received.join(""));
          socket.end();
        });
        client.write(payload, () => {
          client.end();
        });
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const serverAddress = server.address() as AddressInfo;
      client = net.connect(serverAddress.port, serverAddress.address, () => {
        client.on("error", reject);
        client.write(
          `GET / HTTP/1.1\r\nHost: localhost:80\r\nConnection: close\r\nContent-Length:${payload.length}\r\n\r\n`,
        );
      });
      expect(await promise).toBe(payload);
    }
  });
});

describe("HTTP server CONNECT - Additional Tests", () => {
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

  // TODO: timeout is not supported in bun socket yet
  test.todo("should handle socket timeout", async () => {
    await using proxyServer = http.createServer();
    let timeoutFired = false;

    proxyServer.on("connect", (req, socket, head) => {
      socket.setTimeout(100);
      socket.on("timeout", () => {
        timeoutFired = true;
        socket.write("HTTP/1.1 408 Request Timeout\r\n\r\n");
        socket.end();
      });

      // Don't send any response immediately
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write("CONNECT example.com:80 HTTP/1.1\r\nHost: example.com\r\n\r\n");
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
    expect(timeoutFired).toBe(true);
    expect(response).toContain("408 Request Timeout");
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

  //TODO pause and resume only not supported in bun socket yet
  test.todo("should handle socket pause and resume", async () => {
    await using proxyServer = http.createServer();
    let pauseCount = 0;
    let resumeCount = 0;

    proxyServer.on("connect", (req, socket, head) => {
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");

      // Simulate backpressure scenario
      const interval = setInterval(() => {
        const canWrite = socket.write("X".repeat(1024));
        if (!canWrite) {
          pauseCount++;
          socket.pause();
          setTimeout(() => {
            resumeCount++;
            socket.resume();
          }, 50);
        }
      }, 10);

      socket.on("end", () => {
        clearInterval(interval);
        socket.end();
      });
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write("CONNECT example.com:80 HTTP/1.1\r\nHost: example.com\r\n\r\n");

      setTimeout(() => client.end(), 200);
    });

    const { promise, resolve } = Promise.withResolvers<number>();
    let bytesReceived = 0;

    client.on("data", data => {
      bytesReceived += data.length;
    });

    client.on("end", () => {
      resolve(bytesReceived);
    });

    const totalBytes = await promise;
    expect(totalBytes).toBeGreaterThan(0);
    expect(pauseCount).toBeGreaterThan(0);
    expect(resumeCount).toBeGreaterThan(0);
  });

  test("should handle malformed CONNECT requests", async () => {
    await using proxyServer = http.createServer();

    proxyServer.on("connect", (req, socket, head) => {
      // This shouldn't be reached for malformed requests
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      socket.end();
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    // Test various malformed requests
    const malformedRequests = [
      "CONNECT\r\n\r\n", // Missing target
      "CONNECT example.com HTTP/1.1\r\n\r\n", // Missing port
      "CONNECT :80 HTTP/1.1\r\n\r\n", // Missing host
      "CONNEC example.com:80 HTTP/1.1\r\n\r\n", // Typo in method
      "CONNECT example.com:80\r\n\r\n", // Missing HTTP version
    ];

    for (const request of malformedRequests) {
      const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
        client.write(request);
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      const received: string[] = [];

      client.on("data", data => {
        received.push(data.toString());
      });

      client.on("end", () => {
        resolve(received.join(""));
      });

      client.on("error", () => {
        resolve("CONNECTION_ERROR");
      });

      setTimeout(() => {
        client.end();
        resolve(received.join("") || "TIMEOUT");
      }, 100);

      const response = await promise;
      // Should either get an error response or timeout/connection error
      expect(response).not.toContain("200 Connection established");
    }
  });
});

/**
 * Test variations using normal HTTP requests and res.socket
 * These tests should run in both Node.js and Bun
 */

describe("HTTP server socket access via normal requests", () => {
  test("should handle streaming data through res.socket", async () => {
    const chunks = ["chunk1", "chunk2", "chunk3"];
    let receivedChunks: string[] = [];

    await using server = http.createServer((req, res) => {
      const socket = res.socket!;

      // Send HTTP headers manually
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n\r\n");

      // Send chunks in chunked encoding format
      let index = 0;
      const interval = setInterval(() => {
        if (index < chunks.length) {
          const chunk = chunks[index++];
          socket.write(`${chunk.length.toString(16)}\r\n${chunk}\r\n`);
        } else {
          socket.write("0\r\n\r\n"); // End chunk
          clearInterval(interval);
          socket.end();
        }
      }, 50);
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<void>();
    let response = "";

    client.on("data", chunk => {
      response += chunk.toString();
    });

    client.on("end", () => {
      // Parse chunked response
      const parts = response.split("\r\n\r\n")[1]; // Get body after headers
      if (parts) {
        const chunkRegex = /([0-9a-f]+)\r\n(.+?)\r\n/g;
        let match;
        while ((match = chunkRegex.exec(parts)) !== null) {
          if (match[1] !== "0") {
            receivedChunks.push(match[2]);
          }
        }
      }
      resolve();
    });

    await promise;
    expect(receivedChunks).toEqual(chunks);
  });

  //TODO: right now http server socket dont emit error event
  test.todo("should handle socket errors during normal requests", async () => {
    let errorHandled = false;

    await using server = http.createServer((req, res) => {
      const socket = res.socket!;

      socket.on("error", err => {
        errorHandled = true;
      });

      // Simulate an error condition
      setTimeout(() => {
        socket.destroy(new Error("Simulated error"));
      }, 50);
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<boolean>();

    client.on("error", () => {
      resolve(true);
    });

    client.on("close", () => {
      resolve(false);
    });

    await promise;
    expect(errorHandled).toBe(true);
  });

  test("should handle multiple requests on same socket", async () => {
    let requestCount = 0;

    await using server = http.createServer((req, res) => {
      requestCount++;
      const currentRequest = requestCount;

      if (req.url === "/first") {
        res.writeHead(200, {
          "Content-Length": "6",
          "Connection": "keep-alive",
        });
        res.end("First!");
      } else if (req.url === "/second") {
        res.writeHead(200, {
          "Content-Length": "7",
          "Connection": "close",
        });
        res.end("Second!");
      }
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      // Send first request
      client.write("GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<string[]>();
    const responses: string[] = [];
    let buffer = "";
    let firstResponseReceived = false;

    client.on("data", chunk => {
      buffer += chunk.toString();

      if (!firstResponseReceived && buffer.includes("First!")) {
        firstResponseReceived = true;
        responses.push(buffer);
        buffer = "";
        // Send second request on same connection
        client.write("GET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      } else if (buffer.includes("Second!")) {
        responses.push(buffer);
      }
    });

    client.on("end", () => {
      resolve(responses);
    });

    const results = await promise;
    expect(results.length).toBe(2);
    expect(results[0]).toContain("First!");
    expect(results[1]).toContain("Second!");
    expect(requestCount).toBe(2);
  });

  test.todo("should handle socket pause/resume during request", async () => {
    const largeData = Buffer.alloc(1024 * 1024, "x").toString();
    let pauseCount = 0;
    let resumeCount = 0;

    await using server = http.createServer((req, res) => {
      const socket = res.socket!;

      // Monitor socket state
      const originalPause = socket.pause.bind(socket);
      const originalResume = socket.resume.bind(socket);

      socket.pause = function () {
        pauseCount++;
        return originalPause();
      };

      socket.resume = function () {
        resumeCount++;
        return originalResume();
      };

      // Send large response to trigger backpressure
      res.writeHead(200, { "Content-Type": "text/plain" });

      const sendData = () => {
        let ok = true;
        while (ok) {
          ok = res.write(largeData);
          if (!ok) {
            // Wait for drain event
            res.once("drain", sendData);
            break;
          }
        }
      };

      sendData();

      setTimeout(() => res.end(), 100);
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<number>();
    let bytesReceived = 0;

    // Slow reader to trigger backpressure
    client.on("data", chunk => {
      bytesReceived += chunk.length;
      client.pause();
      setTimeout(() => client.resume(), 10);
    });

    client.on("end", () => {
      resolve(bytesReceived);
    });

    const total = await promise;
    expect(total).toBeGreaterThan(0);
  });

  test("should handle raw socket access for WebSocket-like protocol", async () => {
    const MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    await using server = http.createServer((req, res) => {
      const key = req.headers["sec-websocket-key"];

      const socket = res.socket!;

      // Calculate accept key (simplified, real implementation would use crypto)
      const acceptKey = Buffer.from(key + MAGIC_STRING).toString("base64");

      // Write WebSocket handshake response
      socket.write("HTTP/1.1 101 Switching Protocols\r\n");
      socket.write(`Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);

      // Now in WebSocket mode - send a simple text frame
      // Frame: FIN=1, opcode=1 (text), no mask, payload length < 126
      const message = "Hello WebSocket";
      const frame = Buffer.concat([
        Buffer.from([0x81, message.length]), // FIN + text opcode, length
        Buffer.from(message),
      ]);
      socket.write(frame);

      socket.on("data", chunk => {
        // Echo any received frames (simplified)
        socket.write(chunk);
      });
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.write("GET / HTTP/1.1\r\n");
      client.write("Host: localhost\r\n");
      client.write("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n");
      client.write("Sec-WebSocket-Version: 13\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<Buffer>();
    const chunks: Buffer[] = [];
    let upgraded = false;

    client.on("data", chunk => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks).toString();

      if (!upgraded && data.includes("101 Switching Protocols")) {
        upgraded = true;
      }

      if (upgraded && data.includes("Hello WebSocket")) {
        client.end();
        resolve(Buffer.concat(chunks));
      }
    });

    const result = await promise;
    expect(result.toString()).toContain("101 Switching Protocols");
    expect(result.toString()).toContain("Hello WebSocket");
  });

  test("should handle socket write queue and drain events", async () => {
    const hugeData = Buffer.alloc(1024 * 1024 * 16, "z");
    let drainFired = false;
    let writeReturnedFalse = false;

    await using server = http.createServer((req, res) => {
      const socket = res.socket!;

      socket.on("drain", () => {
        drainFired = true;
      });

      // Write HTTP response headers
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n");

      // Attempt to overflow the write buffer
      for (let i = 0; i < 100; i++) {
        const canWrite = socket.write(hugeData);
        if (!canWrite) {
          writeReturnedFalse = true;
          break;
        }
      }

      setTimeout(() => socket.end(), 200);
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");

      // Slow reader to cause backpressure
      client.pause();
      setTimeout(() => client.resume(), 100);
    });

    const { promise, resolve } = Promise.withResolvers<void>();
    let totalBytes = 0;

    client.on("data", chunk => {
      totalBytes += chunk.length;
    });

    client.on("end", () => {
      resolve();
    });

    await promise;
    expect(writeReturnedFalse).toBe(true);
    expect(drainFired).toBe(true);
    expect(totalBytes).toBeGreaterThan(0);
  });

  test("should handle mixing res methods with socket writes", async () => {
    await using server = http.createServer((req, res) => {
      // Use both res methods and direct socket access
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("From res.write: ");

      // Direct socket write
      res.socket?.write("From socket.write: ");

      // Back to res
      res.write("Back to res: ");

      // Use socket for final data
      res.socket?.write("Final from socket");

      // End with res
      res.end("!");
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<string>();
    let response = "";

    client.on("data", chunk => {
      response += chunk.toString();
    });

    client.on("end", () => {
      resolve(response);
    });

    const result = await promise;
    expect(result).toContain("From res.write:");
    expect(result).toContain("From socket.write:");
    expect(result).toContain("Back to res:");
    expect(result).toContain("Final from socket");
    expect(result).toContain("!");
  });
});
