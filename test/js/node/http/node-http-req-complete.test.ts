/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * llhttp completes a message without a body right after the callback that
 * runs the listener, so Node sets req.complete there while nothing reads req:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_common.js#L143-L163
 */
import assert from "node:assert";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { pipeline, Writable } from "node:stream";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

type Seen = Record<string, boolean>;

async function withServer(server: http.Server, run: (port: number) => Promise<void>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// Raw bytes, so that the request is exactly what the test says it is.
function send(port: number, payload: string, onError: (err: Error) => void) {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", onError);
  socket.write(payload);
  return socket;
}

describe("req.complete of a request without a body", () => {
  const head = "GET / HTTP/1.1\r\nHost: x\r\n";
  const cases: [name: string, event: string, payload: string, options: object][] = [
    ["'request' for a GET", "request", head + "\r\n", {}],
    ["'request' for a HEAD", "request", "HEAD / HTTP/1.1\r\nHost: x\r\n\r\n", {}],
    ["'request' for an empty POST", "request", "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n", {}],
    ["'request' with optimizeEmptyRequests", "request", head + "\r\n", { optimizeEmptyRequests: true }],
    ["'checkContinue'", "checkContinue", head + "Expect: 100-continue\r\n\r\n", {}],
    ["'checkExpectation'", "checkExpectation", head + "Expect: meow\r\n\r\n", {}],
  ];
  for (const [name, event, payload, options] of cases) {
    test(`is false inside ${name} and true once the listener returns`, async () => {
      const seen: Seen = {};
      const { promise: finished, resolve: onFinish, reject } = Promise.withResolvers<void>();
      const server = http.createServer(options);
      server.on(event, (req: http.IncomingMessage, res: http.ServerResponse) => {
        seen.listener = req.complete;
        process.nextTick(() => (seen.nextTick = req.complete));
        res.on("finish", () => {
          seen.finish = req.complete;
          onFinish();
        });
        // res.end() dumps req, so sample once more before it runs.
        setImmediate(() => {
          seen.immediate = req.complete;
          res.end();
        });
      });
      await withServer(server, async port => {
        send(port, payload, reject);
        await finished;
      });
      assert.deepStrictEqual(seen, { listener: false, nextTick: true, immediate: true, finish: true });
    });
  }

  // llhttp completes these at the end of the head, and Node emits the event after the parser returns.
  for (const [event, payload] of [
    ["connect", "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"],
    ["upgrade", head + "Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n"],
  ]) {
    test(`is true inside '${event}'`, async () => {
      const { promise: seen, resolve: onSeen, reject } = Promise.withResolvers<boolean>();
      const server = http.createServer();
      server.on(event, (req: http.IncomingMessage, socket: Socket) => {
        onSeen(req.complete);
        socket.destroy();
      });
      await withServer(server, async port => {
        send(port, payload, reject);
        assert.strictEqual(await seen, true);
      });
    });
  }

  test("with optimizeEmptyRequests, the parser lets go of the request when its response finishes", async () => {
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<boolean>();
    const server = http.createServer({ optimizeEmptyRequests: true } as http.ServerOptions, (req, res) => {
      const parser = (req.socket as any).parser;
      res.on("close", () => onClose(parser.incoming === req));
      res.end("ok");
    });
    await withServer(server, async port => {
      send(port, head + "\r\n", reject);
      assert.strictEqual(await closed, false);
    });
  });

  test("is true for a request that is pipelined behind a pending response", async () => {
    const seen: Record<string, Seen> = {};
    const { promise: finished, resolve: onFinish, reject } = Promise.withResolvers<void>();
    let pending = 2;
    const server = http.createServer((req, res) => {
      const entry: Seen = (seen[req.url!] = { listener: req.complete });
      process.nextTick(() => (entry.nextTick = req.complete));
      res.on("finish", () => --pending === 0 && onFinish());
      setImmediate(() => res.end());
    });
    await withServer(server, async port => {
      send(port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\nGET /2 HTTP/1.1\r\nHost: x\r\n\r\n", reject);
      await finished;
    });
    assert.deepStrictEqual(seen, {
      "/1": { listener: false, nextTick: true },
      "/2": { listener: false, nextTick: true },
    });
  });

  test("is true in 'dropRequest' listeners once they return", async () => {
    const seen: Seen = {};
    const { promise: dropped, resolve: onDropped, reject } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => res.end());
    server.maxRequestsPerSocket = 1;
    server.on("dropRequest", (req: http.IncomingMessage) => {
      seen.listener = req.complete;
      process.nextTick(() => {
        seen.nextTick = req.complete;
        onDropped();
      });
    });
    await withServer(server, async port => {
      // The server destroys the connection after the 503. By then `dropped` has settled.
      send(port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\nGET /2 HTTP/1.1\r\nHost: x\r\n\r\n", reject);
      await dropped;
    });
    assert.deepStrictEqual(seen, { listener: false, nextTick: true });
  });

  test("stays true when the client goes away before the response ends", async () => {
    // What req.complete is for: telling a request that arrived in full from
    // one that was cut short. A long-lived response (SSE, long polling) to a
    // GET sees the first kind.
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<Seen>();
    const server = http.createServer((req, res) => {
      req.on("close", () => onClose({ complete: req.complete, aborted: req.aborted }));
      res.write("data: hi\n\n");
    });
    let seen: Seen | undefined;
    await withServer(server, async port => {
      const socket = send(port, head + "\r\n", reject);
      socket.once("data", () => socket.destroy());
      seen = await closed;
    });
    assert.deepStrictEqual(seen, { complete: true, aborted: true });
  });
});

test("req.complete stays false while a declared body is still arriving", async () => {
  const seen: Seen = {};
  const { promise: dispatched, resolve: onDispatched } = Promise.withResolvers<void>();
  const { promise: ended, resolve: onEnd, reject } = Promise.withResolvers<void>();
  const server = http.createServer((req, res) => {
    seen.listener = req.complete;
    process.nextTick(() => {
      seen.nextTick = req.complete;
      onDispatched();
    });
    req.on("end", () => {
      seen.end = req.complete;
      res.end();
      onEnd();
    });
    req.resume();
  });
  await withServer(server, async port => {
    const socket = send(port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhe", reject);
    await dispatched;
    socket.write("llo");
    await ended;
  });
  assert.deepStrictEqual(seen, { listener: false, nextTick: false, end: true });
});

// A write larger than the uWS cork buffer releases the cork, so the response that closes the connection is out before the body is parsed.
for (const respond of ["write() and end()", "end(chunk)"]) {
  test(`a Connection: close response by ${respond} does not drop the body that came with the head`, async () => {
    const events: string[] = [];
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => events.push(`end ${body}`));
      req.on("close", () => {
        events.push(`close ${req.complete}`);
        onClose();
      });
      const chunk = Buffer.alloc(20 * 1024, "x");
      if (respond === "end(chunk)") {
        res.end(chunk);
      } else {
        res.write(chunk);
        res.end();
      }
    });
    await withServer(server, async port => {
      send(port, "POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 5\r\n\r\nhello", reject).resume();
      await closed;
    });
    assert.deepStrictEqual(events, ["end hello", "close true"]);
  });
}

test("res.end() on a socket that the listener destroyed does not finish the response", async () => {
  const events: string[] = [];
  const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
  const server = http.createServer((req, res) => {
    req.on("aborted", () => events.push("req aborted"));
    req.on("error", (err: NodeJS.ErrnoException) => events.push(`req error ${err.code}`));
    req.on("close", () => {
      events.push("req close");
      onClose();
    });
    res.on("finish", () => events.push("res finish"));
    req.socket.destroy();
    res.end("hi");
  });
  await withServer(server, async port => {
    send(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n", () => {});
    await closed;
  });
  assert.deepStrictEqual(events, ["req aborted", "req error ECONNRESET", "req close"]);
});

// llhttp frames a body by Content-Length and Transfer-Encoding, whatever the method is.
for (const method of ["HEAD", "OPTIONS", "GET"]) {
  test(`a ${method} request with Content-Length has a body`, async () => {
    const seen: Record<string, unknown> = {};
    const { promise: dispatched, resolve: onDispatched } = Promise.withResolvers<void>();
    const { promise: ended, resolve: onEnd, reject } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        Object.assign(seen, { body, end: req.complete });
        res.end();
        onEnd();
      });
      process.nextTick(() => {
        seen.nextTick = req.complete;
        onDispatched();
      });
    });
    await withServer(server, async port => {
      const socket = send(port, `${method} / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\n`, reject);
      await dispatched;
      socket.write("hello");
      await ended;
    });
    assert.deepStrictEqual(seen, { nextTick: false, body: "hello", end: true });
  });
}

for (const path of ["the listener of the server", "emit('connection')"]) {
  test(`res.end(chunk) after the client went away ends the response and does not finish it (${path})`, async () => {
    const { promise: sampled, resolve: onSampled } = Promise.withResolvers<unknown>();
    const events: string[] = [];
    const server = http.createServer((req, res) => {
      res.on("prefinish", () => events.push("prefinish"));
      res.on("finish", () => events.push("finish"));
      res.on("close", () => {
        res.end("late", () => events.push("end callback"));
        // 'finish' and the callback would come on a later tick. The close of the server is behind them.
        const { finished, writableEnded, writableFinished } = res;
        front.close(() => onSampled({ events, finished, writableEnded, writableFinished }));
      });
      client.destroy();
    });
    const front = path === "emit('connection')" ? createNetServer(socket => server.emit("connection", socket)) : server;
    front.listen(0, "127.0.0.1");
    await once(front, "listening");
    const client = send((front.address() as AddressInfo).port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n", () => {});
    assert.deepStrictEqual(await sampled, {
      events: ["prefinish"],
      finished: true,
      writableEnded: true,
      writableFinished: true,
    });
  });
}

describe("a connection given to the server with emit('connection')", () => {
  async function withForwarder(server: http.Server, run: (port: number) => Promise<void>, onRead = () => {}) {
    const forwarder = createNetServer(socket => {
      server.emit("connection", socket);
      // Runs after the listener of the parser, so the request has taken the chunk.
      socket.on("data", onRead);
    });
    forwarder.listen(0, "127.0.0.1");
    await once(forwarder, "listening");
    try {
      await run((forwarder.address() as AddressInfo).port);
    } finally {
      forwarder.close();
    }
  }

  test("a request that nobody reads ends and closes after its response", async () => {
    const events: string[] = [];
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      req.on("end", () => events.push("end"));
      req.on("close", () => {
        events.push("close");
        onClose();
      });
      res.end("ok");
    });
    await withForwarder(server, async port => {
      send(port, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", reject).resume();
      await closed;
    });
    assert.deepStrictEqual(events, ["end", "close"]);
  });

  test("a body that the listener reads is complete when the response ends first", async () => {
    const { promise: responded, resolve: onResponse } = Promise.withResolvers<void>();
    const { promise: ended, resolve: onEnd, reject } = Promise.withResolvers<string>();
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => {
        body += chunk;
        if (!res.writableEnded) res.end("ok");
      });
      req.on("end", () => onEnd(body));
    });
    await withForwarder(server, async port => {
      const socket = send(port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nhello", reject);
      socket.once("data", () => onResponse());
      await responded;
      socket.end("world");
      assert.strictEqual(await ended, "helloworld");
    });
  });

  test("a body that nobody reads is dropped, not buffered", async () => {
    const length = 4 * 1024 * 1024;
    const { promise: ended, resolve: onEnd, reject } = Promise.withResolvers<void>();
    let request: http.IncomingMessage | undefined;
    let mostHeld = 0;
    const server = http.createServer((req, res) => {
      request = req;
      req.on("end", onEnd);
      res.end("ok");
    });
    await withForwarder(
      server,
      async port => {
        const socket = send(port, `POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${length}\r\n\r\n`, reject);
        socket.resume();
        socket.end(Buffer.alloc(length, "x"));
        await ended;
      },
      () => (mostHeld = Math.max(mostHeld, request?.readableLength ?? 0)),
    );
    assert.ok(mostHeld < length / 4, `the request held ${mostHeld} of ${length} bytes`);
  });
});

for (const expectation of ["100-continue", "something-else"]) {
  test(`an HTTP/1.0 request with Expect: ${expectation} is a plain request`, async () => {
    const events: string[] = [];
    const server = http.createServer((req, res) => {
      events.push("request");
      req.resume();
      res.end("ok");
    });
    server.on("checkContinue", () => events.push("checkContinue"));
    server.on("checkExpectation", () => events.push("checkExpectation"));
    await withServer(server, async port => {
      const { promise: failed, reject } = Promise.withResolvers<never>();
      const socket = send(port, `POST / HTTP/1.0\r\nExpect: ${expectation}\r\nContent-Length: 2\r\n\r\nhi`, reject);
      let received = "";
      socket.on("data", chunk => (received += chunk));
      await Promise.race([once(socket, "close"), failed]);
      assert.deepStrictEqual(
        { events, status: received.split("\r\n")[0] },
        { events: ["request"], status: "HTTP/1.1 200 OK" },
      );
    });
  });
}

// The stream destroyer destroys the request and keeps its connection, so the parser still completes the message.
describe("a request that the stream destroyer destroyed", () => {
  const consumers: [name: string, consume: (req: http.IncomingMessage) => Promise<unknown>][] = [
    [
      "a for await loop that breaks",
      async req => {
        for await (const _ of req) break;
      },
    ],
    [
      "a pipeline() that fails",
      req => {
        const { promise, resolve } = Promise.withResolvers<unknown>();
        const refuses = new Writable({ write: (_chunk, _encoding, callback) => callback(new Error("refused")) });
        pipeline(req, refuses, resolve);
        return promise;
      },
    ],
  ];
  const bodies: [framing: string, headers: string, start: string, rest: string][] = [
    ["Content-Length", "Content-Length: 10\r\n", "hello", "world"],
    ["chunked", "Transfer-Encoding: chunked\r\n", "5\r\nhello\r\n", "5\r\nworld\r\n0\r\n\r\n"],
  ];

  // until() rejects when the connection fails or closes before `text` came.
  function open(port: number, payload: string) {
    const { promise: gone, reject } = Promise.withResolvers<never>();
    // The connection also closes at the end of a test, when nothing waits.
    gone.catch(() => {});
    const socket = send(port, payload, reject);
    socket.on("close", () => reject(new Error("the connection closed")));
    let received = "";
    socket.on("data", chunk => (received += chunk));
    return {
      socket,
      gone,
      async until(text: string) {
        while (!received.endsWith(text)) await Promise.race([once(socket, "data"), gone]);
      },
    };
  }

  for (const [name, consume] of consumers) {
    for (const [framing, headers, start, rest] of bodies) {
      test(`req.complete is true once the ${framing} body ends, after ${name}`, async () => {
        const seen: Seen = {};
        let first: http.IncomingMessage | undefined;
        const server = http.createServer(async (req, res) => {
          if (req.url === "/second") {
            // The parser is past the body of the first request here.
            seen.afterBody = first!.complete;
            res.end("second");
            return;
          }
          first = req;
          await consume(req);
          seen.destroyed = req.destroyed;
          res.end("first");
        });
        await withServer(server, async port => {
          const client = open(port, `POST /first HTTP/1.1\r\nHost: x\r\n${headers}\r\n${start}`);
          await client.until("first");
          seen.atResponse = first!.complete;
          client.socket.write(rest + "GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
          await client.until("second");
        });
        assert.deepStrictEqual(seen, { destroyed: true, atResponse: false, afterBody: true });
      });
    }

    test(`has the trailers of its chunked body once the body ends, after ${name}`, async () => {
      let first: http.IncomingMessage | undefined;
      let seen: unknown;
      const server = http.createServer(async (req, res) => {
        if (req.url === "/second") {
          seen = { trailers: { ...first!.trailers }, rawTrailers: first!.rawTrailers };
          res.end("second");
          return;
        }
        first = req;
        await consume(req);
        res.end("first");
      });
      await withServer(server, async port => {
        const head = "POST /first HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nTrailer: X-Checksum\r\n\r\n";
        const client = open(port, head + "5\r\nhello\r\n");
        await client.until("first");
        client.socket.write("5\r\nworld\r\n0\r\nX-Checksum: abc\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\n\r\n");
        await client.until("second");
      });
      assert.deepStrictEqual(seen, { trailers: { "x-checksum": "abc" }, rawTrailers: ["X-Checksum", "abc"] });
    });

    test(`req.complete stays false when the client goes away before the body ends, after ${name}`, async () => {
      let first: http.IncomingMessage | undefined;
      const { promise: connectionClosed, resolve: onConnectionClose } = Promise.withResolvers<void>();
      const server = http.createServer(async (req, res) => {
        first = req;
        await consume(req);
        res.end("first");
      });
      server.on("connection", connection => connection.on("close", () => onConnectionClose()));
      await withServer(server, async port => {
        const client = open(port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nhello");
        await client.until("first");
        client.socket.destroy();
        await connectionClosed;
      });
      assert.deepStrictEqual(
        { destroyed: first!.destroyed, complete: first!.complete },
        { destroyed: true, complete: false },
      );
    });
  }

  // The response of this request waits behind an earlier response, so the connection has another current response.
  test("req.complete is true once the body of a pipelined request ends, after a for await loop that breaks", async () => {
    let pipelined: http.IncomingMessage | undefined;
    let release = () => {};
    const { promise: held, resolve: onHeld } = Promise.withResolvers<void>();
    const { promise: destroyed, resolve: onDestroyed } = Promise.withResolvers<void>();
    const seen: Record<string, unknown> = {};
    const server = http.createServer(async (req, res) => {
      if (req.url === "/held") {
        release = () => res.end("held");
        onHeld();
        return;
      }
      if (req.url === "/second") {
        seen.afterBody = { complete: pipelined!.complete, trailers: { ...pipelined!.trailers } };
        res.end("second");
        return;
      }
      pipelined = req;
      seen.queued = res.socket === null;
      for await (const _ of req) break;
      seen.atResponse = { destroyed: req.destroyed, complete: req.complete };
      res.end("pipelined");
      onDestroyed();
    });
    await withServer(server, async port => {
      const client = open(port, "GET /held HTTP/1.1\r\nHost: x\r\n\r\n");
      await Promise.race([held, client.gone]);
      const head = "POST /pipelined HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nTrailer: X-Checksum\r\n\r\n";
      client.socket.write(head + "5\r\nhello\r\n");
      await Promise.race([destroyed, client.gone]);
      release();
      await client.until("pipelined");
      client.socket.write("5\r\nworld\r\n0\r\nX-Checksum: abc\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\n\r\n");
      await client.until("second");
    });
    assert.deepStrictEqual(seen, {
      queued: true,
      atResponse: { destroyed: true, complete: false },
      afterBody: { complete: true, trailers: { "x-checksum": "abc" } },
    });
  });
});

// Node's parser holds a connection from the first byte of a request to the end of that message, and
// closeIdleConnections() leaves a connection that a parser holds. req.complete turns true at that same point.
describe("server.closeIdleConnections() from the listener of a request", () => {
  type Place = (sweep: () => void, req: http.IncomingMessage, res: http.ServerResponse) => unknown;
  const places: [name: string, place: Place][] = [
    ["before res.end()", (sweep, req, res) => (sweep(), res.end(req.url))],
    ["after res.end()", (sweep, req, res) => (res.end(req.url), sweep())],
    ["before a response that ends later", (sweep, req, res) => (sweep(), setImmediate(() => res.end(req.url)))],
    ["process.nextTick", (sweep, req, res) => (res.end(req.url), process.nextTick(sweep))],
    ["queueMicrotask", (sweep, req, res) => (res.end(req.url), queueMicrotask(sweep))],
    [
      "after an await",
      async (sweep, req, res) => {
        res.end(req.url);
        await null;
        sweep();
      },
    ],
    ["setImmediate", (sweep, req, res) => (res.end(req.url), setImmediate(sweep))],
    ["the 'finish' listener of the response", (sweep, req, res) => res.on("finish", sweep).end(req.url)],
    ["the callback of res.end()", (sweep, req, res) => res.end(req.url, sweep)],
    ["the 'data' listener of the request", (sweep, req, res) => (res.end(req.url), req.once("data", sweep))],
    ["the 'end' listener of the request", (sweep, req, res) => (res.end(req.url), req.on("end", sweep).resume())],
  ];
  const atEnd = "the 'end' listener of the request";
  const withoutBody = [
    "process.nextTick",
    "queueMicrotask",
    "after an await",
    "setImmediate",
    "the 'finish' listener of the response",
    "the callback of res.end()",
    atEnd,
  ];
  const head = "/sweep HTTP/1.1\r\nHost: x\r\n";
  const chunks = "5\r\nhello\r\n0\r\n\r\n";
  // What the client sends, in one part or in two, and the places where the server then closes the connection.
  const shapes: [name: string, parts: string[], closed: string[]][] = [
    ["a GET in one read", [`GET ${head}\r\n`], withoutBody],
    ["a GET whose head comes in two reads", [`GET ${head.slice(0, 20)}`, `${head.slice(20)}\r\n`], withoutBody],
    [
      "a Content-Length body in the read of the head",
      [`POST ${head}Content-Length: 5\r\n\r\nhello`],
      ["setImmediate", atEnd],
    ],
    ["a Content-Length body in a later read", [`POST ${head}Content-Length: 5\r\n\r\n`, "hello"], [atEnd]],
    [
      "a chunked body in the read of the head",
      [`POST ${head}Transfer-Encoding: chunked\r\n\r\n${chunks}`],
      ["setImmediate", atEnd],
    ],
    ["a chunked body in a later read", [`POST ${head}Transfer-Encoding: chunked\r\n\r\n`, chunks], [atEnd]],
  ];
  // Bun answers the next request there, so "kept": uWS still has a chunked body open in the callback of its last chunk.
  const todoInBun = (shape: string, place: string) =>
    typeof Bun !== "undefined" && shape.includes("chunked") && place === atEnd;

  function connection(port: number, payload: string) {
    const socket = send(port, payload, () => {});
    let received = "";
    let changed = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<"closed">();
    socket.on("data", chunk => {
      received += chunk;
      changed.resolve();
      changed = Promise.withResolvers<void>();
    });
    socket.on("close", () => closed.resolve("closed"));
    return {
      socket,
      closed: closed.promise,
      // "closed" when the server closed the connection and the response that ends with `text` did not come.
      async until(text: string) {
        while (!received.endsWith(text)) {
          if ((await Promise.race([changed.promise, closed.promise])) === "closed") return "closed";
        }
        return "answered";
      },
    };
  }

  // One connection: the listener of its request calls the sweep at `place`, and then it sends one more request.
  async function sweepAt(parts: string[], place: Place) {
    const { promise: swept, resolve: onSwept } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      if (req.url !== "/sweep") return void res.end(req.url);
      const sweep = () => {
        server.closeIdleConnections();
        onSwept();
      };
      return place(sweep, req, res);
    });
    server.keepAliveTimeout = 60000;
    let outcome = "";
    await withServer(server, async port => {
      const client = connection(port, parts[0]);
      if (parts.length > 1) {
        // One round trip on another connection: the server has read the first part by then.
        const barrier = connection(port, "GET /barrier HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        await barrier.until("/barrier");
        barrier.socket.destroy();
        client.socket.write(parts[1]);
      }
      if ((await Promise.race([swept, client.closed])) === "closed") {
        outcome = "closed before the sweep";
      } else {
        client.socket.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
        outcome = (await client.until("/second")) === "answered" ? "kept" : "closed";
      }
      client.socket.destroy();
    });
    return outcome;
  }

  for (const [name, parts, closed] of shapes) {
    const hasBody = parts.join("").startsWith("POST");
    const applicable = places.filter(([place]) => hasBody || place !== "the 'data' listener of the request");
    const expected = (place: string) => (closed.includes(place) ? "closed" : "kept");
    const rows = applicable.filter(([place]) => !todoInBun(name, place));
    test(name, async () => {
      const outcomes = await Promise.all(rows.map(([, place]) => sweepAt(parts, place)));
      assert.deepStrictEqual(
        Object.fromEntries(rows.map(([place], i) => [place, outcomes[i]])),
        Object.fromEntries(rows.map(([place]) => [place, expected(place)])),
      );
    });
    for (const [place, run] of applicable.filter(([place]) => todoInBun(name, place))) {
      test(`${name}, ${place}`, { todo: true }, async () => {
        assert.strictEqual(await sweepAt(parts, run), expected(place));
      });
    }
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
