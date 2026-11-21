import { describe, expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import type { IncomingMessage, ServerOptions } from "node:http";
import { createServer, ServerResponse } from "node:http";
import { createSecureServer } from "node:http2";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { duplexPair, Writable } from "node:stream";
import { createServer as createTLSServer, connect as tlsConnect, TLSSocket } from "node:tls";
import { WebSocketServer } from "ws";

test("aborting a connection settles every queued pipelined response callback once", async () => {
  const queued = Promise.withResolvers<void>();
  const callbacksDone = Promise.withResolvers<void>();
  const queuedResponsesClosed = Promise.withResolvers<void>();
  const events: string[] = [];
  const callbackErrors: Error[] = [];
  let callbacksRemaining = 6;
  let closesRemaining = 2;

  const callback = (name: string) => (error?: Error | null) => {
    events.push(name);
    if (error) callbackErrors.push(error);
    if (--callbacksRemaining === 0) callbacksDone.resolve();
  };
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/a") return;

    const prefix = req.url!.slice(1);
    res.on("close", () => {
      events.push(`${prefix}:close`);
      if (--closesRemaining === 0) queuedResponsesClosed.resolve();
    });
    res.writeContinue(callback(`${prefix}:continue`));
    res.write("body", callback(`${prefix}:write`));
    res.end("end", callback(`${prefix}:end`));
    if (req.url === "/c") queued.resolve();
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const client = connect((server.address() as AddressInfo).port, "127.0.0.1");
  client.on("error", () => {});

  try {
    await new Promise<void>(resolve => client.once("connect", resolve));
    client.write(
      "GET /a HTTP/1.1\r\nHost: localhost\r\n\r\n" +
        "GET /b HTTP/1.1\r\nHost: localhost\r\n\r\n" +
        "GET /c HTTP/1.1\r\nHost: localhost\r\n\r\n",
    );
    await queued.promise;
    client.destroy();
    await Promise.all([callbacksDone.promise, queuedResponsesClosed.promise]);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(events.filter(event => !event.endsWith(":close")).sort()).toEqual([
      "b:continue",
      "b:end",
      "b:write",
      "c:continue",
      "c:end",
      "c:write",
    ]);
    expect(callbackErrors).toHaveLength(6);
    expect(new Set(callbackErrors).size).toBe(1);
    expect(callbackErrors[0]).toMatchObject({ code: "ERR_STREAM_DESTROYED" });
    for (const prefix of ["b", "c"]) {
      for (const operation of ["continue", "write", "end"]) {
        expect(events.indexOf(`${prefix}:close`)).toBeGreaterThan(events.indexOf(`${prefix}:${operation}`));
      }
    }
  } finally {
    client.destroy();
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});

test("a request body that was put back on its socket before emit('connection') is delivered whole to a listener that reads it after an await", async () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  const server = createServer(async (req, res) => {
    await null;
    let bytes = 0;
    const slow = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        bytes += chunk.length;
        setImmediate(callback);
      },
    });
    req.pipe(slow).on("finish", () => resolve(bytes));
    res.end();
  });
  const front = createNetServer(socket => {
    socket.once("data", first => {
      socket.pause();
      socket.unshift(first);
      server.emit("connection", socket);
      socket.resume();
    });
  });
  front.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => front.once("listening", resolve));
  const client = connect((front.address() as AddressInfo).port, "127.0.0.1");
  try {
    client.on("error", () => {}).resume();
    client.write(
      "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n" +
        Array.from("abcd", fill => `400\r\n${fill.repeat(1024)}\r\n`).join("") +
        "0\r\n\r\n",
    );
    expect(await promise).toBe(4096);
  } finally {
    client.destroy();
    server.closeAllConnections();
    front.close();
  }
});

type Reader = (req: IncomingMessage, res: ServerResponse, take: (chunk: Buffer) => void, end: () => void) => void;
const readers: [string, Reader][] = [
  [
    "pipe() into a slow Writable",
    (req, _res, take, end) => {
      req.on("end", end).pipe(
        new Writable({
          highWaterMark: 1,
          write(chunk, _encoding, callback) {
            take(chunk);
            setImmediate(callback);
          },
        }),
      );
    },
  ],
  [
    "on('data') and pause()",
    (req, _res, take, end) => {
      req.on("end", end).on("data", chunk => {
        take(chunk);
        req.pause();
        setImmediate(() => req.resume());
      });
    },
  ],
  [
    "once('data') then pause(), and the rest once the response has closed",
    (req, res, take, end) => {
      req.once("data", chunk => {
        take(chunk);
        req.pause();
      });
      res.on("close", () => setImmediate(() => req.on("end", end).on("data", take).resume()));
    },
  ],
];
test.each(readers.flatMap(([how, read]) => [true, false].map(flowing => [how, flowing, read] as const)))(
  "a request body on a stream that is not a socket is delivered whole to a listener that reads it at once with %s and answers (stream flowing: %p)",
  async (_, flowing, read) => {
    const { promise, resolve } = Promise.withResolvers<{ bytes: number; end: boolean }>();
    const server = createServer((req, res) => {
      const seen = { bytes: 0, end: false };
      req.on("close", () => setImmediate(resolve, seen));
      read(
        req,
        res,
        chunk => (seen.bytes += chunk.length),
        () => (seen.end = true),
      );
      res.end("ok");
    });
    const [clientSide, serverSide] = duplexPair();
    server.emit("connection", serverSide);
    try {
      clientSide.on("error", () => {}).resume();
      // The server's side flows from the next tick on.
      if (flowing) await new Promise(resolve => setImmediate(resolve));
      clientSide.write(
        "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n" +
          Array.from("abcd", fill => `400\r\n${fill.repeat(1024)}\r\n`).join("") +
          "0\r\n\r\n",
      );
      expect(await promise).toEqual({ bytes: 4096, end: true });
    } finally {
      clientSide.destroy();
      server.closeAllConnections();
    }
  },
);

describe.each(["emit('connection')", "emit('connection') with a TLS socket", "allowHTTP1", "listen()"] as const)(
  "over %s",
  kind => {
    test.each([false, true])(
      "a response that never gets its turn emits no 'finish', and its end() callback gets an error (a CONNECT request behind it: %p)",
      async withConnect => {
        const events: string[] = [];
        const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
        const onRequest = (req: IncomingMessage, res: ServerResponse) => {
          if (req.url === "/0") {
            req.socket.on("close", () => setImmediate(onClosed));
            res.writeHead(204).end();
            return;
          }
          for (const event of ["finish", "close"]) res.on(event, () => events.push(`${req.url} ${event}`));
          if (req.url === "/1") req.socket.end();
          else
            res.end("body", (error?: NodeJS.ErrnoException) => events.push(`${req.url} end() ${error?.code ?? "ok"}`));
        };
        const server =
          kind === "allowHTTP1"
            ? createSecureServer({ ...tlsCert, allowHTTP1: true }, onRequest as any)
            : createServer(onRequest);
        server.on("connect", (_req, socket) => {
          events.push("connect");
          socket.on("error", () => {});
        });
        const front =
          kind === "emit('connection')"
            ? createNetServer(socket => server.emit("connection", socket))
            : kind === "emit('connection') with a TLS socket"
              ? createTLSServer(tlsCert, socket => server.emit("connection", socket))
              : server;
        await once(front.listen(0, "127.0.0.1"), "listening");
        const { port } = front.address() as AddressInfo;
        const client =
          kind === "emit('connection')" || kind === "listen()"
            ? connect(port, "127.0.0.1")
            : tlsConnect({
                port,
                host: "127.0.0.1",
                ca: tlsCert.cert,
                servername: "localhost",
                ALPNProtocols: ["http/1.1"],
              });
        try {
          client.on("error", () => {}).on("end", () => client.destroy());
          client
            .resume()
            .write(
              "GET /0 HTTP/1.1\r\nHost: localhost\r\n\r\n" +
                "POST /1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello" +
                "POST /2 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello" +
                (withConnect ? "CONNECT localhost:1 HTTP/1.1\r\nHost: localhost:1\r\n\r\n" : ""),
            );
          await closed;
          // uWS parses nothing behind the request whose handler ended the socket.
          if (kind === "listen()") expect(events).toEqual(["/1 close"]);
          else {
            expect(events).toEqual([
              ...(withConnect ? ["connect"] : []),
              "/1 close",
              "/2 end() ERR_STREAM_DESTROYED",
              "/2 close",
            ]);
          }
        } finally {
          client.destroy();
          front.close();
          server.close();
        }
      },
    );
  },
);

const head = (method = "GET", headers = "", version = "1.1") =>
  `${method} /x HTTP/${version}\r\nHost: a\r\n${headers}\r\n`;
const get = (path: string, headers = "") => `GET ${path} HTTP/1.1\r\nHost: a\r\n${headers}\r\n`;
const turn = () => new Promise(resolve => setImmediate(resolve));

async function connectTo(server: ReturnType<typeof createServer>, secure = false) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  const options = { port: (server.address() as AddressInfo).port, host: "127.0.0.1" };
  const socket = secure ? tlsConnect({ ...options, ca: tlsCert.cert, servername: "localhost" }) : connect(options);
  let received = "";
  let onChange = () => {};
  socket.on("error", () => {});
  socket.on("data", chunk => {
    received += chunk.toString("latin1");
    onChange();
  });
  socket.on("close", () => onChange());
  await once(socket, secure ? "secureConnect" : "connect");
  return {
    socket,
    // What has arrived when `isDone` says so, or when the connection has closed.
    async until(isDone: (received: string) => boolean = () => false) {
      while (!isDone(received) && !socket.closed) await new Promise<void>(resolve => (onChange = resolve));
      return received;
    },
    [Symbol.dispose]() {
      socket.destroy();
      server.closeAllConnections();
      server.close();
    },
  };
}

describe.each(["http", "https"])("%s: a response is the same whether or not it waited for the connection", protocol => {
  type Log = (entry: unknown) => void;
  type Handler = (res: ServerResponse & Record<string, any>, log: Log, req: IncomingMessage) => unknown;
  const attempt = (log: Log, run: () => unknown) => {
    try {
      run();
    } catch (error: any) {
      log(error.code);
    }
  };
  class WithoutOptions extends ServerResponse {
    constructor(req: IncomingMessage) {
      super(req);
    }
  }
  const post = head("POST", "Content-Length: 5\r\n") + "hello";
  const cases: [string, string, Handler, ServerOptions?][] = [
    ["end()", head(), res => res.end()],
    ["end(string)", head(), res => res.end("héllo €")],
    ["end(string, encoding)", head(), res => res.end("6869", "hex")],
    ["end(Buffer)", head(), res => res.end(Buffer.from("hello"))],
    ["end(ArrayBuffer)", head(), res => res.end(new Uint8Array([104, 105]).buffer)],
    ["end(number)", head(), (res, log) => (attempt(log, () => res.end(123)), res.end("x"))],
    ["an unknown encoding", head(), (res, log) => (attempt(log, () => res.end("a", "nope" as any)), res.end("x"))],
    ["write() and end()", head(), (res, log) => (log(res.write("a")), log(res.write("bc")), res.end("d"))],
    ["an empty write()", head(), (res, log) => (log(res.write("")), log(res.headersSent), res.end("d"))],
    ["callbacks", head(), (res, log) => log(res.write("a", error => (log(error), res.end("b", () => log("ended")))))],
    ["writeHead()", head(), res => res.writeHead(299, "Custom", ["a", "1", "a", "2"]).end("x")],
    ["a status without a name", head(), res => ((res.statusCode = 299), res.end("x"))],
    ["a Latin-1 status message", head(), res => ((res.statusMessage = "é"), res.end("x"))],
    [
      "a status message with a line break",
      head(),
      (res, log) => {
        res.statusMessage = "a\r\nb: c";
        attempt(log, () => res.end("x"));
        res.statusMessage = "ok";
        res.end("y");
      },
    ],
    ["a Latin-1 header", head(), res => res.setHeader("a", "é").end("x")],
    ["a header in a 16-bit string", head(), res => res.setHeader("a", "é€".slice(0, 1)).end("x")],
    ["a head of 32 KiB", head(), res => res.setHeader("a", Buffer.alloc(32 * 1024, "x").toString()).end("x")],
    [
      "Content-Disposition",
      head(),
      res => res.setHeader("Content-Disposition", "inline; filename=é").setHeader("Content-Length", 1).end("x"),
    ],
    ["Set-Cookie", head(), res => res.setHeader("Set-Cookie", ["a=1", "b=2"]).end("x")],
    ["uniqueHeaders", head(), res => res.setHeader("a", ["1", "2"]).end("x"), { uniqueHeaders: ["a"] }],
    [
      "setHeader() after write()",
      head(),
      (res, log) => (res.write("a"), attempt(log, () => res.setHeader("a", "b")), res.end()),
    ],
    ["204", head(), res => res.writeHead(204).end("x")],
    ["204 with Transfer-Encoding", head(), res => res.writeHead(204, { "Transfer-Encoding": "chunked" }).end()],
    ["304 with Content-Length", head(), res => res.writeHead(304, { "Content-Length": 9 }).end()],
    ["HEAD", head("HEAD"), res => (res.write("a"), res.end("b"))],
    ["HTTP/1.0", head("GET", "", "1.0"), res => (res.write("a"), res.end("b"))],
    ["HTTP/1.0 with TE", head("GET", "TE: chunked\r\n", "1.0"), res => (res.write("a"), res.end("b"))],
    ["a request that says close", head("GET", "Connection: close\r\n"), res => res.end("x")],
    ["a response that says close", head(), res => res.setHeader("Connection", "close").end("x")],
    ["shouldKeepAlive = false", head(), res => ((res.shouldKeepAlive = false), res.end("x"))],
    ["Connection removed", head(), res => (res.removeHeader("Connection"), res.end("x"))],
    ["Content-Length removed", head(), res => (res.removeHeader("Content-Length"), res.end("x"))],
    ["Transfer-Encoding removed", head(), res => (res.removeHeader("Transfer-Encoding"), res.end("x"))],
    ["Transfer-Encoding: gzip", head(), res => res.setHeader("Transfer-Encoding", "gzip").end("x")],
    ["trailers behind write()", head(), res => (res.write("x"), res.addTrailers({ a: "é" }), res.end())],
    ["trailers behind end()", head(), res => (res.addTrailers({ a: "1" }), res.end("x"))],
    ["Expect: 100-continue", head("POST", "Expect: 100-continue\r\nContent-Length: 2\r\n") + "hi", res => res.end("x")],
    [
      "103",
      head(),
      (res, log) => (res.writeEarlyHints({ link: "</a>; rel=preload" }, () => log("sent")), res.end("x")),
    ],
    ["writeContinue()", head(), (res, log) => (res.writeContinue(() => log("sent")), res.end("x"))],
    ["flushHeaders()", head(), res => (res.flushHeaders(), res.end("x"))],
    [
      "cork()",
      head(),
      async (res, log) => {
        res.cork();
        log(res.writableCorked);
        res.write("a");
        if (!res.socket) await once(res, "socket");
        log(res.writableCorked);
        res.uncork();
        log(res.writableCorked);
        res.end("b");
      },
    ],
    [
      "strictContentLength",
      head(),
      (res, log) => {
        res.strictContentLength = true;
        res.writeHead(200, { "Content-Length": 2 });
        attempt(log, () => res.write("xyz"));
        attempt(log, () => res.end("x"));
        res.end("xy");
      },
    ],
    [
      "write() and end() replaced",
      head(),
      (res, log) => {
        for (const name of ["writeHead", "write", "end"]) {
          const original = res[name];
          res[name] = function () {
            log(name);
            return original.apply(this, arguments);
          };
        }
        res.write("a");
        res.end("b");
      },
    ],
    ["a subclass that drops the options", head(), res => res.end("x"), { ServerResponse: WithoutOptions as any }],
    ["a body that is piped back", post, (res, _, req) => req.pipe(res)],
    ["a body that nothing reads", post, res => res.end("x")],
    ["a large end()", head(), res => res.end(Buffer.alloc(4 * 1024 * 1024, "x"))],
    [
      "a large write()",
      head(),
      (res, log) => {
        log(res.write(Buffer.alloc(4 * 1024 * 1024, "x")));
        log(res.writableNeedDrain);
        res.on("drain", () => (log(`drain ${res.writableLength}`), res.end("y")));
      },
    ],
    [
      "a buffer that is transferred after write()",
      head(),
      res => {
        const bytes = new Uint8Array(100).fill(120);
        res.writeHead(200, { "Content-Length": 100 }).write(bytes);
        bytes.buffer.transfer();
        res.end();
      },
    ],
  ];

  const AHEAD = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n";
  async function exchange(waits: boolean, request: string, handler: Handler, options: ServerOptions = {}) {
    const log: string[] = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers<Socket>();
    const listener = (req: IncomingMessage, res: ServerResponse) => {
      res.sendDate = false;
      if (req.url === "/ahead") return void setImmediate(() => res.writeHead(200, { "Content-Length": 0 }).end());
      if (req.url === "/reused") return void res.end("reused");
      expect(res.socket === null).toBe(waits);
      for (const event of ["prefinish", "finish", "close"]) res.on(event, () => log.push(event));
      res.on("close", () => onClose(req.socket));
      handler(res, entry => log.push(String(entry)), req);
    };
    options = { keepAliveTimeout: 0, ...options };
    using client = await connectTo(
      protocol === "https" ? createHttpsServer({ ...tlsCert, ...options }, listener) : createServer(options, listener),
      protocol === "https",
    );
    client.socket.write((waits ? get("/ahead") : "") + request);
    // A write to a closed connection is answered with a reset, for which Windows drops what the client hasn't read yet.
    if (!(await closed).destroyed) client.socket.write(get("/reused", "Connection: close\r\n"));
    const received = await client.until();
    return { received: received.replace(/x{100,}/g, run => `<${run.length} x>`), log };
  }

  for (const [name, request, handler, options] of cases) {
    test.concurrent(name, async () => {
      const [atOnce, waited] = await Promise.all(
        [false, true].map(waits => exchange(waits, request, handler, options)),
      );
      expect(atOnce.received).toStartWith("HTTP/1.1 ");
      expect(waited).toEqual({ received: AHEAD + atOnce.received, log: atOnce.log });
    });
  }
});

describe("a response that waits for the connection", () => {
  test("emits its events in Node's order", async () => {
    const events: string[] = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    using client = await connectTo(
      createServer((req, res) => {
        for (const event of ["socket", "prefinish", "drain", "finish", "close"]) {
          res.on(event, () => events.push(`${req.url} ${event}`));
        }
        if (req.url === "/1") return void setImmediate(() => res.end());
        res.on("close", onClose);
        res.write("a", () => events.push("write()"));
        res.end("b", () => events.push("end()"));
        events.push("returned");
      }),
    );
    client.socket.write(get("/1") + get("/2"));
    await closed;
    expect(events).toEqual([
      "returned",
      "/1 prefinish",
      "/2 socket",
      "/2 prefinish",
      "/1 finish",
      "/1 close",
      "write()",
      "/2 finish",
      "end()",
      "/2 close",
    ]);
  });

  test("sends what a 'socket' listener writes behind what it held", async () => {
    using client = await connectTo(
      createServer((req, res) => {
        if (req.url === "/1") return void setImmediate(() => res.end());
        res.write("held,");
        res.on("socket", () => res.end("late"));
      }),
    );
    client.socket.write(get("/1") + get("/2", "Connection: close\r\n"));
    expect(await client.until()).toEndWith("\r\n\r\n5\r\nheld,\r\n4\r\nlate\r\n0\r\n\r\n");
  });

  test("calls back in the async context of its own request", async () => {
    const storage = new AsyncLocalStorage<string>();
    const seen: string[] = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    using client = await connectTo(
      createServer((req, res) =>
        storage.run(req.url!, () => {
          if (req.url === "/1") return void setImmediate(() => res.end());
          res.on("finish", () => seen.push(`finish ${storage.getStore()}`)).on("close", onClose);
          res.write("a", () => seen.push(`write() ${storage.getStore()}`));
          res.end(() => seen.push(`end() ${storage.getStore()}`));
        }),
      ),
    );
    client.socket.write(get("/1") + get("/2"));
    await closed;
    expect(seen).toEqual(["write() /2", "finish /2", "end() /2"]);
  });

  test("keeps the buffers it was given alive, and lets go of them when the client leaves", async () => {
    const buffers: WeakRef<Buffer>[] = [];
    const responses: ServerResponse[] = [];
    const { promise: dispatched, resolve: onDispatched } = Promise.withResolvers<void>();
    using client = await connectTo(
      createServer((req, res) => {
        responses.push(res);
        if (req.url === "/ahead") return;
        // All of them stay under the high water mark (16 KB on Windows). Over it the server stops reading and doesn't see the client leave.
        const buffer = Buffer.allocUnsafeSlow(256);
        buffers.push(new WeakRef(buffer));
        res.end(buffer);
        if (buffers.length === 20) onDispatched();
      }),
    );
    const alive = async () => {
      await turn();
      Bun.gc(true);
      return buffers.filter(buffer => buffer.deref() !== undefined).length;
    };
    client.socket.write(get("/ahead") + get("/held").repeat(20));
    await dispatched;
    expect(await alive()).toBe(20);
    client.socket.destroy();
    await Promise.all(responses.map(res => once(res, "close")));
    expect(await alive()).toBe(0);
  });

  test("is answered in order among 2,000 that end in reverse", async () => {
    const count = 2000;
    const responses: ServerResponse[] = [];
    using client = await connectTo(
      createServer((req, res) => {
        if (responses.push(res) < count) return;
        for (let i = count - 1; i >= 0; i--) responses[i].end(`<${i}>`);
      }),
    );
    client.socket.write(get("/").repeat(count));
    const received = await client.until(received => received.endsWith(`<${count - 1}>`));
    expect(received.match(/<\d+>/g)).toEqual(Array.from({ length: count }, (_, i) => `<${i}>`));
  });
});

describe("a connection that is handed over with responses still owed", () => {
  const upgrade = "Connection: Upgrade\r\nUpgrade: websocket\r\n";

  test("'upgrade' gets the socket and the rest of the read, behind the responses ahead", async () => {
    const responses: ServerResponse[] = [];
    const { promise: sent, resolve: onSent } = Promise.withResolvers<void>();
    const server = createServer((req, res) => void responses.push(res.on("close", onSent)));
    server.on("upgrade", (req, socket, rest) => {
      let tunneled = rest.toString();
      socket.on("data", chunk => (tunneled += chunk)).on("end", () => socket.end(`<${req.url} ${tunneled}>`));
      responses[1].end("<2>");
      responses[0].end("<1>");
    });
    using client = await connectTo(server);
    client.socket.write(get("/1") + get("/2") + get("/up", upgrade) + "GET /not-http HTTP/1.1\r\n\r\n");
    await client.until(received => received.endsWith("<2>"));
    await sent;
    server.closeIdleConnections();
    client.socket.end("later");
    expect((await client.until()).match(/<[^>]*>/g)).toEqual([
      "<1>",
      "<2>",
      "</up GET /not-http HTTP/1.1\r\n\r\nlater>",
    ]);
  });

  test("an Upgrade request with a body is answered as a request", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/1") setImmediate(() => res.end("<1>"));
      else req.pipe(res);
    });
    server.on("upgrade", (_, socket) => socket.end("<upgraded>"));
    using client = await connectTo(server);
    client.socket.write(get("/1") + head("POST", `${upgrade}Content-Length: 3\r\n`) + "<2>");
    const received = await client.until(received => received.endsWith("0\r\n\r\n"));
    expect(received.match(/<[^>]*>/g)).toEqual(["<1>", "<2>"]);
  });

  test("ws upgrades behind a response that still drains", async () => {
    const size = 32 * 1024 * 1024;
    const { promise: ended, resolve: onEnded } = Promise.withResolvers<void>();
    const { promise: opened, resolve: onOpened } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      res.end(Buffer.alloc(size, "x"));
      // The second call is the Upgrade request, answered as a request.
      onEnded();
      if (req.url === "/ws") onOpened();
    });
    const wss = new WebSocketServer({ server });
    wss.on("connection", ws => {
      ws.on("message", data => ws.send(`echo ${data}`));
      onOpened();
    });
    using client = await connectTo(server);
    client.socket.pause().write(get("/large"));
    await ended;
    client.socket.write(
      get("/ws", `${upgrade}Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n`),
    );
    await opened;
    client.socket.resume();
    const handshake = (await client.until(received => received.length > size && received.endsWith("\r\n\r\n"))).slice(
      -200,
    );
    expect(handshake.replace(/^x+/, "")).toStartWith("HTTP/1.1 101 ");
    client.socket.write(Buffer.from([0x81, 0x82, 0, 0, 0, 0, 104, 105]));
    expect((await client.until(received => received.endsWith("echo hi"))).slice(-9)).toBe("\x81\x07echo hi");
    wss.close();
  });

  test("a TLSSocket can be made over the socket of 'connect'", async () => {
    let ahead: ServerResponse;
    const server = createServer((_, res) => void (ahead = res));
    server.on("connect", (_, socket) => {
      const secure = new TLSSocket(socket as Socket, { isServer: true, ...tlsCert });
      secure.on("error", () => {}).on("data", chunk => secure.end(`echo ${chunk}`));
      secure.on("close", () => socket.destroy());
      setImmediate(() => ahead.end("<1>"));
    });
    using client = await connectTo(server);
    client.socket.write(get("/1") + "CONNECT a:1 HTTP/1.1\r\nHost: a:1\r\n\r\n");
    expect(await client.until(received => received.endsWith("<1>"))).toEndWith("<1>");
    client.socket.removeAllListeners("data");
    const tunnel = tlsConnect({ socket: client.socket, ca: tlsCert.cert, servername: "localhost" });
    tunnel.write("hi");
    expect(String((await once(tunnel, "data"))[0])).toBe("echo hi");
    tunnel.destroy();
  });
});

test("the 503 for a request over maxRequestsPerSocket waits for the responses ahead of it", async () => {
  const server = createServer((_, res) => void setImmediate(() => res.end()));
  server.maxRequestsPerSocket = 2;
  using client = await connectTo(server);
  client.socket.write(get("/").repeat(3));
  expect((await client.until()).match(/^HTTP\/1\.1 \d+/gm)).toEqual(["HTTP/1.1 200", "HTTP/1.1 200", "HTTP/1.1 503"]);
});
