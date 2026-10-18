import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls as tlsCert } from "harness";
import { once } from "node:events";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net from "node:net";
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

  // socket.end() runs while the transport still holds response bytes: the client does not read, and 8 MB is more
  // than a loopback socket takes. It does then what it does with nothing queued, only later: the FIN follows the
  // bytes, and no close follows the FIN. Every expectation is Node v26.3.0's. Each end() comes from a later tick:
  // Node v26.9 and later send the FIN of an end() in the tick of the write before the bytes.
  describe("socket.end() while the transport still holds bytes", () => {
    const SIZE = 8 * 1024 * 1024;
    const createServer = (onRequest: Handler) =>
      protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
    // In eight writes: a transport that takes one write whole can still refuse the next one.
    const writeBody = (res: ServerResponse, headers: http.OutgoingHttpHeaders) => {
      res.writeHead(200, headers);
      const chunk = Buffer.alloc(SIZE / 8, "r");
      for (let i = 0; i < 8; i++) res.write(chunk);
    };
    // Runs `end` in a later tick. Resolves with what the transport still holds then: in the tick of a write,
    // writableLength also counts the bytes that the transport took.
    const endLater = (res: ServerResponse, end: () => void) =>
      new Promise<number>(resolve =>
        setImmediate(() => {
          end();
          setImmediate(() => resolve(res.writableLength));
        }),
      );
    // A client that keeps its side open when the server ends, and that does not read until `resume()`.
    async function connect(server: http.Server) {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true };
      const client = protocol === "https" ? tls.connect({ ...to, rejectUnauthorized: false }) : net.connect(to);
      await once(client, protocol === "https" ? "secureConnect" : "connect");
      client.pause();
      let received = 0;
      let head = Buffer.alloc(0);
      client.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (!head.includes("\r\n\r\n")) head = Buffer.concat([head, chunk]);
      });
      // How the response ends for the client.
      const outcome = new Promise<string>(resolve => {
        client.on("end", () => resolve("end"));
        client.on("error", (err: NodeJS.ErrnoException) => resolve(`error ${err.code}`));
        client.on("close", () => resolve("close with no end"));
      });
      return { client, outcome, body: () => received - (head.indexOf("\r\n\r\n") + 4) };
    }
    // The FIN waits: the transport still holds bytes when end() runs. Windows can take every write at once.
    const finWaited = (held: number) => isWindows || held > 0;

    test.concurrent("the FIN follows a response that never ends, and the client's FIN closes the socket", async () => {
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
      await using server = createServer((req, res) => {
        req.socket.on("error", () => {});
        req.socket.on("close", () => onServerSocketClose());
        writeBody(res, { "Content-Type": "text/plain" });
        endLater(res, () => res.socket!.end()).then(onEnd);
      });
      const { client, outcome, body } = await connect(server);
      try {
        client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        const held = await ended;
        client.resume();
        // Eight chunks: each has its size line, its bytes and its CRLF. The response has no last chunk.
        expect({ outcome: await outcome, body: body(), finWaited: finWaited(held) }).toEqual({
          outcome: "end",
          body: SIZE + 8 * ("100000\r\n".length + 2),
          finWaited: true,
        });
        client.end();
        await serverSocketClosed;
      } finally {
        client.destroy();
      }
    });

    // A CONNECT that is pipelined behind a response whose bytes still wait. The tunnel writes nothing.
    test.concurrent("the FIN of a tunnel that wrote nothing follows the response before it", async () => {
      const { promise: dispatched, resolve: onDispatch } = Promise.withResolvers<ServerResponse>();
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      await using server = createServer((req, res) => {
        res.on("error", () => {});
        writeBody(res, { "Content-Length": SIZE });
        onDispatch(res);
      });
      server.on("connect", async (req, socket) => {
        socket.on("error", () => {});
        const held = (await dispatched).writableLength;
        socket.end();
        onEnd(held);
      });
      const { client, outcome, body } = await connect(server);
      try {
        client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        await dispatched;
        client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
        const held = await ended;
        client.resume();
        expect({ outcome: await outcome, body: body(), finWaited: finWaited(held) }).toEqual({
          outcome: "end",
          body: SIZE,
          finWaited: true,
        });
      } finally {
        client.destroy();
        server.closeAllConnections();
      }
    });

    // Nothing reads the upload, so it fills the buffer of the request and stops the reads before end() runs. A
    // close behind the FIN would go out over those bytes as a reset, and a reset discards the response bytes that
    // the kernel has not sent yet.
    test.concurrent("a client that still uploads gets the whole response, then the FIN", async () => {
      const piece = Buffer.concat([Buffer.from("10000\r\n"), Buffer.alloc(65536, "u"), Buffer.from("\r\n")]);
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      await using server = createServer((req, res) => {
        req.on("error", () => {});
        res.on("error", () => {});
        req.socket.on("error", () => {});
        writeBody(res, { "Content-Length": SIZE });
        res.end();
        endLater(res, () => req.socket.end()).then(onEnd);
      });
      const { client, outcome, body } = await connect(server);
      try {
        client.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n");
        for (let i = 0; i < 4; i++) client.write(piece);
        const held = await ended;
        // The client reads the response while it sends the rest of the upload.
        client.resume();
        for (let i = 0; i < 12; i++) client.write(piece);
        expect({ outcome: await outcome, body: body(), finWaited: finWaited(held) }).toEqual({
          outcome: "end",
          body: SIZE,
          finWaited: true,
        });
      } finally {
        client.destroy();
        server.closeAllConnections();
      }
    });

    // The client keeps its side open behind the FIN. The response is complete, so the keep-alive timer of the server
    // closes the socket, as it does when end() finds nothing queued.
    test.concurrent("the keep-alive timer closes the socket behind the FIN of a complete response", async () => {
      const { promise: ended, resolve: onEnd } = Promise.withResolvers<number>();
      const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
      await using server = createServer((req, res) => {
        req.socket.on("error", () => {});
        req.socket.on("close", () => onServerSocketClose());
        writeBody(res, { "Content-Length": SIZE });
        res.end();
        endLater(res, () => req.socket.end()).then(onEnd);
      });
      server.keepAliveTimeout = 100;
      const { client, outcome, body } = await connect(server);
      try {
        client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        const held = await ended;
        client.resume();
        expect({ outcome: await outcome, body: body(), finWaited: finWaited(held) }).toEqual({
          outcome: "end",
          body: SIZE,
          finWaited: true,
        });
        await serverSocketClosed;
        expect(client.writableEnded).toBe(false);
      } finally {
        client.destroy();
      }
    });
  });

  // The FIN has left, so the bytes of this response stay in the buffer of the server. They must not hold the
  // connection when the server closes: nothing can send them.
  test.concurrent("server.close() completes for a socket that ended before its response", async () => {
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
      client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
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
