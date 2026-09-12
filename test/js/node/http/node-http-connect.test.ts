import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  bunRun,
  isLinux,
  isWindows,
  nodeExe,
  normalizeBunSnapshot,
  tempDir,
  tls as tlsCert,
} from "harness";
import http from "http";

import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { join } from "node:path";

const ESTABLISHED = "HTTP/1.1 200 Connection established\r\n\r\n";
// What the server answers on its own (no 'clientError' listener) to a request its parser rejects.
const BAD_REQUEST = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n";

// Writes one raw request and resolves with everything the server sent plus the
// client-side events seen before the connection closed.
function rawRequest(address: AddressInfo, request: string) {
  const { promise, resolve } = Promise.withResolvers<{ response: string; events: string[] }>();
  const client = net.connect(address.port, address.address, () => client.write(request));
  const received: Buffer[] = [];
  const events: string[] = [];
  client.on("data", chunk => received.push(chunk));
  client.on("end", () => events.push("end"));
  client.on("error", (err: NodeJS.ErrnoException) => events.push(`error:${err.code}`));
  client.on("close", () => resolve({ response: Buffer.concat(received).toString(), events }));
  return promise;
}

describe.concurrent("HTTP server CONNECT", () => {
  test("should handle backpressure", async () => {
    // Several times what loopback takes in one write: the target's end() has to
    // wait for its buffered bytes and the proxy pipes across many reads.
    const payload = Buffer.alloc(8 * 1024 * 1024, "bun");
    const responseHeader = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
    const proxyResponse = "HTTP/1.1 200 Connection established\r\nConnection: close\r\n\r\n";
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });
    await using targetServer = net.createServer(socket => {
      // Accepted net sockets start in Node's flowing=null state; drain the
      // inbound GET so 'end' can fire and server.close() can resolve.
      socket.resume();
      socket.write(responseHeader);
      socket.end(payload);
    });
    let connectRequest: { method?: string; url?: string; proxyAuthorization?: string; head?: Buffer } = {};
    proxyServer.on("connect", (req, socket, head) => {
      connectRequest = {
        method: req.method,
        url: req.url,
        proxyAuthorization: req.headers["proxy-authorization"],
        head,
      };
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, async () => {
        socket.write(proxyResponse);
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

    const target = `${targetAddress.address}:${targetAddress.port}`;
    const client = net.connect({ port: proxyAddress.port, host: proxyAddress.address }, () => {
      client.write(
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: Basic dXNlcjpwYXNzd29yZA==\r\n\r\n`,
      );
    });
    const received: Buffer[] = [];
    const { promise: response, resolve, reject } = Promise.withResolvers<Buffer>();
    let sentRequest = false;
    client.on("data", data => {
      received.push(data);
      if (!sentRequest && Buffer.concat(received).includes(proxyResponse)) {
        sentRequest = true;
        client.write("GET / HTTP/1.1\r\nHost: www.example.com:80\r\nConnection: close\r\n\r\n");
      }
    });
    client.on("error", reject);
    client.on("end", () => resolve(Buffer.concat(received)));

    const expected = Buffer.concat([Buffer.from(proxyResponse), Buffer.from(responseHeader), payload]);
    const tunneled = await response;
    // Compared by hand: a failed toEqual on 8 MiB buffers prints megabytes of diff.
    expect({
      connectRequest,
      response: { length: tunneled.length, equalsExpected: tunneled.equals(expected) },
    }).toEqual({
      connectRequest: {
        method: "CONNECT",
        url: target,
        proxyAuthorization: "Basic dXNlcjpwYXNzd29yZA==",
        head: Buffer.alloc(0),
      },
      response: { length: expected.length, equalsExpected: true },
    });
  });

  // The 'connect' handler writes 1 MiB chunks until write() returns false, ends
  // the socket from the 'drain' listener and reports what both ends saw.
  // `drainListener` picks whether every 'drain' is recorded or only the first.
  async function writeUntilDrain(drainListener: "on" | "once") {
    // One write of this size is not enough to back up loopback, so the loop
    // below runs a few times before write() returns false.
    const chunk = Buffer.alloc(1024 * 1024, "bun");
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;
    const proxyReceived: Buffer[] = [];
    const clientReceived: Buffer[] = [];
    const proxyEvents: string[] = [];
    let connectRequest: { url?: string; head?: Buffer } = {};
    let writes = 0;

    const { promise: proxyClosed, resolve: resolveProxyClosed, reject: rejectProxy } = Promise.withResolvers<void>();
    const { promise: clientEnded, resolve: resolveClientEnded, reject: rejectClient } = Promise.withResolvers<void>();
    const clientSocket = net.connect(proxyAddress.port, proxyAddress.address, () => {
      clientSocket.write("CONNECT localhost:80 HTTP/1.1\r\nHost: localhost:80\r\nConnection: close\r\n\r\n");
    });
    clientSocket.on("error", rejectClient);
    clientSocket.on("data", data => clientReceived.push(data));
    clientSocket.on("end", () => {
      clientSocket.end();
      resolveClientEnded();
    });

    proxyServer.on("connect", (req, socket, head) => {
      connectRequest = { url: req.url, head };
      socket.on("data", data => proxyReceived.push(data));
      socket.on("end", () => proxyEvents.push("end"));
      socket.on("close", () => {
        proxyEvents.push("close");
        resolveProxyClosed();
      });
      socket[drainListener]("drain", () => {
        proxyEvents.push("drain");
        socket.end();
      });
      socket.on("error", rejectProxy);
      // write until backpressure
      do {
        writes++;
      } while (socket.write(chunk));
      clientSocket.write("Hello World");
    });

    await Promise.all([proxyClosed, clientEnded]);
    const expected = Buffer.concat(Array.from({ length: writes }, () => chunk));
    const received = Buffer.concat(clientReceived);
    return {
      connectRequest,
      proxyReceived: Buffer.concat(proxyReceived).toString(),
      proxyEvents,
      clientReceived: { length: received.length, equalsExpected: received.equals(expected) },
      expectedLength: expected.length,
    };
  }

  test("should handle data, drain, end and close events", async () => {
    const { expectedLength, ...result } = await writeUntilDrain("once");
    expect(result).toEqual({
      connectRequest: { url: "localhost:80", head: Buffer.alloc(0) },
      proxyReceived: "Hello World",
      proxyEvents: ["drain", "end", "close"],
      clientReceived: { length: expectedLength, equalsExpected: true },
    });
  });

  // Node emits one 'drain' per write() that returned false. The socket handed to
  // 'connect' emits it twice: NodeHTTPServerSocket.#onDrain in
  // src/js/node/_http_server.ts runs the pending write callback, whose afterWrite
  // already emitted 'drain', then emits 'drain' again. This test starts to fail
  // once that second emit is gone: drop the `.failing` and the test above's `once`.
  test.failing("should emit 'drain' once per write() that returned false, like Node", async () => {
    const { proxyEvents } = await writeUntilDrain("on");
    expect(proxyEvents).toEqual(["drain", "end", "close"]);
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

    // A loopback port nothing listens on, so the upstream connect is refused
    // without DNS. The established connection keeps the port bound, so no
    // concurrent listen(0) can take it while the test runs.
    await using sink = net.createServer();
    await once(sink.listen(0, "127.0.0.1"), "listening");
    const holder = net.connect((sink.address() as AddressInfo).port, "127.0.0.1");
    await once(holder, "connect");
    const target = `127.0.0.1:${holder.localPort}`;

    const result = await rawRequest(proxyAddress, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    holder.destroy();
    expect(result).toEqual({ response: "HTTP/1.1 502 Bad Gateway\r\n\r\n", events: ["end"] });
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

  // Bytes that arrive with or after a CONNECT request belong to the tunnel: they
  // reach the 'connect' socket verbatim (as `head` or 'data') and never start a
  // new request. Node v26.3.0 behaves the same for every framing below.
  const tunneledFramings = [
    {
      name: "Content-Length: 0",
      headers: "Content-Length: 0",
      pipelined: "GET /pipelined HTTP/1.1\r\nHost: example.com\r\n\r\n",
    },
    {
      // The chunked framing bytes reach the connect socket un-decoded.
      name: "Transfer-Encoding: chunked (raw, not chunk-decoded)",
      headers: "Transfer-Encoding: chunked",
      pipelined: "5\r\nhello\r\n0\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: example.com\r\n\r\n",
    },
    {
      // The declared body and everything after it reach the connect socket.
      name: "a nonzero Content-Length",
      headers: "Content-Length: 5",
      pipelined: "helloGET /smuggled HTTP/1.1\r\nHost: example.com\r\n\r\n",
    },
  ];
  test.each(tunneledFramings)(
    "should deliver bytes following a CONNECT request with $name to the connect socket, not as a new request",
    async ({ headers, pipelined }) => {
      const requestUrls: string[] = [];
      await using proxyServer = http.createServer((req, res) => {
        requestUrls.push(req.url ?? "");
        res.end();
      });

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
        socket.write(ESTABLISHED);
      });

      await once(proxyServer.listen(0, "127.0.0.1"), "listening");
      const proxyAddress = proxyServer.address() as AddressInfo;

      const { promise: clientReceived, resolve: resolveClient, reject: rejectClient } = Promise.withResolvers<string>();
      const received: string[] = [];
      const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
        client.write(`CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n${headers}\r\n\r\n${pipelined}`);
      });
      client.on("data", data => {
        received.push(data.toString());
        if (received.join("") === ESTABLISHED) {
          client.write(afterEstablished);
        }
      });
      client.on("error", rejectClient);
      client.on("end", () => {
        client.end();
        resolveClient(received.join(""));
      });

      expect({ tunneled: await tunneled, clientReceived: await clientReceived, requestUrls }).toEqual({
        tunneled: expectedTunneled,
        clientReceived: ESTABLISHED,
        requestUrls: [],
      });
    },
  );

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

    const result = await rawRequest(
      proxyAddress,
      "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n",
    );
    expect({ ...result, connectEvents, requestUrls }).toEqual({
      response: BAD_REQUEST,
      events: ["end"],
      connectEvents: 0,
      requestUrls: [],
    });
  });

  test("should handle malformed CONNECT requests", async () => {
    await using proxyServer = http.createServer();

    const connectUrls: string[] = [];
    proxyServer.on("connect", (req, socket, head) => {
      connectUrls.push(req.url ?? "");
      socket.write(ESTABLISHED);
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

    const results = await Promise.all(
      [...acceptedRequests, ...malformedRequests].map(async request => ({
        request,
        ...(await rawRequest(proxyAddress, request)),
      })),
    );
    // A rejected request gets the server's 400 and the connection is closed; an
    // accepted one reaches the handler above.
    expect({ results, connectUrls: connectUrls.sort() }).toEqual({
      results: [
        ...acceptedRequests.map(request => ({ request, response: ESTABLISHED, events: ["end"] })),
        ...malformedRequests.map(request => ({ request, response: BAD_REQUEST, events: ["end"] })),
      ],
      connectUrls: [":80", "example.com"],
    });
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

/**
 * Test variations using normal HTTP requests and res.socket
 * These tests should run in both Node.js and Bun
 */

describe.concurrent("HTTP server socket access via normal requests", () => {
  test("should handle socket errors during normal requests", async () => {
    const { promise: serverError, resolve: resolveServerError } = Promise.withResolvers<Error>();

    await using server = http.createServer((req, res) => {
      const socket = res.socket!;
      socket.on("error", resolveServerError);
      socket.destroy(new Error("Simulated error"));
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const result = await rawRequest(serverAddress, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    expect({ ...result, serverError: (await serverError).message }).toEqual({
      response: "",
      events: ["end"],
      serverError: "Simulated error",
    });
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

describe.concurrent("Should be compatible with node.js", () => {
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
    const [response, clientSocket] = (await once(request, "connect")) as [http.IncomingMessage, net.Socket];
    expect(response.statusCode).toBe(200);

    clientSocket.destroy();
    serverSocket!.destroy();
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.close(() => onClosed());
    await closed;
  });

  const nodeSuite = join(import.meta.dir, "node-http-connect.node.mts");
  test("tests should run on node.js", async () => {
    await using proc = Bun.spawn({
      cmd: [nodeExe()!, "--test", "--test-reporter=tap", nodeSuite],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // TAP: one "ok N - name" line per test and per suite, then "# key value" totals.
    // A failure's message and stack are YAML lines on stdout, so keep the whole
    // output in the diff when the run did not pass.
    const lines = stdout.split("\n").map(line => line.trim());
    expect({
      results: lines.filter(line => /^(not )?ok \d+ - /.test(line)),
      totals: Object.fromEntries(
        lines.filter(line => /^# (?!duration_ms )\w+ \d+$/.test(line)).map(line => line.slice(2).split(" ")),
      ),
      stderr,
      exitCode,
      ...(exitCode !== 0 && { stdout }),
    }).toEqual({
      results: [
        "ok 1 - should work with proxy package",
        "ok 2 - should work with raw sockets",
        "ok 3 - should handle multiple concurrent CONNECT requests",
        "ok 4 - should handle CONNECT with invalid target",
        "ok 5 - should handle CONNECT with authentication failure",
        "ok 6 - should handle partial writes and buffering",
        "ok 7 - should handle keep-alive connections",
        "ok 1 - HTTP server CONNECT",
      ],
      totals: { tests: "7", suites: "1", pass: "7", fail: "0", cancelled: "0", skipped: "0", todo: "0" },
      stderr: "",
      exitCode: 0,
    });
  });
  // A whole `bun test` run of the shared suite takes about 5s in a debug build,
  // so this one test does not fit the default timeout. A per-test value also
  // replaces the CI --timeout, so it is generous.
  test("tests should run on bun", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", nodeSuite],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "node-http-connect.node.mts:
        (pass) HTTP server CONNECT > should work with proxy package
        (pass) HTTP server CONNECT > should work with raw sockets
        (pass) HTTP server CONNECT > should handle multiple concurrent CONNECT requests
        (pass) HTTP server CONNECT > should handle CONNECT with invalid target
        (pass) HTTP server CONNECT > should handle CONNECT with authentication failure
        (pass) HTTP server CONNECT > should handle partial writes and buffering
        (pass) HTTP server CONNECT > should handle keep-alive connections

         7 pass
         0 fail
        Ran 7 tests across 1 file."
      `);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun test <version> (<revision>)"`);
    expect(exitCode).toBe(0);
  }, 60_000);
});

// Windows: after FIN on a CONNECT-tunnel socket, AFD's level-triggered
// UV_DISCONNECT used to re-derive EOF and bounce the poll between 0 and
// WRITABLE forever (pins the poll_cb allow_half_open arm).
test.concurrent(
  "CONNECT: process exits after the tunnel socket is re-emitted as a connection and the server closes",
  async () => {
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
  },
);
