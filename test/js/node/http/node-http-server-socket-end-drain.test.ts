import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { once } from "node:events";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net from "node:net";
import { duplexPair, type Duplex } from "node:stream";
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
    client.on("data", chunk => chunks.push(chunk));
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

  // socket.end() runs while the transport still holds bytes (8 MB in several writes is more
  // than a loopback socket takes), and the response never ends. The FIN follows those bytes,
  // as in Node. The server still reads behind its FIN, and it keeps the socket until the
  // client ends.
  describe("socket.end() behind bytes that the transport still holds", () => {
    const TOTAL = 8 * 1024 * 1024;
    const MB = 1024 * 1024;
    const REQUEST_BODY = Buffer.alloc(64 * 1024, "b");
    const request = (path: string) => `GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`;
    const post = (path: string, length: number) =>
      `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Length: ${length}\r\n\r\n`;
    const chunkOf = (size: number, fill: string) =>
      Buffer.concat([Buffer.from(size.toString(16) + "\r\n"), Buffer.alloc(size, fill), Buffer.from("\r\n")]);
    // What res.write() puts on the wire for every chunk of `size` bytes. No res.end(), so no last chunk.
    const chunked = (size: number) => Buffer.concat(new Array(TOTAL / size).fill(chunkOf(size, "a")));
    const writeChunks = (res: ServerResponse, size: number) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      const chunk = Buffer.alloc(size, "a");
      for (let i = 0; i < TOTAL / size; i++) res.write(chunk);
    };

    // Ends the socket of the request to /end.
    type End = (data?: string | Buffer) => void;
    type Respond = (req: IncomingMessage, res: ServerResponse, end: End) => void;
    const writeThenEnd: Respond = (req, res, end) => {
      writeChunks(res, MB);
      end();
    };
    // A request that reached the listener: what it got of its body, and its 'end', 'aborted' and 'error' events.
    type Seen = { url: string; bytes: number; events: string[] };
    const complete = (url: string, bytes = 0): Seen => ({ url, bytes, events: ["end"] });

    type Scenario = {
      name: string;
      // Handles the request to /end.
      respond: Respond;
      // The bytes between the last response head and the FIN.
      body: () => Buffer;
      statusLines?: string[];
      // What the client sends first.
      send?: (client: net.Socket) => void;
      // Runs when the client has the FIN of the server. `res` is the response to /end.
      behindFin?: (client: net.Socket, res: ServerResponse) => void;
      // Every request that reached the listener, when the server socket has closed.
      requests?: Seen[];
      clientErrors?: string[];
      httpAllowHalfOpen?: boolean;
    };
    const scenarios: Scenario[] = [
      {
        name: "res.write() in 16 KB chunks, res.socket.end()",
        respond(req, res, end) {
          writeChunks(res, 16 * 1024);
          end();
        },
        body: () => chunked(16 * 1024),
      },
      {
        name: "res.write() in 1 MB chunks, res.socket.end()",
        respond: writeThenEnd,
        body: () => chunked(MB),
      },
      {
        // In small writes: on Windows the transport took 8 MB in two writes whole.
        name: "req.socket.write(data) in 64 KB chunks, req.socket.end(data) and no response",
        respond(req, res, end) {
          const chunk = Buffer.alloc(64 * 1024, "a");
          for (let i = 1; i < TOTAL / chunk.length; i++) req.socket.write(chunk);
          end(chunk);
        },
        body: () => Buffer.alloc(TOTAL, "a"),
        statusLines: [],
      },
      {
        name: "res.write(), req.socket.end(data)",
        respond(req, res, end) {
          writeChunks(res, MB);
          end("RAW");
        },
        body: () => Buffer.concat([chunked(MB), Buffer.from("RAW")]),
      },
      {
        name: "res.write(), res.socket.end() from setImmediate",
        respond(req, res, end) {
          writeChunks(res, MB);
          setImmediate(end);
        },
        body: () => chunked(MB),
      },
      {
        // Node gives a response no 'drain' once its socket has ended, so the FIN does not wait for this writer.
        name: "res.write(), res.socket.end(), and a 'drain' listener that writes more",
        respond(req, res, end) {
          writeChunks(res, MB);
          res.on("drain", () => void res.write(Buffer.alloc(MB, "c")));
          end();
        },
        body: () => chunked(MB),
      },
      {
        name: "the second request of a keep-alive connection",
        respond: writeThenEnd,
        body: () => chunked(MB),
        statusLines: ["HTTP/1.1 200 OK", "HTTP/1.1 200 OK"],
        send(client) {
          let first = "";
          const onData = (data: Buffer) => {
            first += data.toString("latin1");
            if (!first.endsWith("\r\n\r\nok")) return;
            client.off("data", onData);
            client.write(request("/end"));
          };
          client.on("data", onData);
          client.write(request("/first"));
        },
      },
      {
        // The bytes of the first response pause the reads when the second request is dispatched. Node
        // leaves them paused for ever, because a socket that has ended emits no 'drain'. Here the FIN
        // gives them back, so the FIN of the client closes the socket.
        name: "the first of two pipelined requests",
        respond: writeThenEnd,
        body: () => chunked(MB),
        send: client => void client.write(request("/end") + request("/after")),
        requests: [complete("/end"), complete("/after")],
      },
      {
        name: "httpAllowHalfOpen and a client that ended first",
        respond: writeThenEnd,
        body: () => chunked(MB),
        send: client => void client.end(request("/end")),
        httpAllowHalfOpen: true,
      },
      {
        name: "a request body that arrives behind the FIN",
        respond: writeThenEnd,
        body: () => chunked(MB),
        send(client) {
          client.write(post("/end", REQUEST_BODY.length));
          client.write(REQUEST_BODY.subarray(0, REQUEST_BODY.length / 2));
        },
        behindFin: client => void client.write(REQUEST_BODY.subarray(REQUEST_BODY.length / 2)),
        requests: [complete("/end", REQUEST_BODY.length)],
      },
      {
        name: "chunks of a request body that arrive behind the FIN in one write",
        respond: writeThenEnd,
        body: () => chunked(MB),
        send(client) {
          client.write("POST /end HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n");
          client.write(chunkOf(1000, "b"));
        },
        behindFin(client) {
          client.write(Buffer.concat([chunkOf(1000, "c"), chunkOf(1000, "d"), Buffer.from("0\r\n\r\n")]));
        },
        requests: [complete("/end", 3000)],
      },
      {
        name: "a request body that stays incomplete",
        respond: writeThenEnd,
        body: () => chunked(MB),
        send(client) {
          client.write(post("/end", REQUEST_BODY.length));
          client.write(REQUEST_BODY.subarray(0, REQUEST_BODY.length / 2));
        },
        requests: [{ url: "/end", bytes: REQUEST_BODY.length / 2, events: ["aborted", "error ECONNRESET"] }],
        clientErrors: ["HPE_INVALID_EOF_STATE"],
      },
      {
        name: "two requests that arrive behind the FIN in one write",
        respond: writeThenEnd,
        body: () => chunked(MB),
        behindFin(client) {
          client.write(post("/late1", 1024) + Buffer.alloc(1024, "b").toString() + request("/late2"));
        },
        requests: [complete("/end"), complete("/late1", 1024), complete("/late2")],
      },
      {
        // The bytes of that response write never leave. They must not pause the reads at the next request.
        name: "a response write and a request behind the FIN",
        respond: writeThenEnd,
        body: () => chunked(MB),
        behindFin(client, res) {
          res.write("late");
          client.write(request("/late"));
        },
        requests: [complete("/end"), complete("/late")],
      },
    ];

    test.concurrent.each(scenarios)(
      "$name",
      async ({
        respond,
        body: expectedBody,
        statusLines = ["HTTP/1.1 200 OK"],
        send,
        behindFin,
        requests: expectedRequests = [complete("/end")],
        clientErrors: expectedClientErrors = [],
        httpAllowHalfOpen = false,
      }) => {
        const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
        const { promise: requestsArrived, resolve: onRequestsArrived } = Promise.withResolvers<void>();
        let serverSocket: net.Socket | undefined;
        let response: ServerResponse | undefined;
        // What the transport still holds when socket.end() has run.
        let heldAtEnd = -1;
        const requests: Seen[] = [];
        const socketEvents: string[] = [];
        const clientErrors: string[] = [];
        // Every request of the scenario has reached the listener, with its body, and has ended if it ends.
        const onProgress = () => {
          const arrived = expectedRequests.every(({ bytes, events }, i) => {
            const seen = requests[i];
            return (
              seen !== undefined && seen.bytes >= bytes && (!events.includes("end") || seen.events.includes("end"))
            );
          });
          if (arrived) onRequestsArrived();
        };
        const onRequest: Handler = (req, res) => {
          if (req.url === "/first") return void res.end("ok");
          const seen: Seen = { url: req.url!, bytes: 0, events: [] };
          const onEvent = (event: string) => {
            seen.events.push(event);
            onProgress();
          };
          requests.push(seen);
          req.on("data", chunk => {
            seen.bytes += chunk.length;
            onProgress();
          });
          req.on("end", () => onEvent("end"));
          req.on("aborted", () => onEvent("aborted"));
          req.on("error", (error: NodeJS.ErrnoException) => onEvent(`error ${error.code}`));
          onProgress();
          // Behind a response that never ends: it gets no turn.
          if (req.url !== "/end") return;
          const socket = (serverSocket = req.socket);
          response = res;
          socket.on("end", () => socketEvents.push("end"));
          socket.on("error", (error: NodeJS.ErrnoException) => socketEvents.push(`error ${error.code}`));
          socket.on("close", () => {
            socketEvents.push("close");
            onServerSocketClose();
          });
          respond(req, res, data => {
            if (data === undefined) socket.end();
            else socket.end(data);
            // In the tick of a write, writableLength also counts the bytes that the transport took.
            process.nextTick(() => (heldAtEnd = res.writableLength));
          });
        };
        await using server =
          protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
        server.httpAllowHalfOpen = httpAllowHalfOpen;
        server.on("clientError", (error: NodeJS.ErrnoException, socket) => {
          clientErrors.push(String(error.code));
          socket.destroy();
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        const { port } = server.address() as net.AddressInfo;

        // allowHalfOpen: the FIN of the server does not make the client send its own.
        const client =
          protocol === "https"
            ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, allowHalfOpen: true })
            : net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
        try {
          const received: Buffer[] = [];
          const ended = new Promise<void>((resolve, reject) => {
            client.on("data", data => received.push(data));
            client.on("end", resolve);
            client.on("error", reject);
          });
          if (send) send(client);
          else client.write(request("/end"));
          await ended;

          // With nothing held, main also sends the FIN, and it reads nothing behind it.
          expect(heldAtEnd).toBeGreaterThan(0);
          const clientEndedFirst = client.writableEnded;
          const wire = Buffer.concat(received);
          const body = expectedBody();
          const bodyStart = Math.max(0, wire.length - body.length);
          expect({
            statusLines:
              wire
                .subarray(0, bodyStart)
                .toString("latin1")
                .match(/HTTP\/1\.1 [^\r\n]*/g) ?? [],
            bodyStart: wire.subarray(Math.max(0, bodyStart - 4), bodyStart).toString("latin1"),
            bodyLength: wire.length - bodyStart,
            bodyMatches: wire.subarray(bodyStart).equals(body),
            // With the client's FIN still to come, the server keeps the socket.
            serverSocketDestroyed: clientEndedFirst ? undefined : serverSocket!.destroyed,
          }).toEqual({
            statusLines,
            bodyStart: statusLines.length > 0 ? "\r\n\r\n" : "",
            bodyLength: body.length,
            bodyMatches: true,
            serverSocketDestroyed: clientEndedFirst ? undefined : false,
          });

          behindFin?.(client, response!);
          await requestsArrived;
          client.end();
          // The FIN of the client is the end of the stream for the server, and it closes the socket.
          await serverSocketClosed;
          expect({ requests, clientErrors, socketEvents }).toEqual({
            requests: expectedRequests,
            clientErrors: expectedClientErrors,
            socketEvents: ["end", "close"],
          });
        } finally {
          client.destroy();
          server.closeAllConnections();
        }
      },
    );

    const createServer = (options: http.ServerOptions, onRequest: Handler) =>
      protocol === "https"
        ? https.createServer({ ...tlsCert, ...options }, onRequest)
        : http.createServer(options, onRequest);
    const connect = (port: number) =>
      protocol === "https"
        ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, allowHalfOpen: true })
        : net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    // One request and its response on a connection of its own.
    const roundTrip = (port: number) =>
      new Promise<void>((resolve, reject) => {
        (protocol === "https" ? https : http)
          .get({ port, host: "127.0.0.1", path: "/ping", agent: false, rejectUnauthorized: false }, res =>
            res.resume().on("end", resolve),
          )
          .on("error", reject);
      });

    // A request body that nothing reads pauses the reads, as in Node. The FIN leaves that pause
    // alone: the rest of the body stays in the transport until the listener reads the request.
    test.concurrent("the FIN keeps the reads paused for a request body that the listener has not read", async () => {
      const BODY = Buffer.alloc(2 * MB, "b");
      const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
      let upload: IncomingMessage | undefined;
      const onRequest: Handler = (req, res) => {
        if (req.url === "/ping") return void res.end("pong");
        upload = req;
        req.socket.on("close", onServerSocketClose);
        // The body has filled the buffer of the request.
        req.socket.once("pause", () => {
          writeChunks(res, MB);
          req.socket.end();
        });
      };
      await using server = createServer({}, onRequest);
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as net.AddressInfo;
      const client = connect(port);
      try {
        let responseLength = 0;
        const ended = new Promise<void>((resolve, reject) => {
          client.on("data", data => (responseLength += data.length));
          client.on("end", resolve);
          client.on("error", reject);
        });
        client.write(post("/upload", BODY.length));
        client.write(BODY);
        await ended;
        const bufferedAtFin = upload!.readableLength;
        client.end();
        // Two more requests reach the server behind the FIN of the client. With the reads on, it has that FIN by now.
        await roundTrip(port);
        await roundTrip(port);
        expect({
          buffered: upload!.readableLength,
          belowBody: bufferedAtFin < BODY.length,
          serverSocketDestroyed: upload!.socket.destroyed,
        }).toEqual({ buffered: bufferedAtFin, belowBody: true, serverSocketDestroyed: false });

        let uploaded = 0;
        upload!.on("data", chunk => (uploaded += chunk.length));
        await once(upload!, "end");
        await serverSocketClosed;
        expect(uploaded).toBe(BODY.length);
      } finally {
        client.destroy();
        server.closeAllConnections();
      }
    });

    // Responses in the queue that hold the high water mark or more pause the reads, as in Node. That bound
    // stays behind the FIN: a client cannot fill the memory of the server with requests that get no turn.
    test.concurrent("the FIN keeps the bound on what the responses in the queue hold", async () => {
      const { promise: late1Dispatched, resolve: onLate1 } = Promise.withResolvers<void>();
      const urls: string[] = [];
      let serverSocket: net.Socket | undefined;
      const onRequest: Handler = (req, res) => {
        if (req.url === "/ping") return void res.end("pong");
        urls.push(req.url!);
        if (req.url === "/end") {
          serverSocket = req.socket;
          writeChunks(res, MB);
          req.socket.end();
          return;
        }
        // Behind /end in the queue: the server keeps these bytes.
        res.end(Buffer.alloc(64 * 1024, "b"));
        if (req.url === "/late1") onLate1();
      };
      await using server = createServer({}, onRequest);
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as net.AddressInfo;
      const client = connect(port);
      try {
        const ended = new Promise<void>((resolve, reject) => {
          client.on("end", resolve);
          client.on("error", reject);
        });
        client.resume();
        client.write(request("/end") + request("/queued1") + request("/queued2"));
        await ended;
        client.write(request("/late1"));
        await late1Dispatched;
        client.write(request("/late2"));
        // Two more requests reach the server behind /late2. With the reads on, it has /late2 by now.
        await roundTrip(port);
        await roundTrip(port);
        expect({ urls, serverSocketDestroyed: serverSocket!.destroyed }).toEqual({
          urls: ["/end", "/queued1", "/queued2", "/late1"],
          serverSocketDestroyed: false,
        });
      } finally {
        client.destroy();
        server.closeAllConnections();
      }
    });

    // The timers of the server still cover what it reads behind its FIN.
    test.concurrent.each([
      { name: "a request head that stays incomplete", late: "GET /late HTTP/1.1\r\nHo", urls: ["/end"] },
      {
        name: "a request, then a request head that stays incomplete",
        late: request("/late") + "GET /stalled HTTP/1.1\r\nHo",
        urls: ["/end", "/late"],
      },
    ])("headersTimeout closes the socket behind the FIN: $name", async ({ late, urls: expectedUrls }) => {
      const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
      const { promise: clientError, resolve: onClientError } = Promise.withResolvers<string>();
      const urls: string[] = [];
      const onRequest: Handler = (req, res) => {
        urls.push(req.url!);
        if (req.url !== "/end") return;
        req.socket.on("close", onServerSocketClose);
        writeChunks(res, MB);
        req.socket.end();
      };
      await using server = createServer({ connectionsCheckingInterval: 25 }, onRequest);
      server.on("clientError", (error: NodeJS.ErrnoException, socket) => {
        onClientError(String(error.code));
        socket.destroy();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const client = connect((server.address() as net.AddressInfo).port);
      try {
        const ended = new Promise<void>((resolve, reject) => {
          client.on("end", resolve);
          client.on("error", reject);
        });
        client.resume();
        client.write(request("/end"));
        await ended;
        // Not before the FIN: the first request head must not race the timer.
        server.headersTimeout = 100;
        client.write(late);
        expect(await clientError).toBe("ERR_HTTP_REQUEST_TIMEOUT");
        await serverSocketClosed;
        expect({ urls, clientEnded: client.writableEnded }).toEqual({ urls: expectedUrls, clientEnded: false });
      } finally {
        client.destroy();
        server.closeAllConnections();
      }
    });

    // No response is in flight when these bytes have left, so the connection closes behind the
    // FIN, as every connection that is marked to close does. Node keeps the socket until the client ends.
    test.concurrent("socket.end(data) with no request closes the connection behind the FIN", async () => {
      const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
      await using server = createServer({}, () => {});
      server.on(protocol === "https" ? "secureConnection" : "connection", (socket: net.Socket) => {
        socket.on("close", onServerSocketClose);
        socket.write(Buffer.alloc(TOTAL / 2, "a"));
        socket.end(Buffer.alloc(TOTAL / 2, "a"));
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const client = connect((server.address() as net.AddressInfo).port);
      try {
        let received = 0;
        const ended = new Promise<void>((resolve, reject) => {
          client.on("data", data => (received += data.length));
          client.on("end", resolve);
          client.on("error", reject);
        });
        await Promise.all([ended, serverSocketClosed]);
        expect({ received, clientEnded: client.writableEnded }).toEqual({ received: TOTAL, clientEnded: false });
      } finally {
        client.destroy();
        server.closeAllConnections();
      }
    });

    // The client ends its side of the TLS session and keeps the TCP connection. When the FIN of the server has
    // left, both sides have ended. The transport has no event left for that, so the server closes the socket itself.
    if (protocol === "https") {
      test.concurrent("httpAllowHalfOpen and a client that ended first, with no TCP FIN", async () => {
        const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
        const socketEvents: string[] = [];
        const onRequest: Handler = (req, res) => {
          req.socket.on("end", () => socketEvents.push("end"));
          req.socket.on("close", () => {
            socketEvents.push("close");
            onServerSocketClose();
          });
          writeChunks(res, MB);
          req.socket.end();
        };
        await using server = createServer({}, onRequest);
        server.httpAllowHalfOpen = true;
        await once(server.listen(0, "127.0.0.1"), "listening");
        // The TLS client writes to one side of a pair. The other side is copied to a TCP connection that never ends.
        const tcp = net.connect({
          port: (server.address() as net.AddressInfo).port,
          host: "127.0.0.1",
          allowHalfOpen: true,
        });
        const [tlsSide, wireSide] = duplexPair();
        wireSide.on("data", data => tcp.write(data));
        tcp.on("data", data => wireSide.write(data));
        tcp.on("error", () => {});
        const client = tls.connect({ socket: tlsSide, rejectUnauthorized: false, allowHalfOpen: true });
        try {
          client.resume();
          client.on("error", () => {});
          client.end(request("/end"));
          await serverSocketClosed;
          expect({ socketEvents, tcpEnded: tcp.writableEnded, tcpDestroyed: tcp.destroyed }).toEqual({
            socketEvents: ["end", "close"],
            tcpEnded: false,
            tcpDestroyed: false,
          });
        } finally {
          client.destroy();
          tcp.destroy();
          server.closeAllConnections();
        }
      });
    }
  });
});

// An http.Server socket has allowHalfOpen: end() sends the FIN and the socket still reads. Here nothing is queued
// when end() runs, so the FIN leaves at once. The expectations are Node v26.3.0's, except where a test says so.
// Node passes the bytes behind a complete body as `head`, so the tests join `head` and 'data'.
describe.each(["http", "https"] as const)("%s: the connection reads behind the FIN of socket.end()", protocol => {
  const createServer = (onRequest?: http.RequestListener) =>
    protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);

  async function connectTo(server: http.Server) {
    await once(server.listen(0, "127.0.0.1"), "listening");
    const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true };
    const client = protocol === "https" ? tls.connect({ ...to, rejectUnauthorized: false }) : net.connect(to);
    client.on("error", () => {});
    client.resume();
    await once(client, protocol === "https" ? "secureConnect" : "connect");
    return client;
  }

  const upgradeHead = (framing: string) =>
    `POST /upgrade HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: raw\r\n${framing}\r\n\r\n`;
  const requestHead = (framing: string, path = "/") => `POST ${path} HTTP/1.1\r\nHost: a\r\n${framing}\r\n\r\n`;
  const switchingProtocols = "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n";
  const badRequest = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

  type Ending = (req: IncomingMessage, socket: Duplex) => void;
  const endings: [string, Ending][] = [
    ["in the 'upgrade' listener", (req, socket) => socket.end()],
    ["in a later tick", (req, socket) => setImmediate(() => socket.end())],
    ["in the request's first 'data' listener", (req, socket) => req.once("data", () => socket.end())],
  ];
  const bodies: [string, string, string][] = [
    ["Content-Length", "Content-Length: 4", "BODY"],
    ["chunked", "Transfer-Encoding: chunked", "4\r\nBODY\r\n0\r\n\r\n"],
  ];

  describe.each(endings)("an Upgrade request with a body, ended %s", (_when, end) => {
    describe.each(bodies)("%s", (_name, framing, encodedBody) => {
      test.concurrent.each([
        ["in the read of the head", true],
        ["in later reads", false],
      ])("gets a body that arrives %s, and the socket gets the bytes behind it", async (_arrival, withHead) => {
        await using server = createServer();
        const { promise, resolve } = Promise.withResolvers<{ body: string; tunnel: string; complete: boolean }>();
        server.on("upgrade", (req, socket, head) => {
          let body = "";
          let tunnel = head.toString("latin1");
          req.on("data", chunk => (body += chunk.toString("latin1")));
          socket.on("data", chunk => (tunnel += chunk.toString("latin1")));
          socket.on("error", () => {});
          socket.on("close", () => resolve({ body, tunnel, complete: req.complete }));
          socket.write(switchingProtocols);
          end(req, socket);
        });

        const client = await connectTo(server);
        try {
          // The server's FIN: its write side is down when the rest arrives.
          const serverEnded = once(client, "end");
          if (withHead) {
            client.write(upgradeHead(framing) + encodedBody + "FIRST-");
            await serverEnded;
          } else {
            client.write(upgradeHead(framing));
            // The request's 'data' listener ends the socket: it needs the first byte of the body.
            const endsInData = end === endings[2][1];
            if (endsInData) client.write(encodedBody.slice(0, 4));
            await serverEnded;
            client.write(endsInData ? encodedBody.slice(4) : encodedBody);
            client.write("FIRST-");
          }
          client.end("SECOND");
          expect(await promise).toEqual({ body: "BODY", tunnel: "FIRST-SECOND", complete: true });
        } finally {
          client.destroy();
        }
      });
    });
  });

  // Node.js parses the whole read before the close takes effect.
  describe.each([
    ["end() and then destroy()", (socket: Duplex) => (socket.end(badRequest), socket.destroy())],
    ["destroySoon()", (socket: Duplex) => (socket as net.Socket).destroySoon()],
    [
      "end() and destroy() on 'finish'",
      (socket: Duplex) => (socket.once("finish", socket.destroy), socket.end(badRequest)),
    ],
  ])("a listener that closes the socket with %s", (_name, close) => {
    test.concurrent.each([
      ["an Upgrade request", upgradeHead],
      ["a request", requestHead],
    ])("gets the body of %s that arrived with the head", async (_kind, head) => {
      const { promise, resolve } = Promise.withResolvers<{ body: string; complete: boolean }>();
      const onRequest = (req: IncomingMessage, socket: Duplex) => {
        let body = "";
        req.on("data", chunk => (body += chunk.toString("latin1")));
        req.on("error", () => {});
        socket.on("error", () => {});
        socket.on("close", () => resolve({ body, complete: req.complete }));
        close(socket);
      };
      await using server = createServer(req => onRequest(req, req.socket));
      server.on("upgrade", onRequest);

      const client = await connectTo(server);
      try {
        client.write(head("Content-Length: 4") + "BODY");
        expect(await promise).toEqual({ body: "BODY", complete: true });
      } finally {
        client.destroy();
      }
    });
  });

  test.concurrent("a parse error in the body of an Upgrade request behind the FIN emits no 'clientError'", async () => {
    await using server = createServer();
    const clientErrors: string[] = [];
    server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
      clientErrors.push(String(err.code));
      socket.destroy();
    });
    const { promise, resolve } = Promise.withResolvers<{ body: string; tunnel: string }>();
    server.on("upgrade", (req, socket, head) => {
      let body = "";
      let tunnel = head.toString("latin1");
      req.on("data", chunk => (body += chunk.toString("latin1")));
      socket.on("data", chunk => (tunnel += chunk.toString("latin1")));
      socket.on("error", () => {});
      socket.on("close", () => resolve({ body, tunnel }));
      socket.write(switchingProtocols);
      socket.end();
    });

    const client = await connectTo(server);
    try {
      const serverEnded = once(client, "end");
      client.write(upgradeHead("Transfer-Encoding: chunked") + "4\r\nBODY\r\n");
      await serverEnded;
      client.end("zz\r\nBAD\r\nSECOND");
      expect({ ...(await promise), clientErrors }).toEqual({ body: "BODY", tunnel: "", clientErrors: [] });
    } finally {
      client.destroy();
    }
  });

  describe("req.socket.end() in a 'request' listener", () => {
    type Reader = (req: IncomingMessage, onChunk: (chunk: Buffer) => void) => void;
    const readers: [string, number, Reader][] = [
      ["a 'data' listener", 1000, (req, onChunk) => req.on("data", onChunk)],
      [
        "a reader that is slower than the client",
        300_000,
        async (req, onChunk) => {
          try {
            for await (const chunk of req) {
              onChunk(chunk);
              await new Promise(resolve => setImmediate(resolve));
            }
          } catch {}
        },
      ],
    ];
    test.concurrent.each(readers)("leaves the body to %s (%d bytes)", async (_name, size, read) => {
      const { promise, resolve } = Promise.withResolvers<{ received: number; complete: boolean }>();
      await using server = createServer(req => {
        let received = 0;
        read(req, chunk => (received += chunk.length));
        req.on("error", () => {});
        req.on("end", () => resolve({ received, complete: req.complete }));
        req.socket.end(badRequest);
      });

      const client = await connectTo(server);
      try {
        const serverEnded = once(client, "end");
        client.write(requestHead(`Content-Length: ${size}`));
        await serverEnded;
        // No FIN: the close of a socket destroys a request that has no response, with what it has not read.
        client.write(Buffer.alloc(size, "x"));
        expect(await promise).toEqual({ received: size, complete: true });
      } finally {
        client.destroy();
      }
    });

    test.concurrent("dispatches the request that arrives behind the FIN", async () => {
      const urls: string[] = [];
      const { promise, resolve } = Promise.withResolvers<string>();
      await using server = createServer((req, res) => {
        urls.push(req.url!);
        if (req.url !== "/first") return void res.end();
        let body = "";
        req.on("data", chunk => (body += chunk.toString("latin1")));
        req.on("error", () => {});
        req.socket.on("error", () => {});
        req.socket.on("close", () => resolve(body));
        req.socket.end(badRequest);
      });

      const client = await connectTo(server);
      try {
        client.end(requestHead("Content-Length: 4", "/first") + "BODY" + "GET /second HTTP/1.1\r\nHost: a\r\n\r\n");
        expect({ body: await promise, urls }).toEqual({ body: "BODY", urls: ["/first", "/second"] });
      } finally {
        client.destroy();
      }
    });

    test.concurrent("reports a body that the client cuts short behind the FIN", async () => {
      const clientErrors: string[] = [];
      const { promise, resolve } = Promise.withResolvers<{ received: number; events: string[] }>();
      await using server = createServer(req => {
        let received = 0;
        const events: string[] = [];
        req.on("data", chunk => (received += chunk.length));
        req.on("end", () => events.push("request end"));
        req.on("error", (err: NodeJS.ErrnoException) => events.push(`request error ${err.code}`));
        req.socket.on("end", () => events.push("socket end"));
        req.socket.on("error", () => {});
        req.socket.on("close", () => setImmediate(() => resolve({ received, events: events.sort() })));
        req.socket.end(badRequest);
      });
      server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
        clientErrors.push(String(err.code));
        socket.destroy();
      });

      const client = await connectTo(server);
      try {
        const serverEnded = once(client, "end");
        client.write(requestHead("Content-Length: 1000"));
        await serverEnded;
        client.end(Buffer.alloc(500, "x"));
        expect({ ...(await promise), clientErrors }).toEqual({
          received: 500,
          events: ["request error ECONNRESET", "socket end"],
          clientErrors: ["HPE_INVALID_EOF_STATE"],
        });
      } finally {
        client.destroy();
      }
    });
  });

  // Node.js stops reading when the buffer of the request is full, and the connection stays open. Bun stops filling
  // the buffer there, reads the connection to its end and drops the bytes. One read is at most 512 KB.
  test.concurrent.each([
    ["a request", requestHead],
    ["an Upgrade request", upgradeHead],
  ])(
    "the body of %s that nothing reads is not buffered, and the client's FIN closes the connection",
    async (_kind, head) => {
      const size = 2 * 1024 * 1024;
      const { promise, resolve } = Promise.withResolvers<IncomingMessage>();
      const onRequest = (req: IncomingMessage, socket: Duplex) => {
        req.on("error", () => {});
        socket.on("error", () => {});
        socket.end(badRequest);
        resolve(req);
      };
      await using server = createServer(req => onRequest(req, req.socket));
      server.on("upgrade", onRequest);

      const client = await connectTo(server);
      try {
        const serverEnded = once(client, "end");
        client.write(head(`Content-Length: ${size}`));
        await serverEnded;
        const req = await promise;
        const closed = new Promise(resolve => req.socket.once("close", resolve));
        client.end(Buffer.alloc(size, "x"));
        await closed;
        expect(req.readableLength).toBeLessThanOrEqual(req.readableHighWaterMark + 512 * 1024);
      } finally {
        client.destroy();
      }
    },
  );

  // The FIN waits for response bytes that the client does not read. Until it leaves, the body is buffered as before.
  test.concurrent("a reader that comes late gets the whole body that arrived while the FIN waited", async () => {
    const size = 300_000;
    const { promise: dispatched, resolve: onRequest } = Promise.withResolvers<{ req: IncomingMessage; held: number }>();
    await using server = createServer((req, res) => {
      req.on("error", () => {});
      res.on("error", () => {});
      res.writeHead(200, { "Content-Type": "text/plain" });
      const chunk = Buffer.alloc(1024 * 1024, "a");
      for (let i = 0; i < 8; i++) res.write(chunk);
      res.socket!.end();
      // In the tick of a write, writableLength also counts the bytes that the transport took.
      process.nextTick(() => onRequest({ req, held: res.writableLength }));
    });

    const client = await connectTo(server);
    try {
      client.pause();
      client.write(requestHead(`Content-Length: ${size}`));
      const { req, held } = await dispatched;
      client.write(Buffer.alloc(size, "x"));
      while (req.readableLength < req.readableHighWaterMark) await new Promise(resolve => setImmediate(resolve));
      let received = 0;
      req.on("data", chunk => (received += chunk.length));
      await once(req, "end");
      expect({ received, fin: held > 0 ? "waits" : "left" }).toEqual({ received: size, fin: "waits" });
    } finally {
      client.destroy();
      server.closeAllConnections();
    }
  });

  // The responses to such requests stay in the queue. Node.js stops reading when they hold the high water mark, and
  // the connection stays open for ever. Bun drops the rest there, so that the client's FIN closes the connection.
  test.concurrent.each([
    ["at once", false],
    ["after response bytes that the transport held", true],
  ])("requests pipelined behind a FIN that leaves %s do not keep the connection open", async (_when, waits) => {
    const count = 3000;
    let dispatched = 0;
    let held = -1;
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    await using server = createServer((req, res) => {
      res.on("error", () => {});
      if (++dispatched > 1) return void res.end(Buffer.alloc(64 * 1024, "r"));
      req.socket.on("error", () => {});
      req.socket.on("close", () => onClose());
      if (waits) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        const chunk = Buffer.alloc(1024 * 1024, "a");
        for (let i = 0; i < 8; i++) res.write(chunk);
      } else {
        res.end("first");
      }
      req.socket.end();
      // In the tick of a write, writableLength also counts the bytes that the transport took.
      process.nextTick(() => (held = res.writableLength));
    });

    const client = await connectTo(server);
    try {
      const serverEnded = once(client, "end");
      client.write("GET /first HTTP/1.1\r\nHost: a\r\n\r\n");
      await serverEnded;
      client.end(Buffer.alloc(count * 32, "GET /later HTTP/1.1\r\nHost: a\r\n\r\n"));
      await closed;
      expect({ fin: held > 0 ? "waits" : "left", dispatchedAll: dispatched === count + 1 }).toEqual({
        fin: waits ? "waits" : "left",
        dispatchedAll: false,
      });
    } finally {
      client.destroy();
      server.closeAllConnections();
    }
  });

  // server.close() stops the listener. A request in flight keeps its body, as in Node.js.
  test.concurrent("a reader that is slower than the client gets the whole body after server.close()", async () => {
    const size = 300_000;
    const { promise, resolve } = Promise.withResolvers<{ received: number; complete: boolean }>();
    const server = createServer(async req => {
      req.on("error", () => {});
      req.socket.end(badRequest);
      let received = 0;
      try {
        for await (const chunk of req) {
          received += chunk.length;
          await new Promise(resolve => setImmediate(resolve));
        }
      } catch {}
      resolve({ received, complete: req.complete });
    });

    const client = await connectTo(server);
    try {
      const serverEnded = once(client, "end");
      client.write(requestHead(`Content-Length: ${size}`));
      await serverEnded;
      server.close();
      // No FIN: the close of a socket destroys a request that has no response, with what it has not read.
      client.write(Buffer.alloc(size, "x"));
      expect(await promise).toEqual({ received: size, complete: true });
    } finally {
      client.destroy();
      server.closeAllConnections();
    }
  });
});
