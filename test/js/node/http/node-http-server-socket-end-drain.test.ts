import { socketFaultInjection as fault, setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import { once } from "node:events";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

// res.socket.end() half-closes the connection; the server must still release the
// socket (drain the unconsumed body on epoll, or take kqueue's EVFILT_WRITE
// EV_EOF from its own SHUT_WR) so server.close() resolves. On macOS that early
// close can RST the still-writing client, so the client's EPIPE is expected and
// the close wait must not be once(c, "close"), which would reject on it.
test("server.close() completes after res.socket.end() with a 2 MB upload in flight", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { once } from "node:events";
        import http from "node:http";
        import net from "node:net";
        let sock;
        const handled = Promise.withResolvers();
        const server = http.createServer((req, res) => {
          res.writeHead(200, { Connection: "close" });
          sock = res.socket;
          res.socket.end();
          try { res.write("x"); } catch {}
          handled.resolve();
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        const port = server.address().port;
        const c = net.connect(port, "127.0.0.1");
        await once(c, "connect");
        const body = Buffer.alloc(2 * 1024 * 1024, 0x61);
        c.on("error", () => {});
        c.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: " + body.length + "\\r\\nConnection: close\\r\\n\\r\\n");
        c.write(body);
        c.on("end", () => c.end());
        // Not once(c, "close"): that also registers an 'error' rejector, and on
        // macOS the 2 MB upload can hit EPIPE once the server's SHUT_WR +
        // resume drains the body. The write error is expected (and swallowed
        // above); rejecting socketClosed on it turned it into an uncaught
        // top-level rejection instead of exercising the drain/close path.
        const socketClosed = new Promise(r => c.once("close", r));
        await handled.promise;
        const serverClosed = new Promise(r => server.close(() => r()));
        const watchdog = setTimeout(() => {
          process.stdout.write("timeout destroyed=" + (sock?.destroyed ?? "none") + "\\n");
          process.exit(1);
        }, 10000);
        await Promise.all([socketClosed, serverClosed]);
        clearTimeout(watchdog);
        process.stdout.write("closed destroyed=" + sock.destroyed + "\\n");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "closed destroyed=true\n", stderr: "", exitCode: 0 });
});

const GET = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";

// What the tests need to make socket.end() run while the transport still holds response bytes. The send buffer of
// the server and the receive buffer of the client are capped and the client does not read, so most of a response
// of 1 MiB stays in the server.
function heldResponse(protocol: "http" | "https") {
  const SIZE = 1024 * 1024;
  const KERNEL_BUFFER = 64 * 1024;
  const createServer = (
    onRequest: (req: IncomingMessage, res: ServerResponse) => void,
    options: http.ServerOptions = {},
  ) =>
    protocol === "https"
      ? https.createServer({ ...tlsCert, ...options }, onRequest)
      : http.createServer(options, onRequest);
  const capSendBuffer = (socket: net.Socket | null) => setSocketOptions(socket, 1, KERNEL_BUFFER);
  // Eight writes behind a Content-Length: the client counts SIZE body bytes whether or not the response ends.
  const writeBody = (res: ServerResponse) => {
    capSendBuffer(res.socket);
    res.writeHead(200, { "Content-Length": SIZE });
    const chunk = Buffer.alloc(SIZE / 8, "r");
    for (let i = 0; i < 8; i++) res.write(chunk);
  };
  // Runs `end` in a later tick. Resolves with what the transport holds when `end` runs: in the tick of a write,
  // writableLength also counts the bytes that the transport took.
  const endLater = (res: ServerResponse, end: () => void) =>
    new Promise<number>(resolve =>
      setImmediate(() => {
        const held = res.writableLength;
        end();
        resolve(held);
      }),
    );
  // The server side of the connection: whether it is open, and when it closes.
  function watchServerSocket() {
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    const watched = {
      open: true,
      closed,
      watch(socket: net.Socket) {
        socket.on("error", () => {});
        socket.on("close", () => {
          watched.open = false;
          resolve();
        });
      },
    };
    return watched;
  }
  // A client that keeps its side open when the server ends, and that reads nothing until resume().
  async function connect(server: http.Server, listenPath?: string) {
    await once(listenPath ? server.listen(listenPath) : server.listen(0, "127.0.0.1"), "listening");
    const to = listenPath
      ? { path: listenPath, allowHalfOpen: true }
      : { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true };
    const client = protocol === "https" ? tls.connect({ ...to, rejectUnauthorized: false }) : net.connect(to);
    await once(client, protocol === "https" ? "secureConnect" : "connect");
    setSocketOptions(client, 2, KERNEL_BUFFER);
    client.pause();
    let received = 0;
    let head = Buffer.alloc(0);
    const body = () => received - (head.indexOf("\r\n\r\n") + 4);
    const { promise: wholeBody, resolve: onWholeBody } = Promise.withResolvers<void>();
    client.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (!head.includes("\r\n\r\n")) head = Buffer.concat([head, chunk]);
      if (head.includes("\r\n\r\n") && body() >= SIZE) onWholeBody();
    });
    // How the response ends for the client.
    const outcome = new Promise<string>(resolve => {
      client.on("end", () => resolve("end"));
      client.on("error", (err: NodeJS.ErrnoException) => resolve(`error ${err.code}`));
      client.on("close", () => resolve("close with no end"));
    });
    return { client, outcome, wholeBody, body };
  }
  // The client read the whole response and then the FIN, end() found bytes in the transport, and the server socket
  // was still open when the FIN arrived.
  const finAfterBytes = { outcome: "end", body: SIZE, held: true, serverSocketOpen: true };
  return { SIZE, createServer, capSendBuffer, writeBody, endLater, watchServerSocket, connect, finAfterBytes };
}

// In Node the response and the raw socket share one net.Socket Writable, so the
// FIN of socket.end() / destroySoon() follows every byte the response wrote.
describe.each(["http", "https"] as const)("%s: the raw socket's FIN follows the bytes the response wrote", protocol => {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  const cases: [string, Handler, string][] = [
    [
      "res.write() then req.socket.destroySoon()",
      (req, res) => {
        res.write("PART1");
        req.socket.destroySoon();
      },
      "5\r\nPART1\r\n",
    ],
    [
      "res.write() then res.socket.end()",
      (req, res) => {
        res.write("PART1");
        res.socket!.end();
      },
      "5\r\nPART1\r\n",
    ],
    [
      "res.write() then res.socket.end() from a microtask",
      (req, res) => {
        res.write("PART1");
        queueMicrotask(() => res.socket!.end());
      },
      "5\r\nPART1\r\n",
    ],
    [
      "res.flushHeaders() then res.socket.end()",
      (req, res) => {
        res.flushHeaders();
        res.socket!.end();
      },
      "",
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, respond, body) => {
    const onRequest: Handler = (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      respond(req, res);
    };
    await using server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as net.AddressInfo;

    const client =
      protocol === "https"
        ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
        : net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    client.on("data", (chunk: Buffer) => chunks.push(chunk));
    // The server can close before the client's own FIN lands; only the bytes matter here.
    client.on("error", () => {});
    const closed = new Promise(resolve => client.once("close", resolve));
    client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await closed;

    const received = Buffer.concat(chunks).toString("latin1");
    const headEnd = received.indexOf("\r\n\r\n");
    expect({
      statusLine: received.slice(0, received.indexOf("\r\n")),
      body: headEnd === -1 ? null : received.slice(headEnd + 4),
    }).toEqual({ statusLine: "HTTP/1.1 200 OK", body });
  });

  // socket.end() runs while the transport still holds response bytes (heldResponse). The FIN follows those bytes,
  // whether or not the response ends, and no close follows the FIN. Every expectation is Node v26.3.0's. Each
  // end() comes from a later tick: Node v26.9 and later send the FIN of an end() in the tick of the write before
  // the bytes.
  describe("socket.end() while the transport still holds bytes", () => {
    const { SIZE, createServer, capSendBuffer, writeBody, endLater, watchServerSocket, connect, finAfterBytes } =
      heldResponse(protocol);

    // What the response does at the 'drain' that follows its bytes. Node emits no 'drain' behind socket.end(), so
    // there the response never ends in all three cases.
    const atDrain: [string, (res: ServerResponse) => void][] = [
      ["never ends", () => {}],
      ["ends at 'drain'", res => void res.once("drain", () => res.end())],
      ["writes again at each 'drain'", res => void res.on("drain", () => res.write("more"))],
    ];
    test.concurrent.each(atDrain)(
      "the FIN follows a response that %s, and no close follows the FIN",
      async (_name, onDrain) => {
        const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
        const serverSocket = watchServerSocket();
        await using server = createServer((req, res) => {
          serverSocket.watch(req.socket);
          res.on("error", () => {});
          writeBody(res);
          endLater(res, () => {
            res.socket!.end();
            // Not before: Bun also emits a 'drain' one tick after writes that reached the high water mark.
            onDrain(res);
          }).then(onEnd);
        });
        const { client, outcome, body } = await connect(server);
        try {
          client.write(GET);
          const held = await ended;
          client.resume();
          expect({
            outcome: await outcome,
            body: body(),
            held: held > 0,
            serverSocketOpen: serverSocket.open,
          }).toEqual(finAfterBytes);
          // The FIN of the client closes the socket.
          client.end();
          await serverSocket.closed;
        } finally {
          client.destroy();
        }
      },
    );

    // The reply goes out on the raw socket, and the response never ends. Two writes: a transport that takes one
    // write whole can still refuse the next one.
    test.concurrent.each(["req.socket.end(data)", "req.socket.write(data), then req.socket.end()"])(
      "the FIN follows the bytes of %s",
      async form => {
        const head = Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${SIZE}\r\n\r\n`);
        const half = Buffer.alloc(SIZE / 2, "r");
        const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
        const serverSocket = watchServerSocket();
        await using server = createServer((req, res) => {
          serverSocket.watch(req.socket);
          capSendBuffer(req.socket);
          req.socket.write(Buffer.concat([head, half]));
          if (form === "req.socket.end(data)") {
            req.socket.end(half);
            setImmediate(() => onEnd(res.writableLength));
          } else {
            req.socket.write(half);
            endLater(res, () => req.socket.end()).then(onEnd);
          }
        });
        const { client, outcome, body } = await connect(server);
        try {
          client.write(GET);
          const held = await ended;
          client.resume();
          expect({
            outcome: await outcome,
            body: body(),
            held: held > 0,
            serverSocketOpen: serverSocket.open,
          }).toEqual(finAfterBytes);
          client.end();
          await serverSocket.closed;
        } finally {
          client.destroy();
        }
      },
    );

    // uWS reads nothing behind a FIN, so the FIN waits for the request body of a response that has not ended. Node
    // sends the FIN first and reads the body behind it. Either way the whole body arrives, the request behind it
    // gets no response, and the FIN comes.
    test.concurrent("the rest of the request body arrives, and then the FIN comes", async () => {
      const BODY = Buffer.alloc(64 * 1024, "b");
      const seen = { bytes: 0, ended: false };
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      const { promise: requestEnded, resolve: onRequestEnd } = Promise.withResolvers<void>();
      const serverSocket = watchServerSocket();
      let first = true;
      await using server = createServer((req, res) => {
        res.on("error", () => {});
        if (!first) {
          // Node runs the listener for the pipelined request too. Its socket is no longer writable.
          res.end("second");
          return;
        }
        first = false;
        serverSocket.watch(req.socket);
        req.on("data", (chunk: Buffer) => (seen.bytes += chunk.length));
        req.on("end", () => {
          seen.ended = true;
          onRequestEnd();
        });
        writeBody(res);
        endLater(res, () => req.socket.end()).then(onEnd);
      });
      const { client, outcome, wholeBody, body } = await connect(server);
      try {
        client.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${BODY.length}\r\n\r\n`);
        client.write(BODY.subarray(0, BODY.length / 2));
        const held = await ended;
        client.resume();
        // The response has left the server when the rest of the body arrives, so no writable event is left to
        // send the FIN.
        await wholeBody;
        client.write(Buffer.concat([BODY.subarray(BODY.length / 2), Buffer.from(GET)]));
        expect({
          outcome: await outcome,
          body: body(),
          held: held > 0,
          serverSocketOpen: serverSocket.open,
        }).toEqual(finAfterBytes);
        await requestEnded;
        expect(seen).toEqual({ bytes: BODY.length, ended: true });
        client.end();
        await serverSocket.closed;
      } finally {
        client.destroy();
      }
    });

    // Nothing reads the request body when end() runs, so its buffer is full and the reads of the connection are
    // stopped. A reader that attaches later still gets the whole body, and then the FIN comes.
    test.concurrent("a reader that attaches after end() gets the whole request body", async () => {
      const BODY = Buffer.alloc(2 * 1024 * 1024, "b");
      const { promise: request, resolve: onRequest } = Promise.withResolvers<IncomingMessage>();
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      const serverSocket = watchServerSocket();
      await using server = createServer((req, res) => {
        serverSocket.watch(req.socket);
        req.on("error", () => {});
        res.on("error", () => {});
        writeBody(res);
        endLater(res, () => req.socket.end()).then(onEnd);
        onRequest(req);
      });
      const { client, outcome, wholeBody, body } = await connect(server);
      try {
        client.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${BODY.length}\r\n\r\n`);
        client.write(BODY);
        const held = await ended;
        client.resume();
        await wholeBody;
        const req = await request;
        let uploaded = 0;
        req.on("data", (chunk: Buffer) => (uploaded += chunk.length));
        await once(req, "end");
        expect(uploaded).toBe(BODY.length);
        expect({
          outcome: await outcome,
          body: body(),
          held: held > 0,
          serverSocketOpen: serverSocket.open,
        }).toEqual(finAfterBytes);
        client.end();
        await serverSocket.closed;
      } finally {
        client.destroy();
      }
    });

    // The lenient parser reads a body with no framing up to the FIN of the client. The FIN of the server waits
    // for that one too, and the peer's FIN then ends the connection.
    test.concurrent("the rest of a request body that ends at the FIN of the client arrives", async () => {
      const seen = { bytes: 0, ended: false };
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      const { promise: requestEnded, resolve: onRequestEnd } = Promise.withResolvers<void>();
      await using server = createServer(
        (req, res) => {
          req.socket.on("error", () => {});
          res.on("error", () => {});
          req.on("data", (chunk: Buffer) => (seen.bytes += chunk.length));
          req.on("end", () => {
            seen.ended = true;
            onRequestEnd();
          });
          writeBody(res);
          endLater(res, () => req.socket.end()).then(onEnd);
        },
        { insecureHTTPParser: true },
      );
      const { client, outcome, wholeBody, body } = await connect(server);
      try {
        client.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: gzip\r\n\r\n");
        client.write(Buffer.alloc(1024, "b"));
        const held = await ended;
        client.resume();
        await wholeBody;
        client.end(Buffer.alloc(1024, "b"));
        expect({ outcome: await outcome, body: body(), held: held > 0 }).toEqual({
          outcome: "end",
          body: SIZE,
          held: true,
        });
        await requestEnded;
        expect(seen).toEqual({ bytes: 2048, ended: true });
      } finally {
        client.destroy();
        server.closeAllConnections();
      }
    });

    // The response ends while the rest of the request body is still to come, after its bytes have left.
    test.concurrent.each(["from a later tick", "in a 'data' listener of the request"])(
      "the FIN comes when the response ends %s, before the rest of the request body",
      async when => {
        const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
        const { promise: response, resolve: onResponse } = Promise.withResolvers<ServerResponse>();
        const serverSocket = watchServerSocket();
        let endInDataListener = false;
        await using server = createServer((req, res) => {
          serverSocket.watch(req.socket);
          req.on("error", () => {});
          res.on("error", () => {});
          req.on("data", () => {
            if (endInDataListener) res.end();
          });
          writeBody(res);
          endLater(res, () => req.socket.end()).then(onEnd);
          onResponse(res);
        });
        const { client, outcome, wholeBody, body } = await connect(server);
        try {
          client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 65536\r\n\r\n");
          client.write(Buffer.alloc(1024, "b"));
          const held = await ended;
          client.resume();
          await wholeBody;
          if (when === "from a later tick") {
            (await response).end();
          } else {
            endInDataListener = true;
            client.write(Buffer.alloc(1024, "b"));
          }
          expect({
            outcome: await outcome,
            body: body(),
            held: held > 0,
            serverSocketOpen: serverSocket.open,
          }).toEqual(finAfterBytes);
        } finally {
          client.destroy();
          server.closeAllConnections();
        }
      },
    );

    // The client has ended its side before the bytes are out. With httpAllowHalfOpen the response in flight keeps
    // the connection, so only socket.end() ends it: the FIN follows the bytes. Then both sides have ended, so the
    // socket closes.
    test.concurrent.each(["with its request", "after socket.end() ran"])(
      "httpAllowHalfOpen: the FIN follows a response that never ends when the client ended %s, and the socket closes",
      async when => {
        const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
        const serverSocket = watchServerSocket();
        await using server = createServer((req, res) => {
          serverSocket.watch(req.socket);
          res.on("error", () => {});
          writeBody(res);
          endLater(res, () => res.socket!.end()).then(onEnd);
        });
        server.httpAllowHalfOpen = true;
        const { client, outcome, body } = await connect(server);
        try {
          if (when === "with its request") client.end(GET);
          else client.write(GET);
          const held = await ended;
          if (when !== "with its request") client.end();
          client.resume();
          expect({ outcome: await outcome, body: body(), held: held > 0 }).toEqual({
            outcome: "end",
            body: SIZE,
            held: true,
          });
          await serverSocket.closed;
        } finally {
          client.destroy();
          server.closeAllConnections();
        }
      },
    );

    // A CONNECT that is pipelined behind a response whose bytes still wait. The tunnel writes nothing. Behind its
    // FIN it still reads, also when the server closes: a tunnel is not an idle connection.
    test.concurrent.each(["has not ended", "has ended"])(
      "the FIN of a tunnel follows the response before it, which %s, and the tunnel still reads",
      async state => {
        const { promise: dispatched, resolve: onDispatch } = Promise.withResolvers<ServerResponse>();
        const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
        const { promise: tunnelRead, resolve: onTunnelRead } = Promise.withResolvers<string>();
        const server = createServer((req, res) => {
          res.on("error", () => {});
          writeBody(res);
          if (state === "has ended") res.end();
          onDispatch(res);
        });
        server.on("connect", async (req, socket) => {
          socket.on("error", () => {});
          socket.on("data", (chunk: Buffer) => onTunnelRead(chunk.toString()));
          socket.on("close", () => onTunnelRead("close"));
          const held = (await dispatched).writableLength;
          socket.end();
          onEnd(held);
        });
        const { client, outcome, body } = await connect(server);
        try {
          client.write(GET);
          await dispatched;
          client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
          const held = await ended;
          client.resume();
          expect({ outcome: await outcome, body: body(), held: held > 0 }).toEqual({
            outcome: "end",
            body: SIZE,
            held: true,
          });
          server.close();
          client.write("PING");
          expect(await tunnelRead).toBe("PING");
        } finally {
          client.destroy();
          server.closeAllConnections();
          if (server.listening) server.close();
        }
      },
    );

    // Not fixed yet. The 'finish' of the socket fires when its end() starts to wait for the bytes, not when the FIN
    // leaves. A tunnel whose client ended first then has both sides ended, and its auto-destroy closes the socket
    // in front of the bytes that still wait. Observed: 163712 to 262144 of the 1048576 body bytes, then the FIN.
    // Node sends every byte.
    test.todo("a tunnel whose client ended first still sends the response before it", async () => {
      await using server = createServer((req, res) => {
        res.on("error", () => {});
        writeBody(res);
      });
      server.on("connect", (req, socket) => {
        socket.on("error", () => {});
        socket.resume();
        socket.end();
      });
      const { client, outcome, body } = await connect(server);
      try {
        client.end(GET + "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
        client.resume();
        expect({ outcome: await outcome, body: body() }).toEqual({ outcome: "end", body: SIZE });
      } finally {
        client.destroy();
        server.closeAllConnections();
      }
    });

    // Nothing reads the upload, so it fills the buffer of the request and stops the reads before end() runs. A
    // close behind the FIN would go out over those bytes as a reset, and a reset discards the response bytes that
    // the kernel has not sent yet. A unix socket resets at once; TCP depends on what is in flight.
    const transports = protocol === "http" && !isWindows ? ["TCP", "a unix socket"] : ["TCP"];
    test.concurrent.each(transports)(
      "over %s, a client that still uploads gets the whole response, then the FIN, and ends its upload later",
      async transport => {
        using dir = tempDir("end-drain", {});
        const piece = Buffer.concat([Buffer.from("10000\r\n"), Buffer.alloc(65536, "u"), Buffer.from("\r\n")]);
        const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
        const serverSocket = watchServerSocket();
        await using server = createServer((req, res) => {
          serverSocket.watch(req.socket);
          req.on("error", () => {});
          res.on("error", () => {});
          writeBody(res);
          res.end();
          endLater(res, () => req.socket.end()).then(onEnd);
        });
        // The upload must not outlast the keep-alive timer of the complete response.
        server.keepAliveTimeout = 60_000;
        const { client, outcome, body } = await connect(
          server,
          transport === "TCP" ? undefined : path.join(String(dir), "s.sock"),
        );
        try {
          client.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n");
          for (let i = 0; i < 4; i++) client.write(piece);
          const held = await ended;
          // The client reads the response while it sends more of the upload.
          client.resume();
          for (let i = 0; i < 4; i++) client.write(piece);
          expect({
            outcome: await outcome,
            body: body(),
            held: held > 0,
            serverSocketOpen: serverSocket.open,
          }).toEqual(finAfterBytes);
          // The rest of the upload goes out behind the FIN of the server. The FIN of the client then closes the
          // connection with no error.
          for (let i = 0; i < 4; i++) client.write(piece);
          client.end("0\r\n\r\n");
          expect(await once(client, "close")).toEqual([false]);
          await serverSocket.closed;
        } finally {
          client.destroy();
          server.closeAllConnections();
        }
      },
    );

    // The client keeps its side open behind the FIN. The response is complete, so the keep-alive timer of the
    // server closes the socket, as it does when end() finds nothing queued.
    test.concurrent("the keep-alive timer closes the socket behind the FIN of a complete response", async () => {
      const events: string[] = [];
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
      await using server = createServer((req, res) => {
        req.socket.on("error", () => {});
        req.socket.on("timeout", () => events.push("timeout"));
        req.socket.on("close", () => {
          events.push("close");
          onServerSocketClose();
        });
        writeBody(res);
        res.end();
        endLater(res, () => req.socket.end()).then(onEnd);
      });
      server.keepAliveTimeout = 100;
      server.keepAliveTimeoutBuffer = 0;
      const { client, outcome, body } = await connect(server);
      try {
        client.write(GET);
        const held = await ended;
        client.resume();
        expect({ outcome: await outcome, body: body(), held: held > 0 }).toEqual({
          outcome: "end",
          body: SIZE,
          held: true,
        });
        await serverSocketClosed;
        expect({ events, clientEnded: client.writableEnded }).toEqual({
          events: ["timeout", "close"],
          clientEnded: false,
        });
      } finally {
        client.destroy();
      }
    });

    // A pipelined request is dispatched while the first response still waits, and its response is queued. That
    // response can never leave behind the FIN, so it holds neither the reads of the connection nor the server.
    test.concurrent.each(["server.close()", "the FIN of the client"])(
      "%s closes a connection whose next response is queued behind the FIN",
      async closer => {
        const { promise: dispatched, resolve: onDispatch } = Promise.withResolvers<[ServerResponse, net.Socket]>();
        const { promise: queued, resolve: onQueued } = Promise.withResolvers<void>();
        const serverSocket = watchServerSocket();
        let first = true;
        const server = createServer((req, res) => {
          res.on("error", () => {});
          if (!first) {
            res.end("second");
            onQueued();
            return;
          }
          first = false;
          serverSocket.watch(req.socket);
          writeBody(res);
          res.end();
          onDispatch([res, req.socket]);
        });
        const { client, outcome, body } = await connect(server);
        try {
          client.write(GET);
          const [res, socket] = await dispatched;
          client.write(GET);
          await queued;
          const held = await endLater(res, () => socket.end());
          client.resume();
          expect({ outcome: await outcome, body: body(), held: held > 0 }).toEqual({
            outcome: "end",
            body: SIZE,
            held: true,
          });
          if (closer === "server.close()") {
            await new Promise<void>(resolve => server.close(() => resolve()));
            expect(client.writableEnded).toBe(false);
          } else {
            client.end();
            await serverSocket.closed;
          }
        } finally {
          client.destroy();
          server.closeAllConnections();
          if (server.listening) server.close();
        }
      },
    );
  });

  // The FIN has left, so the bytes of this response stay in the server: nothing can send them. They must not hold
  // the connection when the server closes, and neither must a request body that the FIN cut short.
  test.concurrent.each([
    ["a GET", GET],
    ["a POST with its body", "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello"],
  ])("server.close() completes for a socket that ended before the response to %s", async (_name, request) => {
    const { promise: responded, resolve: onResponse } = Promise.withResolvers<void>();
    const onRequest: Handler = (req, res) => {
      req.socket.on("error", () => {});
      res.on("error", () => {});
      req.socket.end();
      res.end("ok");
      setImmediate(onResponse);
    };
    const server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true };
    const client = protocol === "https" ? tls.connect({ ...to, rejectUnauthorized: false }) : net.connect(to);
    try {
      client.on("error", () => {});
      client.resume();
      const serverEnded = once(client, "end");
      client.write(request);
      await Promise.all([serverEnded, responded]);
      // The client keeps its side open. Only the server can close this connection.
      await new Promise<void>(resolve => server.close(() => resolve()));
      expect(client.writableEnded).toBe(false);
    } finally {
      client.destroy();
      server.closeAllConnections();
    }
  });
});

// TLS counts a write as taken while part of its record still waits for the kernel. The FIN of socket.end() waits
// for that part as it waits for bytes that the server still holds, and the response finishes first.
// A fault rule is for the whole process, so these tests run one at a time, after the tests above.
describe.skipIf(!fault.available() || isWindows)(
  "https: socket.end() behind a TLS record that the kernel took in part",
  () => {
    const { SIZE, createServer, writeBody, endLater, watchServerSocket, connect } = heldResponse("https");

    test("a small response finishes, and the FIN follows it", async () => {
      const { promise: finished, resolve: onFinish } = Promise.withResolvers<void>();
      const serverSocket = watchServerSocket();
      const server = createServer((req, res) => {
        serverSocket.watch(req.socket);
        res.on("finish", () => onFinish());
        // The kernel takes 16 bytes of the next send, which is the record of the response.
        fault.set({ syscall: "send", action: "short", bytes: 16 });
        res.end("response");
        req.socket.end();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const client = tls.connect({
        port: (server.address() as net.AddressInfo).port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        allowHalfOpen: true,
      });
      try {
        let received = "";
        client.on("data", (chunk: Buffer) => (received += chunk.toString("latin1")));
        client.on("error", () => {});
        const serverEnded = once(client, "end");
        client.on("secureConnect", () => client.write(GET));
        await Promise.all([serverEnded, finished]);
        expect(received.slice(received.indexOf("\r\n\r\n") + 4)).toBe("response");
        client.end();
        await serverSocket.closed;
      } finally {
        fault.clear();
        client.destroy();
        server.closeAllConnections();
        server.close();
      }
    });

    // Every send is short while the response leaves, so a part of the last record still waits when the server has
    // no more bytes to encrypt. The FIN waits for that part too.
    test.each([
      ["that has ended finishes first", true],
      ["that writes again at each 'drain' writes nothing in front of the FIN", false],
    ])("a response %s", async (_name, endsResponse) => {
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      const { promise: finished, resolve: onFinish } = Promise.withResolvers<void>();
      const serverSocket = watchServerSocket();
      const server = createServer((req, res) => {
        serverSocket.watch(req.socket);
        res.on("error", () => {});
        res.on("finish", () => onFinish());
        writeBody(res);
        if (endsResponse) res.end();
        endLater(res, () => {
          req.socket.end();
          if (!endsResponse) res.on("drain", () => res.write("more"));
        }).then(onEnd);
      });
      const { client, outcome, body } = await connect(server);
      try {
        client.write(GET);
        const held = await ended;
        fault.set({ syscall: "send", action: "short", bytes: 4096, repeat: -1 });
        client.resume();
        expect({ outcome: await outcome, body: body(), held: held > 0 }).toEqual({
          outcome: "end",
          body: SIZE,
          held: true,
        });
        if (endsResponse) await finished;
        fault.clear();
        client.end();
        await serverSocket.closed;
      } finally {
        fault.clear();
        client.destroy();
        server.closeAllConnections();
        server.close();
      }
    });
  },
);
