import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import http from "http";

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

describe("HTTP client CONNECT", () => {
  test("http.request CONNECT tunnels through a proxy and emits 'connect'", async () => {
    // A minimal CONNECT proxy that echoes tunneled bytes back.
    const proxyServer = http.createServer();
    let target = "";
    let proxySocket: net.Socket | undefined;
    proxyServer.on("connect", (req, clientSocket) => {
      proxySocket = clientSocket;
      target = req.url ?? "";
      clientSocket.on("error", () => {});
      clientSocket.write("HTTP/1.1 200 Connection established\r\nProxy-Agent: bun-test\r\n\r\n");
      clientSocket.on("data", d => clientSocket.write(d));
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const { port } = proxyServer.address() as AddressInfo;

    try {
      const { promise, resolve, reject } = Promise.withResolvers<{
        statusCode: number;
        headers: Record<string, string>;
        echoed: string;
      }>();

      const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "example.com:443" });
      req.on("connect", (res, socket, head) => {
        socket.on("error", () => {});
        socket.on("data", d => {
          resolve({ statusCode: res.statusCode, headers: res.headers, echoed: d.toString() });
          socket.destroy();
        });
        socket.write("ping");
      });
      req.on("error", reject);
      req.end();

      const result = await promise;
      // The tunnel target must be sent verbatim (no leading slash).
      expect(target).toBe("example.com:443");
      expect(result.statusCode).toBe(200);
      expect(result.headers["proxy-agent"]).toBe("bun-test");
      expect(result.echoed).toBe("ping");
    } finally {
      proxySocket?.destroy();
      await new Promise<void>(r => proxyServer.close(() => r()));
    }
  });

  test("http.request CONNECT emits 'connect' even on a non-200 status", async () => {
    const proxyServer = net.createServer(socket => {
      socket.on("error", () => {});
      socket.on("data", () => socket.write("HTTP/1.1 403 Forbidden\r\nX-Reason: denied\r\n\r\n"));
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const { port } = proxyServer.address() as AddressInfo;

    try {
      const { promise, resolve, reject } = Promise.withResolvers<{
        statusCode: number;
        statusMessage: string;
        headers: Record<string, string>;
      }>();

      const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "example.com:443" });
      req.on("connect", (res, socket) => {
        resolve({ statusCode: res.statusCode, statusMessage: res.statusMessage, headers: res.headers });
        socket.destroy();
      });
      req.on("error", reject);
      req.end();

      const result = await promise;
      expect(result.statusCode).toBe(403);
      expect(result.statusMessage).toBe("Forbidden");
      expect(result.headers["x-reason"]).toBe("denied");
    } finally {
      await new Promise<void>(r => proxyServer.close(() => r()));
    }
  });

  test("http.request CONNECT trims optional whitespace around proxy header values", async () => {
    const proxyServer = net.createServer(socket => {
      socket.on("error", () => {});
      // Leading tab, two leading spaces, and a trailing space — llhttp trims all.
      socket.on("data", () =>
        socket.write("HTTP/1.1 200 OK\r\nX-Tab:\tt-val\r\nX-Two:  two-val\r\nX-Trail: trail-val \r\n\r\n"),
      );
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const { port } = proxyServer.address() as AddressInfo;

    try {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, string>>();
      const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "h:1" });
      req.on("connect", (res, socket) => {
        resolve(res.headers);
        socket.destroy();
      });
      req.on("error", reject);
      req.end();

      const headers = await promise;
      expect(headers["x-tab"]).toBe("t-val");
      expect(headers["x-two"]).toBe("two-val");
      expect(headers["x-trail"]).toBe("trail-val");
    } finally {
      await new Promise<void>(r => proxyServer.close(() => r()));
    }
  });

  test("http.request CONNECT delivers bytes received after the headers as 'head'", async () => {
    const proxyServer = net.createServer(socket => {
      socket.on("error", () => {});
      socket.on("data", () => socket.write("HTTP/1.1 200 OK\r\n\r\nEARLY-DATA"));
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const { port } = proxyServer.address() as AddressInfo;

    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "h:1" });
      req.on("connect", (res, socket, head) => {
        expect(head).toBeInstanceOf(Buffer);
        resolve(head.toString());
        socket.destroy();
      });
      req.on("error", reject);
      req.end();

      expect(await promise).toBe("EARLY-DATA");
    } finally {
      await new Promise<void>(r => proxyServer.close(() => r()));
    }
  });

  test("http.request CONNECT emits 'error' then 'close' when the proxy is unreachable", async () => {
    // Bind then immediately close to obtain a port nothing listens on.
    const tmp = net.createServer();
    await once(tmp.listen(0, "127.0.0.1"), "listening");
    const { port } = tmp.address() as AddressInfo;
    await new Promise<void>(r => tmp.close(() => r()));

    const { promise, resolve, reject } = Promise.withResolvers<{ code: string; events: string[] }>();
    const events: string[] = [];
    const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "example.com:443" });
    req.on("connect", () => reject(new Error("unexpected connect")));
    let code = "";
    req.on("error", err => {
      events.push("error");
      code = (err as NodeJS.ErrnoException).code ?? err.message;
    });
    // Node emits 'close' on the request after a failed connection.
    req.on("close", () => {
      events.push("close");
      resolve({ code, events });
    });
    req.end();

    const result = await promise;
    expect(result.code).toBe("ECONNREFUSED");
    expect(result.events).toEqual(["error", "close"]);
  });

  test("http.request CONNECT rejects a malformed proxy status line with 'error'", async () => {
    const proxyServer = net.createServer(socket => {
      socket.on("error", () => {});
      // Not a valid HTTP status line, but terminated like a header block.
      socket.on("data", () => socket.write("garbage not http\r\nX: y\r\n\r\n"));
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const { port } = proxyServer.address() as AddressInfo;

    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = http.request({ method: "CONNECT", host: "127.0.0.1", port, path: "example.com:443" });
      req.on("connect", () => reject(new Error("unexpected connect on malformed response")));
      req.on("error", err => resolve((err as NodeJS.ErrnoException).code ?? err.message));
      req.end();

      // Node surfaces an llhttp parse error (HPE_*). We only require that it's an
      // error rather than a bogus tunnel, so assert the code class loosely.
      const code = await promise;
      expect(code).toContain("HPE_");
    } finally {
      await new Promise<void>(r => proxyServer.close(() => r()));
    }
  });

  test("http.request CONNECT resolves the proxy host with a custom lookup", async () => {
    const proxyServer = http.createServer();
    let proxySocket: net.Socket | undefined;
    proxyServer.on("connect", (req, clientSocket) => {
      proxySocket = clientSocket;
      clientSocket.on("error", () => {});
      clientSocket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const { port } = proxyServer.address() as AddressInfo;

    try {
      let lookupCalledWith = "";
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      const req = http.request({
        method: "CONNECT",
        // A name that only the custom lookup can resolve.
        host: "proxy.invalid.test",
        port,
        path: "example.com:443",
        lookup: (hostname: string, _opts: any, cb: any) => {
          lookupCalledWith = hostname;
          // net.connect() defaults autoSelectFamily on, so the all-addresses
          // array form is what both Node and Bun expect here.
          cb(null, [{ address: "127.0.0.1", family: 4 }]);
        },
      });
      req.on("connect", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end();

      const statusCode = await promise;
      expect(lookupCalledWith).toBe("proxy.invalid.test");
      expect(statusCode).toBe(200);
    } finally {
      proxySocket?.destroy();
      await new Promise<void>(r => proxyServer.close(() => r()));
    }
  });
});

describe("Should be compatible with node.js", () => {
  // These spawn a full `node --test` / `bun test` run of the sibling file, which
  // can take several seconds. Give them a generous timeout so they don't race the
  // default 5s deadline on a loaded CI machine.
  test("tests should run on node.js", async () => {
    const process = Bun.spawn({
      cmd: [nodeExe(), "--test", join(import.meta.dir, "node-http-connect.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  }, 30_000);
  test("tests should run on bun", async () => {
    const process = Bun.spawn({
      cmd: [bunExe(), "test", join(import.meta.dir, "node-http-connect.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  }, 30_000);
});
