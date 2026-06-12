import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tls as tlsCert } from "harness";
import http from "http";
import https from "node:https";
import tls from "node:tls";

import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { join } from "node:path";
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
  test("should handle backpressure", async () => {
    const responseHeader = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });
    await using targetServer = net.createServer(socket => {
      socket.write(responseHeader, () => {
        socket.write(BIG_DATA, () => {
          //TODO: is this a net bug? on windows the connection is closed before everything is sended
          Bun.sleep(100).then(() => {
            socket.end();
          });
        });
      });
    });
    let proxyHeaders = {};
    proxyServer.on("connect", (req, socket, head) => {
      proxyHeaders = req.headers;
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, async () => {
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
      expect(response.length).toBeGreaterThan(responseHeader.length + BIG_DATA.length);
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
      // write until backpressure
      while (socket.write(BIG_DATA)) {}
      clientSocket.write("Hello World");
    });

    expect(await promise).toContain("Hello World");
    expect(await clientPromise).toContain(BIG_DATA);
    expect(proxy_drain_received).toBe(true);
    expect(proxy_end_received).toBe(true);
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
 * Client-side CONNECT: https://github.com/oven-sh/bun/issues/32171
 * Node hands any response to a CONNECT request to the caller through the
 * 'connect' event together with the raw socket and the bytes that followed
 * the response headers. These tests assert Node's observable behavior.
 */
describe("HTTP client CONNECT", () => {
  /** Raw TCP server that records the request head, replies with `response`, then echoes tunnel data. */
  function rawConnectServer(response: string) {
    const requestHead = Promise.withResolvers<string>();
    const server = net.createServer(sock => {
      let buffered = Buffer.alloc(0);
      const onRequestData = (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.includes("\r\n\r\n")) {
          sock.off("data", onRequestData);
          requestHead.resolve(buffered.toString());
          sock.write(response);
          sock.on("data", tunneled => sock.write(tunneled));
        }
      };
      sock.on("data", onRequestData);
      sock.on("error", requestHead.reject);
    });
    return { server, requestHead: requestHead.promise };
  }

  /** Collects head + subsequent socket data until at least `length` bytes arrived (or the socket closed). */
  function collectTunnelData(socket: net.Socket, head: Buffer, length: number): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let collected = head.toString();
    if (collected.length >= length) resolve(collected);
    socket.on("data", chunk => {
      collected += chunk.toString();
      if (collected.length >= length) resolve(collected);
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(collected));
    return promise;
  }

  function connectRequest(options: http.RequestOptions) {
    const req = http.request(options);
    const connected = Promise.withResolvers<{ res: http.IncomingMessage; socket: net.Socket; head: Buffer }>();
    req.on("connect", (res, socket, head) => connected.resolve({ res, socket, head }));
    req.on("response", () => connected.reject(new Error("unexpected 'response' event for CONNECT")));
    req.on("error", connected.reject);
    req.end();
    return { req, connected: connected.promise };
  }

  test("sends an authority-form request-target and emits 'connect' on 2xx", async () => {
    const { server, requestHead } = rawConnectServer(
      "HTTP/1.1 200 Connection Established\r\nX-Tunnel: yes\r\n\r\nHEAD-BYTES",
    );
    await using _server = server;
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const { req, connected } = connectRequest({ method: "CONNECT", host: "127.0.0.1", port, path: "example.com:443" });
    const closed = Promise.withResolvers<void>();
    req.on("close", closed.resolve);

    const rawRequest = await requestHead;
    const requestLines = rawRequest.split("\r\n");
    expect(requestLines[0]).toBe("CONNECT example.com:443 HTTP/1.1");
    expect(requestLines).toContain(`Host: 127.0.0.1:${port}`);
    expect(requestLines).toContain("Connection: keep-alive");
    // CONNECT requests have no body; Node does not send a Content-Length.
    expect(rawRequest.toLowerCase()).not.toContain("content-length");

    const { res, socket, head } = await connected;
    expect(socket).toBeInstanceOf(net.Socket);
    expect({
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      httpVersion: res.httpVersion,
      xTunnel: res.headers["x-tunnel"],
      complete: res.complete,
    }).toEqual({
      statusCode: 200,
      statusMessage: "Connection Established",
      httpVersion: "1.1",
      xTunnel: "yes",
      complete: true,
    });

    // The tunnel is bidirectional: the server echoes what we send through the socket.
    const echoed = collectTunnelData(socket, head, "HEAD-BYTESping!".length);
    socket.write("ping!");
    expect(await echoed).toBe("HEAD-BYTESping!");

    await closed.promise;
    expect(req.destroyed).toBe(true);
    socket.end();
  });

  test("emits 'connect' (not 'response') for non-2xx responses", async () => {
    const { server } = rawConnectServer(
      'HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 6\r\nProxy-Authenticate: Basic realm="proxy"\r\n\r\ndenied',
    );
    await using _server = server;
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const { connected } = connectRequest({ method: "CONNECT", host: "127.0.0.1", port, path: "example.com:80" });
    const { res, socket, head } = await connected;
    expect(res.statusCode).toBe(407);
    expect(res.statusMessage).toBe("Proxy Authentication Required");
    expect(res.headers["proxy-authenticate"]).toBe('Basic realm="proxy"');
    // Bytes after the response headers are tunnel data, not a response body.
    expect(await collectTunnelData(socket, head, 6)).toBe("denied");
    socket.end();
  });

  test("connection refused reports a Node-shaped ECONNREFUSED error", async () => {
    // Find a free port with nothing listening on it.
    const probe = net.createServer();
    await once(probe.listen(0, "127.0.0.1"), "listening");
    const { port } = probe.address() as AddressInfo;
    await new Promise(resolve => probe.close(resolve));

    const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "test:80" });
    const errored = Promise.withResolvers<NodeJS.ErrnoException & { address?: string; port?: number }>();
    req.on("connect", () => errored.reject(new Error("unexpected 'connect' event")));
    req.on("error", errored.resolve);
    req.end();

    const err = await errored.promise;
    expect({
      message: err.message,
      code: err.code,
      syscall: err.syscall,
      address: err.address,
      port: err.port,
    }).toEqual({
      message: `connect ECONNREFUSED 127.0.0.1:${port}`,
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "127.0.0.1",
      port,
    });
  });

  test("emits 'socket hang up' when the connection closes before a response", async () => {
    await using server = net.createServer(sock => sock.destroy());
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "test:80" });
    const errored = Promise.withResolvers<NodeJS.ErrnoException>();
    req.on("connect", () => errored.reject(new Error("unexpected 'connect' event")));
    req.on("error", errored.resolve);
    req.end();

    const err = await errored.promise;
    expect(err.message).toBe("socket hang up");
    expect(err.code).toBe("ECONNRESET");
  });

  test("closes the connection when nobody listens for 'connect'", async () => {
    const serverSawClose = Promise.withResolvers<void>();
    await using server = net.createServer(sock => {
      sock.once("data", () => sock.write("HTTP/1.1 200 Connection Established\r\n\r\n"));
      sock.on("close", serverSawClose.resolve);
      sock.on("error", () => {});
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "test:80" });
    const closed = Promise.withResolvers<void>();
    req.on("error", closed.reject);
    req.on("close", closed.resolve);
    req.end();

    await serverSawClose.promise;
    await closed.promise;
  });

  test("tunnels an HTTP request through a proxy built with node:http", async () => {
    await using targetServer = http.createServer((req, res) => {
      res.end("hello from target");
    });
    await once(targetServer.listen(0, "127.0.0.1"), "listening");
    const targetAddress = targetServer.address() as AddressInfo;

    await using proxyServer = http.createServer();
    proxyServer.on("connect", (proxyReq, clientSocket, head) => {
      const [host, port] = proxyReq.url!.split(":");
      const serverSocket = net.connect(parseInt(port), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });
      serverSocket.on("error", () => clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
      clientSocket.on("error", () => serverSocket.destroy());
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { connected } = connectRequest({
      method: "CONNECT",
      host: proxyAddress.address,
      port: proxyAddress.port,
      path: `${targetAddress.address}:${targetAddress.port}`,
    });
    const { res, socket } = await connected;
    expect(res.statusCode).toBe(200);

    const response = Promise.withResolvers<string>();
    let data = "";
    socket.on("data", chunk => (data += chunk));
    socket.on("end", () => response.resolve(data));
    socket.on("error", response.reject);
    socket.write(`GET / HTTP/1.1\r\nHost: ${targetAddress.address}:${targetAddress.port}\r\nConnection: close\r\n\r\n`);

    const rawResponse = await response.promise;
    expect(rawResponse).toContain("HTTP/1.1 200 OK");
    expect(rawResponse).toContain("hello from target");
  });

  test("establishes CONNECT over TLS through an https proxy", async () => {
    const requestHead = Promise.withResolvers<string>();
    await using server = tls.createServer({ cert: tlsCert.cert, key: tlsCert.key }, sock => {
      let buffered = "";
      sock.on("data", chunk => {
        buffered += chunk;
        if (buffered.includes("\r\n\r\n")) {
          requestHead.resolve(buffered);
          sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        }
      });
      sock.on("error", requestHead.reject);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const req = https.request({
      method: "CONNECT",
      host: "127.0.0.1",
      port,
      path: "target:443",
      ca: tlsCert.cert,
      servername: "localhost",
    });
    const connected = Promise.withResolvers<{ res: http.IncomingMessage; socket: tls.TLSSocket }>();
    req.on("connect", (res, socket) => connected.resolve({ res, socket: socket as tls.TLSSocket }));
    req.on("error", connected.reject);
    req.end();

    expect((await requestHead.promise).split("\r\n")[0]).toBe("CONNECT target:443 HTTP/1.1");
    const { res, socket } = await connected.promise;
    expect(res.statusCode).toBe(200);
    expect(socket.encrypted).toBe(true);
    socket.end();
  });
});

/**
 * Test variations using normal HTTP requests and res.socket
 * These tests should run in both Node.js and Bun
 */

describe("HTTP server socket access via normal requests", () => {
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
});

describe("Should be compatible with node.js", () => {
  // The spawned run executes the whole node-http-connect.node.mts suite, which
  // takes several seconds on debug builds; the default 5s timeout is too tight.
  test("tests should run on node.js", async () => {
    const process = Bun.spawn({
      cmd: [nodeExe(), "--test", join(import.meta.dir, "node-http-connect.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  }, 60_000);
  test("tests should run on bun", async () => {
    const process = Bun.spawn({
      cmd: [bunExe(), "test", join(import.meta.dir, "node-http-connect.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  }, 60_000);
});
