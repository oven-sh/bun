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

  test.concurrent.each([
    ["end()", (res: ServerResponse) => void res.end("late")],
    ["write()", (res: ServerResponse) => void res.write("late")],
    ["flushHeaders()", (res: ServerResponse) => res.flushHeaders()],
    ["writeContinue()", (res: ServerResponse) => res.writeContinue()],
  ])("res.%s behind socket.end(data) sends nothing", async (_name, late) => {
    const onRequest: Handler = (req, res) => {
      req.socket.end("raw");
      late(res);
    };
    await using server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" };
    const client = protocol === "https" ? tls.connect({ ...to, ca: tlsCert.cert }) : net.connect(to);
    client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    expect(Buffer.concat(await client.toArray()).toString()).toBe("raw");
  });

  test.concurrent("res.socket.end() behind 8 MiB the client hasn't read, on a response that never ends", async () => {
    const size = 8 * 1024 * 1024;
    const { promise: heldAtEnd, resolve } = Promise.withResolvers<number>();
    const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
    const onRequest: Handler = (req, res) => {
      res.writeHead(200, { "Content-Length": size });
      res.write(Buffer.alloc(size, "a"));
      res.socket!.on("close", () => onServerSocketClose());
      res.socket!.end();
      // In the tick of a write, writableLength also counts the bytes that the transport took.
      process.nextTick(() => resolve(res.writableLength));
    };
    await using server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true };
    const client = protocol === "https" ? tls.connect({ ...to, ca: tlsCert.cert }) : net.connect(to);
    try {
      let received = 0;
      let head = -1;
      client.on("data", (chunk: Buffer) => {
        if (head === -1) head = chunk.indexOf("\r\n\r\n") + 4;
        received += chunk.length;
      });
      const serverEnded = once(client, "end");
      client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      await serverEnded;
      // Windows takes all 8 MiB in one send, so there the FIN has nothing to wait for.
      const finWaited = isWindows || (await heldAtEnd) > 0;
      expect({ body: received - head, finWaited }).toEqual({ body: size, finWaited: true });
      client.end();
      await serverSocketClosed;
    } finally {
      client.destroy();
    }
  });
});

// Windows takes all 8 MiB in one send, so there nothing waits for the client.
describe.skipIf(isWindows).each(["http", "https"] as const)(
  "%s: a socket that ends behind 8 MiB the client hasn't read",
  protocol => {
    const size = 8 * 1024 * 1024;
    const turn = () => new Promise(resolve => setImmediate(resolve));

    async function respond(act: (req: IncomingMessage, client: net.Socket) => void | Promise<void>) {
      const server = protocol === "https" ? https.createServer(tlsCert) : http.createServer();
      await once(server.listen(0, "127.0.0.1"), "listening");
      const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true };
      const client = protocol === "https" ? tls.connect({ ...to, ca: tlsCert.cert }) : net.connect(to);
      client.on("error", () => {});
      client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      const [req, res] = (await once(server, "request")) as [IncomingMessage, ServerResponse];
      const events: string[] = [];
      req.on("aborted", () => events.push("req aborted"));
      res.on("finish", () => events.push("res finish"));
      req.socket.on("finish", () => events.push("socket finish"));
      const socketClosed = once(req.socket, "close");
      res.end(Buffer.alloc(size, "a"));
      await act(req, client);
      await turn();
      await turn();
      return {
        server,
        events,
        socketClosed,
        async read() {
          let received = 0;
          client.on("data", chunk => (received += chunk.length));
          await new Promise(resolve => client.once("end", () => client.end()).once("close", resolve));
          return received;
        },
        [Symbol.dispose]() {
          client.destroy();
          server.closeAllConnections();
          server.close();
        },
      };
    }

    test.concurrent.each([
      ["destroySoon()", (req: IncomingMessage) => req.socket.destroySoon()],
      ["end()", (req: IncomingMessage) => void req.socket.end()],
      [
        "the client's FIN",
        async (req: IncomingMessage, client: net.Socket) => {
          client.end();
          await once(req.socket, "end");
        },
      ],
    ])("%s: nothing finishes or aborts until the bytes are out", async (_name, act) => {
      using exchange = await respond(act);
      const early = [...exchange.events];
      const whole = (await exchange.read()) > size;
      await exchange.socketClosed;
      expect({ early, whole, late: exchange.events.toSorted() }).toEqual({
        early: [],
        whole: true,
        late: ["res finish", "socket finish"],
      });
    });

    test.concurrent.each([
      ["socket.destroy()", (req: IncomingMessage) => void req.socket.destroy()],
      ["res.destroy()", (req: IncomingMessage) => void (req.socket as any)._httpMessage.destroy()],
      ["closeAllConnections()", (req: IncomingMessage) => (req.socket as any).server.closeAllConnections()],
    ])("%s: the response finishes before it closes", async (_name, close) => {
      const order: string[] = [];
      const { promise: both, resolve } = Promise.withResolvers<void>();
      using _exchange = await respond(req => {
        for (const event of ["finish", "close"]) {
          (req.socket as any)._httpMessage.on(event, () => order.push(event) === 2 && resolve());
        }
        close(req);
      });
      await both;
      expect(order).toEqual(["finish", "close"]);
    });

    test.concurrent("end(): an unread upload that waits behind the response doesn't reset it", async () => {
      using exchange = await respond(async (req, client) => {
        client.write(`POST /2 HTTP/1.1\r\nHost: x\r\nContent-Length: ${size}\r\n\r\n`);
        client.write(Buffer.alloc(size));
        await once((req.socket as any).server, "request");
        req.socket.end();
      });
      expect(await exchange.read()).toBeGreaterThan(size);
      await exchange.socketClosed;
    });

    test.concurrent.each([
      ["write(), end()", "end", "<a><b>"],
      ["write(), write()", "write", "<a><b><late>"],
    ] as const)("%s on the socket go out ahead of a later response", async (_name, second, expected) => {
      const server = (protocol === "https" ? https.createServer(tlsCert) : http.createServer()).on(
        "request",
        (req, res) => {
          req.socket.write("<a>");
          req.socket[second]("<b>");
          res.end("<late>");
        },
      );
      await once(server.listen(0, "127.0.0.1"), "listening");
      const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" };
      const client = protocol === "https" ? tls.connect({ ...to, ca: tlsCert.cert }) : net.connect(to);
      try {
        let received = "";
        client.on("data", chunk => (received += chunk));
        client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        await once(client, "close");
        expect(received.match(/<[^>]*>/g)!.join("")).toBe(expected);
      } finally {
        client.destroy();
        server.close();
      }
    });

    test.concurrent("end(): the connection closes on the responses that wait behind it", async () => {
      using exchange = await respond(async (req, client) => {
        client.write("GET /2 HTTP/1.1\r\nHost: x\r\n\r\n");
        await once((req.socket as any).server, "request");
        req.socket.end();
        client.resume();
        await once(client, "end");
      });
      await new Promise(resolve => exchange.server.close(resolve));
    });

    test.concurrent.each([
      ["end()", (socket: net.Socket) => void socket.end()],
      ["destroySoon()", (socket: net.Socket) => socket.destroySoon()],
    ])("destroy() after %s closes the connection", async (_name, end) => {
      using exchange = await respond(async req => {
        end(req.socket);
        await turn();
        req.socket.destroy();
      });
      await exchange.socketClosed;
      expect(await exchange.read()).toBeLessThan(size);
    });
  },
);

test.concurrent.each(["http", "https"] as const)(
  "%s: a socket that an unread upload paused closes when end() and the client's FIN have ended both sides",
  async protocol => {
    await using server = protocol === "https" ? https.createServer(tlsCert) : http.createServer();
    await once(server.listen(0, "127.0.0.1"), "listening");
    const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" };
    const client = protocol === "https" ? tls.connect({ ...to, ca: tlsCert.cert }) : net.connect(to);
    try {
      client.on("error", () => {}).resume();
      client.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1000000\r\n\r\n`);
      const [req, res] = (await once(server, "request")) as [IncomingMessage, ServerResponse];
      client.write(Buffer.alloc(200_000));
      await once(req.socket, "pause");
      req.socket.end();
      await once(res, "close");
      expect(req.socket.destroyed).toBe(true);
    } finally {
      client.destroy();
      server.closeAllConnections();
    }
  },
);

test("https: httpAllowHalfOpen keeps the responses that are owed at the client's FIN", async () => {
  const owed: ServerResponse[] = [];
  await using server = https.createServer(tlsCert, (req, res) => {
    if (owed.push(res) > 1) return;
    req.socket.on("end", () =>
      setImmediate(() => {
        for (const response of owed) response.end(`<${response.req.url}>`);
      }),
    );
  });
  (server as any).httpAllowHalfOpen = true;
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = tls.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", ca: tlsCert.cert });
  client.end("GET /1 HTTP/1.1\r\nHost: x\r\n\r\nGET /2 HTTP/1.1\r\nHost: x\r\n\r\n");
  expect(
    Buffer.concat(await client.toArray())
      .toString()
      .match(/<[^>]*>/g),
  ).toEqual(["</1>", "</2>"]);
});

// An http.Server socket has allowHalfOpen: end() sends the FIN, and the request in flight still gets its body.
describe.each(["http", "https"] as const)("%s: the request body behind the FIN of socket.end()", protocol => {
  const createServer = (onRequest: http.RequestListener) =>
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

  /** What `req` emits, and what it has read, when the connection has closed. */
  function observe(req: IncomingMessage) {
    const { promise, resolve } = Promise.withResolvers<{ body: string; events: string[] }>();
    let body = "";
    const events: string[] = [];
    req.on("data", chunk => (body += chunk.toString("latin1")));
    req.on("end", () => events.push("end"));
    req.on("error", err => events.push(`error ${(err as NodeJS.ErrnoException).code}`));
    req.on("close", () => events.push("close"));
    req.socket.on("close", () => setImmediate(() => resolve({ body, events })));
    return promise;
  }

  const requestHead = (framing: string, path = "/") => `POST ${path} HTTP/1.1\r\nHost: a\r\n${framing}\r\n\r\n`;
  const badRequest = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  const unauthorized: Handler = (req, res) => {
    res.writeHead(401, { "Content-Length": 2 });
    res.end("no");
    req.socket.end();
  };
  const rejections: [string, Handler][] = [
    ["res.end() and req.socket.end()", unauthorized],
    ["req.socket.end(data) and no response", req => void req.socket.end(badRequest)],
  ];
  const payload = Buffer.alloc(1000, "abcdefghij").toString();
  const bodies: [string, string, string][] = [
    ["Content-Length", `Content-Length: ${payload.length}`, payload],
    ["chunked", "Transfer-Encoding: chunked", `3e8\r\n${payload}\r\n0\r\n\r\n`],
  ];

  describe.each(rejections)("%s", (_how, reject) => {
    describe.each(bodies)("%s", (_framing, framing, encoded) => {
      test.concurrent.each([
        ["all of the body", 0],
        ["the rest of a body that began in the read of the head", 400],
      ])("%s reaches the request", async (_what, withHead) => {
        const clientErrors: string[] = [];
        const { promise, resolve } = Promise.withResolvers<ReturnType<typeof observe>>();
        await using server = createServer((req, res) => {
          resolve(observe(req));
          reject(req, res);
        });
        server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
          clientErrors.push(String(err.code));
          socket.destroy();
        });

        const client = await connectTo(server);
        try {
          const serverEnded = once(client, "end");
          client.write(requestHead(framing) + encoded.slice(0, withHead));
          await serverEnded;
          client.end(encoded.slice(withHead));
          expect({ ...(await promise), clientErrors }).toEqual({
            body: payload,
            events: ["end", "close"],
            clientErrors: [],
          });
        } finally {
          client.destroy();
        }
      });
    });
  });

  // Node.js parses the whole read before destroySoon() closes the socket.
  test.concurrent.each([
    ["all of the body", payload.length, ["end", "close"]],
    ["the part of the body", 400, ["error ECONNRESET", "close"]],
  ])(
    "req.socket.destroySoon() leaves the request %s that came in the read of the head",
    async (_what, sent, events) => {
      const { promise, resolve } = Promise.withResolvers<ReturnType<typeof observe>>();
      await using server = createServer(req => {
        resolve(observe(req));
        req.socket.destroySoon();
      });

      const client = await connectTo(server);
      try {
        client.write(requestHead(`Content-Length: ${payload.length}`) + payload.slice(0, sent));
        expect(await promise).toEqual({ body: payload.slice(0, sent), events });
      } finally {
        client.destroy();
      }
    },
  );

  test.concurrent.each(bodies)("the connection is idle behind a %s body", async (_framing, framing, encoded) => {
    const { promise, resolve } = Promise.withResolvers<net.Socket>();
    await using server = createServer((req, res) => {
      req.on("end", () => resolve(req.socket)).resume();
      unauthorized(req, res);
    });

    const client = await connectTo(server);
    try {
      const serverEnded = once(client, "end");
      client.write(requestHead(framing));
      await serverEnded;
      client.write(encoded);
      const socket = await promise;
      expect(socket.destroyed).toBe(false);
      const closed = once(socket, "close");
      server.closeIdleConnections();
      await closed;
    } finally {
      client.destroy();
    }
  });

  test.concurrent("a reader that is slower than the client pauses the reads and gets the whole body", async () => {
    const size = 4 * 1024 * 1024;
    const { promise, resolve } = Promise.withResolvers<{ received: number; buffered: number }>();
    await using server = createServer(async (req, res) => {
      unauthorized(req, res);
      let received = 0;
      let buffered = 0;
      for await (const chunk of req) {
        received += chunk.length;
        for (let i = 0; i < 8; i++) {
          await new Promise(resolve => setImmediate(resolve));
          buffered = Math.max(buffered, req.readableLength);
        }
      }
      resolve({ received, buffered });
    });

    const client = await connectTo(server);
    try {
      const serverEnded = once(client, "end");
      client.write(requestHead(`Content-Length: ${size}`));
      await serverEnded;
      client.end(Buffer.alloc(size, "x"));
      const { received, buffered } = await promise;
      expect(received).toBe(size);
      // The high water mark and one read, which is at most 512 KB.
      expect(buffered).toBeLessThanOrEqual(64 * 1024 + 512 * 1024);
    } finally {
      client.destroy();
    }
  });

  // Node.js stops the reads when the buffer of the request is full, and the connection stays open.
  // The body of an Upgrade request is not read behind the FIN.
  test.concurrent.each([
    ["a request", "", true],
    ["an Upgrade request", "Connection: Upgrade\r\nUpgrade: raw\r\n", false],
  ])(
    "the body of %s that nothing reads is not buffered, and the client's FIN closes the connection",
    async (_kind, headers, isRead) => {
      const size = 2 * 1024 * 1024;
      const { promise, resolve } = Promise.withResolvers<IncomingMessage>();
      const onRequest = (req: IncomingMessage) => {
        req.on("error", () => {});
        req.socket.on("error", () => {});
        req.socket.end(badRequest);
        resolve(req);
      };
      await using server = createServer(onRequest);
      server.on("upgrade", onRequest);

      const client = await connectTo(server);
      try {
        const serverEnded = once(client, "end");
        client.write(requestHead(`${headers}Content-Length: ${size}`));
        await serverEnded;
        const req = await promise;
        const closed = new Promise(resolve => req.socket.once("close", resolve));
        client.end(Buffer.alloc(size, "x"));
        await closed;
        expect(req.readableLength > 0).toBe(isRead);
        // The high water mark and one read, which is at most 512 KB.
        expect(req.readableLength).toBeLessThanOrEqual(req.readableHighWaterMark + 512 * 1024);
      } finally {
        client.destroy();
      }
    },
  );

  // The FIN waits for response bytes that the client does not read. Until it leaves, nothing is dropped.
  test.concurrent("a reader that comes late gets the whole body that arrived while the FIN waited", async () => {
    const size = 300_000;
    const { promise, resolve } = Promise.withResolvers<{ req: IncomingMessage; held: number }>();
    await using server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      const chunk = Buffer.alloc(1024 * 1024, "a");
      for (let i = 0; i < 8; i++) res.write(chunk);
      res.socket!.end();
      // In the tick of a write, writableLength also counts the bytes that the transport took.
      process.nextTick(() => resolve({ req, held: res.writableLength }));
    });

    const client = await connectTo(server);
    try {
      client.pause();
      client.write(requestHead(`Content-Length: ${size}`));
      const { req, held } = await promise;
      client.write(Buffer.alloc(size, "x"));
      for (const deadline = Date.now() + 4000; req.readableLength < req.readableHighWaterMark;) {
        if (Date.now() > deadline) throw new Error(`the request has buffered ${req.readableLength} bytes`);
        await new Promise(resolve => setImmediate(resolve));
      }
      let received = 0;
      req.on("data", chunk => (received += chunk.length));
      await once(req, "end");
      expect({ received, finWaits: held > 0 }).toEqual({ received: size, finWaits: true });
    } finally {
      client.destroy();
      server.closeAllConnections();
    }
  });

  test.concurrent("a reader that comes late gets the rest of a body that had paused the socket", async () => {
    await using server = createServer(() => {});
    const client = await connectTo(server);
    try {
      const size = (server as any).highWaterMark + 1000;
      client.write(requestHead(`Content-Length: ${size}`));
      const [req] = (await once(server, "request")) as [IncomingMessage];
      client.write(Buffer.alloc(size - 1000));
      await once(req.socket, "pause");
      await new Promise(resolve => client.write(Buffer.alloc(1000), resolve));
      req.socket.end();
      await once(client, "end");
      const seen = observe(req);
      req.once("end", () => client.end());
      const { body, events } = await seen;
      expect({ received: body.length, events }).toEqual({ received: size, events: ["end", "close"] });
    } finally {
      client.destroy();
      server.closeAllConnections();
    }
  });

  test.concurrent("a body that the client cuts short aborts a request with no response", async () => {
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof observe>>();
    await using server = createServer(req => {
      resolve(observe(req));
      req.socket.end(badRequest);
    });
    server.on("clientError", (_err, socket) => socket.destroy());

    const client = await connectTo(server);
    try {
      const serverEnded = once(client, "end");
      client.write(requestHead(`Content-Length: ${payload.length}`));
      await serverEnded;
      client.end(payload.slice(0, 500));
      expect(await promise).toEqual({ body: payload.slice(0, 500), events: ["error ECONNRESET", "close"] });
    } finally {
      client.destroy();
    }
  });

  // No response can leave behind the FIN. Node.js dispatches such a request.
  test.concurrent("the request behind that body is not dispatched", async () => {
    const urls: string[] = [];
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof observe>>();
    await using server = createServer((req, res) => {
      urls.push(req.url!);
      resolve(observe(req));
      unauthorized(req, res);
    });

    const client = await connectTo(server);
    try {
      const serverEnded = once(client, "end");
      client.write(requestHead("Content-Length: 4", "/first"));
      await serverEnded;
      client.end("BODY" + "GET /second HTTP/1.1\r\nHost: a\r\n\r\n");
      expect({ ...(await promise), urls }).toEqual({ body: "BODY", events: ["end", "close"], urls: ["/first"] });
    } finally {
      client.destroy();
    }
  });
});

// The response is complete and closes the connection, but the kernel hasn't accepted all of it, so the FIN waits for
// the drain. A request pipelined in the same read gets no response in that window, and the FIN still comes.
describe.each(["http", "https"] as const)("%s: an 8 MiB response that closes the connection", protocol => {
  const BIG = Buffer.alloc(8 << 20, 0x61);
  const cases: [string, http.RequestListener][] = [
    [
      "res.end(body), then req.socket.end()",
      (req, res) => {
        res.writeHead(200, { "Content-Length": String(BIG.length) });
        res.end(BIG);
        req.socket.end();
      },
    ],
    [
      "res.end(body) with a Connection: close response header",
      (req, res) => {
        res.writeHead(200, { "Content-Length": String(BIG.length), "Connection": "close" });
        res.end(BIG);
      },
    ],
    [
      "res.write(body) and res.end(), then req.socket.end()",
      (req, res) => {
        res.writeHead(200, { "Content-Length": String(BIG.length) });
        res.write(BIG);
        res.end();
        req.socket.end();
      },
    ],
  ];

  test.each(cases)("%s: a request pipelined behind it is not answered", async (_name, respond) => {
    let first = true;
    const onRequest: http.RequestListener = (req, res) => {
      if (first) {
        first = false;
        respond(req, res);
      } else {
        // Node.js also runs the listener for the pipelined request, but its socket is no longer writable.
        res.end("second");
      }
    };
    await using server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
    await once(server.listen(0, "127.0.0.1"), "listening");

    const to = { port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" };
    const client = protocol === "https" ? tls.connect({ ...to, ca: tlsCert.cert }) : net.connect(to);
    const chunks: Buffer[] = [];
    let received = 0;
    let headLength = -1;
    const { promise: outcome, resolve: settle } = Promise.withResolvers<"close" | "a second response">();
    client.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (headLength === -1) {
        const headEnd = Buffer.concat(chunks).indexOf("\r\n\r\n");
        if (headEnd === -1) return;
        headLength = headEnd + 4;
      }
      // Settle on the first extra byte. After a second response the FIN only comes with the keep-alive timeout.
      if (received > headLength + BIG.length) settle("a second response");
    });
    // The server can close before the client's own FIN lands.
    client.on("error", () => {});
    client.once("close", () => settle("close"));
    // Neither request asks for Connection: close, so the close has to come from the server.
    client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n");
    const result = await outcome;
    client.destroy();

    const response = Buffer.concat(chunks);
    const body = response.subarray(Math.max(headLength, 0));
    expect({
      outcome: result,
      statusLine: response.subarray(0, response.indexOf("\r\n")).toString("latin1"),
      bodyLength: body.length,
      bodyIntact: body.equals(BIG),
    }).toEqual({ outcome: "close", statusLine: "HTTP/1.1 200 OK", bodyLength: BIG.length, bodyIntact: true });
  });
});
