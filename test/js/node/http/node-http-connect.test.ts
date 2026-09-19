import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, nodeExe, tempDir, tls as tlsCert } from "harness";
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
      // Accepted net sockets start in Node's flowing=null state; drain the
      // inbound GET so 'end' can fire and server.close() can resolve.
      socket.resume();
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

  test("should deliver bytes following a CONNECT request with Content-Length: 0 to the connect socket, not as a new request", async () => {
    const requestUrls: string[] = [];
    await using proxyServer = http.createServer((req, res) => {
      requestUrls.push(req.url ?? "");
      res.end();
    });

    const pipelined = "GET /pipelined HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const afterEstablished = "GET /after-established HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const expectedTunneled = pipelined + afterEstablished;

    const { promise: tunneled, resolve: resolveTunneled, reject: rejectTunneled } = Promise.withResolvers<string>();
    proxyServer.on("connect", (req, socket, head) => {
      const chunks: Buffer[] = [head];
      let receivedLength = head.length;
      socket.on("data", chunk => {
        chunks.push(chunk);
        receivedLength += chunk.length;
        if (receivedLength >= Buffer.byteLength(expectedTunneled)) {
          socket.end();
        }
      });
      socket.on("end", () => {
        resolveTunneled(Buffer.concat(chunks).toString());
      });
      socket.on("error", rejectTunneled);
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { promise: clientReceived, resolve: resolveClient, reject: rejectClient } = Promise.withResolvers<string>();
    const received: string[] = [];
    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(`CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nContent-Length: 0\r\n\r\n${pipelined}`);
    });
    client.on("data", data => {
      received.push(data.toString());
      if (received.join("") === "HTTP/1.1 200 Connection established\r\n\r\n") {
        client.write(afterEstablished);
      }
    });
    client.on("error", rejectClient);
    client.on("end", () => {
      client.end();
      resolveClient(received.join(""));
    });

    expect(await tunneled).toBe(expectedTunneled);
    expect(await clientReceived).toBe("HTTP/1.1 200 Connection established\r\n\r\n");
    expect(requestUrls).toEqual([]);
  });

  // Node v26.3.0 tunnels "5\r\nhello\r\n0\r\n\r\nGET ..." verbatim — the chunked framing
  // bytes reach the connect socket un-decoded and no 'request' event fires.
  test("should deliver bytes following a CONNECT request with Transfer-Encoding: chunked raw, not chunk-decoded", async () => {
    const requestUrls: string[] = [];
    await using proxyServer = http.createServer((req, res) => {
      requestUrls.push(req.url ?? "");
      res.end();
    });

    const pipelined = "5\r\nhello\r\n0\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const afterEstablished = "GET /after-established HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const expectedTunneled = pipelined + afterEstablished;

    const { promise: tunneled, resolve: resolveTunneled, reject: rejectTunneled } = Promise.withResolvers<string>();
    proxyServer.on("connect", (req, socket, head) => {
      const chunks: Buffer[] = [head];
      let receivedLength = head.length;
      socket.on("data", chunk => {
        chunks.push(chunk);
        receivedLength += chunk.length;
        if (receivedLength >= Buffer.byteLength(expectedTunneled)) {
          socket.end();
        }
      });
      socket.on("end", () => {
        resolveTunneled(Buffer.concat(chunks).toString());
      });
      socket.on("error", rejectTunneled);
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { promise: clientReceived, resolve: resolveClient, reject: rejectClient } = Promise.withResolvers<string>();
    const received: string[] = [];
    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(
        `CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nTransfer-Encoding: chunked\r\n\r\n${pipelined}`,
      );
    });
    client.on("data", data => {
      received.push(data.toString());
      if (received.join("") === "HTTP/1.1 200 Connection established\r\n\r\n") {
        client.write(afterEstablished);
      }
    });
    client.on("error", rejectClient);
    client.on("end", () => {
      client.end();
      resolveClient(received.join(""));
    });

    expect(await tunneled).toBe(expectedTunneled);
    expect(await clientReceived).toBe("HTTP/1.1 200 Connection established\r\n\r\n");
    expect(requestUrls).toEqual([]);
  });

  // Node v26.3.0 tunnels "helloGET /smuggled ..." verbatim — the declared body and
  // everything after it reach the connect socket and no 'request' event fires.
  test("should deliver the body and trailing bytes of a CONNECT request with a nonzero Content-Length to the connect socket, not as a new request", async () => {
    const requestUrls: string[] = [];
    await using proxyServer = http.createServer((req, res) => {
      requestUrls.push(req.url ?? "");
      res.end();
    });

    const pipelined = "helloGET /smuggled HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const afterEstablished = "GET /after-established HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const expectedTunneled = pipelined + afterEstablished;

    const { promise: tunneled, resolve: resolveTunneled, reject: rejectTunneled } = Promise.withResolvers<string>();
    proxyServer.on("connect", (req, socket, head) => {
      const chunks: Buffer[] = [head];
      let receivedLength = head.length;
      socket.on("data", chunk => {
        chunks.push(chunk);
        receivedLength += chunk.length;
        if (receivedLength >= Buffer.byteLength(expectedTunneled)) {
          socket.end();
        }
      });
      socket.on("end", () => {
        resolveTunneled(Buffer.concat(chunks).toString());
      });
      socket.on("error", rejectTunneled);
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { promise: clientReceived, resolve: resolveClient, reject: rejectClient } = Promise.withResolvers<string>();
    const received: string[] = [];
    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(`CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nContent-Length: 5\r\n\r\n${pipelined}`);
    });
    client.on("data", data => {
      received.push(data.toString());
      if (received.join("") === "HTTP/1.1 200 Connection established\r\n\r\n") {
        client.write(afterEstablished);
      }
    });
    client.on("error", rejectClient);
    client.on("end", () => {
      client.end();
      resolveClient(received.join(""));
    });

    expect(await tunneled).toBe(expectedTunneled);
    expect(await clientReceived).toBe("HTTP/1.1 200 Connection established\r\n\r\n");
    expect(requestUrls).toEqual([]);
  });

  // Node v26.3.0: HPE_INVALID_CONTENT_LENGTH — Transfer-Encoding + Content-Length is
  // rejected with a 400 before the 'connect' event is dispatched.
  test("should reject a CONNECT request carrying both Transfer-Encoding and Content-Length with a 400", async () => {
    const requestUrls: string[] = [];
    await using proxyServer = http.createServer((req, res) => {
      requestUrls.push(req.url ?? "");
      res.end();
    });
    let connectEvents = 0;
    proxyServer.on("connect", (req, socket) => {
      connectEvents++;
      socket.end();
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const received: string[] = [];
    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(
        "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n",
      );
    });
    client.on("data", data => received.push(data.toString()));
    client.on("error", reject);
    client.on("close", () => resolve(received.join("")));

    const response = await promise;
    expect(response).toContain("400 Bad Request");
    expect(connectEvents).toBe(0);
    expect(requestUrls).toEqual([]);
  });

  test("should handle malformed CONNECT requests", async () => {
    await using proxyServer = http.createServer();

    proxyServer.on("connect", (req, socket, head) => {
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      socket.end();
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    // Requests Node.js rejects before dispatching the 'connect' event.
    const malformedRequests = [
      "CONNECT\r\n\r\n", // Missing target
      "CONNEC example.com:80 HTTP/1.1\r\n\r\n", // Typo in method
      "CONNECT example.com:80\r\n\r\n", // Missing HTTP version (Node.js treats this as ancient HTTP; we reject it)
    ];

    // Node.js dispatches these to the 'connect' event: CONNECT requests are
    // exempt from the Host requirement and the authority form is not
    // validated beyond tokenization (verified against Node.js).
    const acceptedRequests = [
      "CONNECT example.com HTTP/1.1\r\n\r\n", // Missing port
      "CONNECT :80 HTTP/1.1\r\n\r\n", // Missing host
    ];

    for (const request of acceptedRequests) {
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

      const response = await promise;
      expect(response).toContain("200 Connection established");
    }

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

  // https CONNECT: server socket.end() after peer FIN must also FIN the TCP
  // write side. Linux-only: the close is observed via EPOLLHUP once both halves
  // have FIN'd; kqueue/libuv need the readable_ended re-arm to re-derive it.
  test.skipIf(!isLinux)(
    "https CONNECT socket.end() after peer FIN half-closes TCP so the socket can close",
    async () => {
      // tls.connect wraps a raw net.Socket so end() sends a raw FIN (not
      // close_notify first): that ordering has the server's eof already
      // consumed by allow_half_open before the deferred socket.end() runs.
      const fixture = /* js */ `
      const https = require("node:https");
      const net = require("node:net");
      const tls = require("node:tls");

      const server = https.createServer({ cert: process.env.CERT, key: process.env.KEY }, () => {});
      server.on("connect", (req, socket) => {
        // autoDestroy off: only the transport (EPOLLHUP once our FIN answers
        // the peer's) can close this socket.
        socket._readableState.autoDestroy = false;
        socket._writableState.autoDestroy = false;
        socket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
        socket.on("end", () => {
          console.log("server:end");
          socket.end();
        });
        socket.on("finish", () => console.log("server:finish"));
        socket.on("close", () => {
          console.log("server:close");
          server.close();
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const raw = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true });
        const client = tls.connect({ socket: raw, rejectUnauthorized: false });
        client.on("secureConnect", () => {
          client.write("CONNECT example.com:443 HTTP/1.1\\r\\nHost: example.com:443\\r\\n\\r\\n");
        });
        client.on("data", () => client.end());
        client.on("close", () => console.log("client:close"));
      });
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, CERT: tlsCert.cert, KEY: tlsCert.key },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Before the fix the server socket never closes: stdout stops at
      // server:finish and the process hangs until the test timeout. client:close
      // and server:close may interleave, so assert presence + server ordering.
      const lines = stdout.split("\n").filter(Boolean);
      expect({
        server: lines.filter(l => l.startsWith("server:")),
        hasClientClose: lines.includes("client:close"),
        stderr,
        exitCode,
      }).toEqual({
        server: ["server:end", "server:finish", "server:close"],
        hasClientClose: true,
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.skipIf(isWindows)(
    "AF_UNIX CONNECT sockets whose peer closes first do not spin the loop on EPOLLHUP",
    async () => {
      // An AF_UNIX peer close() on a half-open (CONNECT hand-off) socket is EPOLLHUP, which is level-triggered:
      // the loop must stay idle while the server still holds its side, and each socket ends and closes once.
      using dir = tempDir("connect-unix-hangup", {});
      const result = await bunRun(join(import.meta.dir, "node-http-connect-unix-hangup-fixture.js"), {
        SOCK: join(String(dir), "proxy.sock"),
      });
      const perTarget = Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`peer-${i}:443`, { ends: 1, closes: 1 }]),
      );
      expect(result).toEqual({
        stdout: JSON.stringify(perTarget) + "\nidle",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );
});

// A CONNECT that the server parses while an earlier response on the connection is still pending.
// The dispatcher answered it like a request: the client got a 200 OK for a tunnel that did not
// exist, the bytes it sent next reached no listener, and the server kept the socket after the
// client was gone. No issue reports this, it was found in the dispatcher's code. Node v26.3.0
// gives the same result in every test here, except in the one that says so.
describe("CONNECT pipelined behind a pending response", () => {
  const get = (path: string) => `GET ${path} HTTP/1.1\r\nHost: example.com\r\n\r\n`;
  const CONNECT = "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n";
  const ESTABLISHED = "HTTP/1.1 200 Connection established\r\n\r\n";
  // Drops the header block of each response. The bodies and the raw tunnel bytes stay.
  const withoutResponseHeads = (received: string) =>
    received.replace(/HTTP\/1\.1 200 OK\r\n(?:[^\r\n]+\r\n)*\r\n/g, "");

  // The client writes `written` in one write. `respond` answers the requests ahead of the CONNECT
  // and leaves the first response open. The 'connect' listener ends that response. The tunnel
  // answers once, when the client ends its side.
  async function pipelinedConnect(options: {
    written: string;
    events: string[];
    respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  }) {
    const events: string[] = [];
    let first: http.ServerResponse | undefined;
    const { promise: firstFinished, resolve: onFirstFinished, reject: onFailure } = Promise.withResolvers<void>();
    await using server = http.createServer((req, res) => {
      events.push(`request ${req.method} ${req.url}`);
      if (req.method === "CONNECT") {
        // A CONNECT gets here only when it was not dispatched as 'connect'. Both responses end,
        // so the events below are compared and nothing waits.
        res.end("not a tunnel");
        first!.end();
        return;
      }
      first ??= res.on("finish", onFirstFinished);
      options.respond(req, res);
    });
    server.on("clientError", onFailure);
    server.on("connect", (req, socket, head) => {
      events.push(`connect ${req.url} upgrade=${req.upgrade}`);
      let tunneled = head.toString();
      socket.on("data", chunk => (tunneled += chunk));
      socket.on("end", () => socket.end(`${ESTABLISHED}tunneled:${tunneled}`));
      first!.end();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");

    const client = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    try {
      const received: Buffer[] = [];
      client.on("data", chunk => received.push(chunk));
      client.on("error", onFailure);
      client.on("close", () => onFailure(new Error(`closed before the first response finished: ${events}`)));
      client.write(options.written);
      await firstFinished;
      expect(events).toEqual(options.events);
      // The tunnel is not an idle HTTP connection, also when the response ahead of it is complete.
      server.closeIdleConnections();
      client.end("later");
      await once(client, "close");
      return Buffer.concat(received).toString("latin1");
    } finally {
      client.destroy();
    }
  }

  test("should emit 'connect' and tunnel the bytes that follow", async () => {
    const received = await pipelinedConnect({
      written: get("/first") + CONNECT + "head,",
      events: ["request GET /first", "connect example.com:443 upgrade=true"],
      respond: (req, res) => void res.write("first"),
    });
    expect(withoutResponseHeads(received)).toBe(`5\r\nfirst\r\n0\r\n\r\n${ESTABLISHED}tunneled:head,later`);
  });

  test("should keep the order of the responses that are queued ahead of it", async () => {
    const received = await pipelinedConnect({
      written: get("/first") + get("/second") + CONNECT,
      events: ["request GET /first", "request GET /second", "connect example.com:443 upgrade=true"],
      respond: (req, res) => void (req.url === "/first" ? res.write("first") : res.end("second")),
    });
    expect(withoutResponseHeads(received)).toBe(`5\r\nfirst\r\n0\r\n\r\nsecond${ESTABLISHED}tunneled:later`);
  });

  test("should read the tunnel again after the pending response has drained", async () => {
    // The response is larger than the socket buffers, so a part of it is still unsent when the
    // server parses the CONNECT. That pauses the reads of the connection until it has drained.
    const chunk = Buffer.alloc(15 * 1024, "a");
    const count = 1024;
    const received = await pipelinedConnect({
      written: get("/first") + CONNECT,
      events: ["request GET /first", "connect example.com:443 upgrade=true"],
      respond: (req, res) => {
        res.writeHead(200, { "Content-Length": chunk.length * count });
        for (let i = 0; i < count; i++) res.write(chunk);
      },
    });
    const bodyStart = received.indexOf("\r\n\r\n") + 4;
    const tunnelStart = received.indexOf(ESTABLISHED, bodyStart);
    expect({ bodyLength: tunnelStart - bodyStart, tunnel: received.slice(tunnelStart) }).toEqual({
      bodyLength: chunk.length * count,
      tunnel: `${ESTABLISHED}tunneled:later`,
    });
  });

  test("should read the tunnel when the request ahead of it paused the connection", async () => {
    // In tunnel mode req.resume() no longer reaches the connection, so the pause has to end with
    // the handoff. Without that the client's bytes are never read and the test times out.
    const body = "0123456789";
    const received = await pipelinedConnect({
      written: `POST /first HTTP/1.1\r\nHost: example.com\r\nContent-Length: ${body.length}\r\n\r\n${body}` + CONNECT,
      events: ["request POST /first", "connect example.com:443 upgrade=true"],
      respond: (req, res) => {
        req.pause();
        res.write("first");
      },
    });
    expect(withoutResponseHeads(received)).toBe(`5\r\nfirst\r\n0\r\n\r\n${ESTABLISHED}tunneled:later`);
  });

  // A second connection does a whole exchange. When it is over, the server has also read what
  // the first connection sent before it.
  async function barrier(port: number) {
    const socket = net.connect(port, "127.0.0.1");
    socket.resume();
    socket.end(`GET /barrier HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n`);
    await once(socket, "close");
  }

  test("should keep the bytes that arrive before the 'connect' listener reads the socket", async () => {
    // The response ahead ends after the handoff, and its request is dumped then. That must not
    // make the socket flow: a socket that flows without a reader discards what it receives.
    let first: http.ServerResponse | undefined;
    const { promise: handedOff, resolve: onHandoff, reject: onFailure } = Promise.withResolvers<net.Socket>();
    await using server = http.createServer((req, res) => {
      if (req.url === "/first") return void (first = res);
      res.end();
      if (req.method === "CONNECT") {
        first!.end();
        onFailure(new Error("the CONNECT was dispatched as a request"));
      }
    });
    server.on("connect", (req, socket) => {
      first!.end("first");
      onHandoff(socket);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", onFailure);
      client.resume();
      client.write(get("/first") + CONNECT);
      const tunnel = await handedOff;
      client.write("early,");
      await barrier(port);
      let tunneled = "";
      tunnel.on("data", chunk => (tunneled += chunk));
      const tunnelEnded = once(tunnel, "end");
      client.end("late");
      await tunnelEnded;
      tunnel.end();
      expect(tunneled).toBe("early,late");
    } finally {
      client.destroy();
    }
  });

  // The throw becomes an uncaught exception, and the handoff stands: the tunnel still echoes, and
  // a response ahead of the CONNECT still completes.
  for (const pipelined of [true, false]) {
    test.concurrent(
      `should keep the tunnel when the 'connect' listener throws (${pipelined ? "pipelined" : "first request"})`,
      async () => {
        const fixture = /* js */ `
        const http = require("node:http");
        const net = require("node:net");
        const pipelined = process.env.PIPELINED === "1";
        let client;
        process.on("uncaughtException", err => {
          console.log("uncaught:", err.message);
          client.write("ping");
        });
        let first;
        const server = http.createServer((req, res) => {
          if (req.method === "CONNECT") {
            console.log("the CONNECT was dispatched as a request");
            process.exit(0);
          }
          first = res;
          res.writeHead(200, { "Content-Length": 10 });
          res.write("first");
        });
        server.on("connect", (req, socket) => {
          socket.on("data", chunk => {
            first?.end("-done");
            socket.end("echo:" + chunk);
          });
          throw new Error("listener threw");
        });
        server.listen(0, "127.0.0.1", () => {
          client = net.connect(server.address().port, "127.0.0.1");
          let received = "";
          client.on("data", chunk => (received += chunk));
          client.on("close", () => {
            console.log(JSON.stringify({ first: received.includes("first-done"), echo: received.includes("echo:ping") }));
            process.exit(0);
          });
          client.write(
            (pipelined ? "GET /first HTTP/1.1\\r\\nHost: example.com\\r\\n\\r\\n" : "") +
              "CONNECT example.com:443 HTTP/1.1\\r\\nHost: example.com:443\\r\\n\\r\\n",
          );
        });
      `;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", fixture],
          env: { ...bunEnv, PIPELINED: pipelined ? "1" : "0" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: `uncaught: listener threw\n${JSON.stringify({ first: pipelined, echo: true })}\n`,
          stderr: "",
          exitCode: 0,
        });
      },
    );
  }

  test.concurrent("should not let the end of the tunnel release the response ahead of it", async () => {
    // Not Node's result: there only the socket keeps this process alive, and it stops when the
    // tunnel ends. Here a pending response keeps the process alive, and after server.unref()
    // nothing else does, so the process must stay until the response ahead is complete.
    const fixture = /* js */ `
      const http = require("node:http");
      let first;
      const server = http.createServer((req, res) => {
        console.log("request " + req.method + " " + req.url);
        if (req.url === "/first") {
          server.unref();
          return void (first = res);
        }
        first.end("first");
        res.end("released");
      });
      server.on("connect", (req, socket) => {
        socket.on("end", () => {
          console.log("tunnel end");
          // An unref'd timer runs only while something else keeps the process alive.
          setTimeout(() => console.log("still alive"), 50).unref();
        });
        socket.resume();
      });
      server.listen(0, "127.0.0.1", () => console.log("port " + server.address().port));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    // The first `count` lines of the server's output, as soon as it has printed them.
    async function lines(count: number) {
      while (stdout.split("\n").length <= count) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`the server exited after ${JSON.stringify(stdout)}`);
        stdout += decoder.decode(value, { stream: true });
      }
      return stdout.split("\n").slice(0, count);
    }

    const port = Number((await lines(1))[0].slice("port ".length));
    const client = net.connect(port, "127.0.0.1");
    try {
      const { promise: gotFirst, resolve: onFirst, reject: onFailure } = Promise.withResolvers<void>();
      // Awaited last. An earlier failure must not leave its rejection unhandled.
      gotFirst.catch(() => {});
      let received = "";
      client.on("data", chunk => {
        received += chunk;
        if (received.endsWith("first")) onFirst();
      });
      client.on("error", onFailure);
      client.on("close", () => onFailure(new Error(`closed after ${JSON.stringify(received)}`)));
      client.write(get("/first") + CONNECT);
      client.end();
      expect((await lines(4)).slice(1)).toEqual(["request GET /first", "tunnel end", "still alive"]);

      const released = await fetch(`http://127.0.0.1:${port}/release`);
      expect(await released.text()).toBe("released");
      await gotFirst;
    } finally {
      client.destroy();
    }
  });

  test("should write what the 'connect' listener writes at once after the response ahead", async () => {
    // The listener answers synchronously and keeps the tunnel open. Its bytes wait for the
    // response ahead, which ends later, and are not cut into it.
    let first: http.ServerResponse | undefined;
    const { promise: handedOff, resolve: onHandoff, reject: onFailure } = Promise.withResolvers<void>();
    await using server = http.createServer((req, res) => {
      if (req.method === "CONNECT") return void onFailure(new Error("dispatched as a request"));
      first = res;
      res.write("first");
    });
    server.on("clientError", onFailure);
    server.on("connect", (req, socket) => {
      socket.write(ESTABLISHED);
      socket.on("data", chunk => socket.write(`echo:${chunk}`));
      onHandoff();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const client = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    try {
      let received = "";
      const { promise: gotEstablished, resolve: onEstablished } = Promise.withResolvers<void>();
      const { promise: gotEcho, resolve: onEcho } = Promise.withResolvers<void>();
      client.setEncoding("latin1");
      client.on("data", chunk => {
        received += chunk;
        if (received.endsWith(ESTABLISHED)) onEstablished();
        if (received.endsWith("echo:ping")) onEcho();
      });
      client.on("error", onFailure);
      client.write(get("/first") + CONNECT);
      await handedOff;
      first!.end("-done");
      await gotEstablished;
      expect(withoutResponseHeads(received)).toBe(`5\r\nfirst\r\n5\r\n-done\r\n0\r\n\r\n${ESTABLISHED}`);
      client.write("ping");
      await gotEcho;
    } finally {
      client.destroy();
    }
  });

  test("should close the connection when the server has no 'connect' listener", async () => {
    const events: string[] = [];
    let first: http.ServerResponse | undefined;
    const { promise: firstClosed, resolve: onFirstClosed } = Promise.withResolvers<boolean>();
    await using server = http.createServer((req, res) => {
      events.push(`request ${req.method} ${req.url}`);
      if (req.method === "CONNECT") {
        res.end("not a tunnel");
        first!.end();
        return;
      }
      first = res.on("close", () => onFirstClosed(res.writableFinished));
    });
    await once(server.listen(0, "127.0.0.1"), "listening");

    const client = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    let received = "";
    const { promise: clientClosed, resolve: onClientClosed } = Promise.withResolvers<void>();
    client.on("error", () => {});
    client.on("close", () => onClientClosed());
    // Node sends nothing. A client that gets an answer has seen enough.
    client.on("data", chunk => {
      received += chunk;
      client.destroy();
    });
    client.write(get("/first") + CONNECT);
    await clientClosed;
    expect({ events, received, firstFinished: await firstClosed }).toEqual({
      events: ["request GET /first"],
      received: "",
      firstFinished: false,
    });
  });
});

/**
 * Test variations using normal HTTP requests and res.socket
 * These tests should run in both Node.js and Bun
 */

describe("HTTP server socket access via normal requests", () => {
  test("should handle socket errors during normal requests", async () => {
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
  // https://github.com/oven-sh/bun/issues/34158
  test("server.close(cb) completes after a CONNECT handoff once both sockets are destroyed", async () => {
    const server = http.createServer();
    let serverSocket: net.Socket;
    server.on("connect", (req, socket) => {
      serverSocket = socket;
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = (server.address() as AddressInfo)!;

    const request = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: "example.com:80" });
    request.on("error", () => {});
    request.end();
    const [, clientSocket] = (await once(request, "connect")) as [unknown, net.Socket];

    clientSocket.destroy();
    serverSocket!.destroy();
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.close(() => onClosed());
    await closed;
  });

  test("tests should run on node.js", async () => {
    const process = Bun.spawn({
      cmd: [nodeExe(), "--test", join(import.meta.dir, "node-http-connect.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  });
  test("tests should run on bun", async () => {
    const process = Bun.spawn({
      cmd: [bunExe(), "test", join(import.meta.dir, "node-http-connect.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  });
});

// Windows: after FIN on a CONNECT-tunnel socket, AFD's level-triggered
// UV_DISCONNECT used to re-derive EOF and bounce the poll between 0 and
// WRITABLE forever (pins the poll_cb allow_half_open arm).
test("CONNECT: process exits after the tunnel socket is re-emitted as a connection and the server closes", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const http = require("node:http");
       let endCount = 0;
       const server = http.createServer(() => { throw new Error("request listener should not run"); });
       server.on("connect", (req, socket) => {
         socket.on("end", () => endCount++);
         socket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
         server.emit("connection", socket);
         server.close();
       });
       server.listen(0, () => {
         http.request({ port: server.address().port, method: "CONNECT" }).end();
       });
       process.on("exit", () => {
         if (endCount !== 1) throw new Error("end fired " + endCount + " times (expected 1)");
         console.log("ok");
       });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "ok\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});
