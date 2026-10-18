/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. The reference
 * is Node.js v26.3.0, the version that process.version reports.
 *
 * llhttp completes a message without a body right after the callback that
 * runs the listener, so Node sets req.complete there while nothing reads req:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_common.js#L143-L163
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { finished, pipeline, Writable } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, test } from "node:test";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";

type Seen = Record<string, boolean>;

async function withServer(server: http.Server | https.Server, run: (port: number) => Promise<void>) {
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
function send(port: number, payload: string, onError: (err: Error) => void, secure = false): Socket {
  const host = "127.0.0.1";
  const socket = secure ? tlsConnect({ port, host, rejectUnauthorized: false }) : connect(port, host);
  socket.on("error", onError);
  socket.write(payload);
  return socket;
}

const paths = ["the listener of the server", "emit('connection')"] as const;
// The port of the server itself, or of a net.Server that gives its connections to the server.
async function withPath(path: (typeof paths)[number], server: http.Server, run: (port: number) => Promise<void>) {
  if (path === paths[0]) return withServer(server, run);
  const sockets: Socket[] = [];
  const forwarder = createNetServer(socket => {
    sockets.push(socket);
    server.emit("connection", socket);
  });
  forwarder.listen(0, "127.0.0.1");
  await once(forwarder, "listening");
  try {
    await run((forwarder.address() as AddressInfo).port);
  } finally {
    forwarder.close();
    for (const socket of sockets) socket.destroy();
  }
}

// Two exchanges on a connection of its own. When the listener has the second one, the server has seen everything
// that the other connections sent before, or it does not read them.
function barrier(port: number, onError: (err: Error) => void, secure = false) {
  const request = "GET /barrier HTTP/1.1\r\nHost: x\r\n\r\n";
  const socket = send(port, request, onError, secure);
  let received = "";
  let exchanges = 0;
  socket.on("data", chunk => {
    received += chunk;
    if (!received.endsWith("barrier")) return;
    received = "";
    if (++exchanges === 1) socket.write(request);
    else socket.destroy();
  });
}
// The listener side of barrier(): it calls `done` two immediates after the second exchange.
function barrierListener(done: () => void) {
  let exchanges = 0;
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.url !== "/barrier") return false;
    res.end("barrier");
    if (++exchanges === 2) setImmediate(() => setImmediate(done));
    return true;
  };
}

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const tlsOptions = { key: readFileSync(join(fixtures, "cert.key")), cert: readFileSync(join(fixtures, "cert.pem")) };

const storage = new AsyncLocalStorage<string>();
type Stores = Record<string, string>;
// The store that 'end' and 'close' of a request see. Its listener runs in the store "listener".
async function storesOf(
  payload: string,
  arrange: (req: http.IncomingMessage, res: http.ServerResponse, seen: Stores) => void,
  secure = false,
) {
  const seen: Stores = {};
  const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
  const listener = (req: http.IncomingMessage, res: http.ServerResponse) => {
    storage.run("listener", () => {
      req.on("end", () => (seen.end = String(storage.getStore())));
      req.on("close", () => (seen.close = String(storage.getStore())));
      req.socket.on("close", () => setImmediate(onClose));
      arrange(req, res, seen);
    });
  };
  const server = secure ? https.createServer(tlsOptions, listener) : http.createServer(listener);
  await withServer(server, async port => {
    const socket = send(port, payload, reject, secure);
    socket.once("data", () => socket.destroy());
    await closed;
  });
  return seen;
}

// abortIncoming gives a request ECONNRESET when its connection closes, with or without an 'error' listener:
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L909-L914
const code = (err: unknown) => (err ? String((err as NodeJS.ErrnoException).code) : "no error");
const finishedCode = (req: http.IncomingMessage) =>
  new Promise<string>(resolve => finished(req, err => resolve(code(err))));
const lateReaders: [name: string, consume: (req: http.IncomingMessage) => Promise<string>][] = [
  [
    "stream.pipeline()",
    req => {
      const sink = new Writable({ write: (chunk, encoding, callback) => callback() });
      return new Promise(resolve => pipeline(req, sink, err => resolve(code(err))));
    },
  ],
  [
    "for await",
    async req => {
      try {
        for await (const _ of req);
        return "no error";
      } catch (err) {
        return code(err);
      }
    },
  ],
  ["stream.finished()", finishedCode],
];
// The client goes away behind each of these. Half of the body of the POST has arrived then.
const abortedRequests = [
  ["a GET", "GET /2 HTTP/1.1\r\nHost: x\r\n\r\n"],
  ["a POST with half of its body", "POST /2 HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nhello"],
];
// A reader of a request that is already closed settles on a tick, and two immediates are behind every tick.
const settled = (reader: Promise<string>) =>
  Promise.race([reader, new Promise<string>(resolve => setImmediate(() => setImmediate(resolve, "never settles")))]);

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

// parserOnMessageComplete also pushes the EOF, so the first read of the request
// ends it. A req.pause() after that read is too late to hold 'end' back.
describe("'end' of a request without a body", () => {
  type Arrange = (req: http.IncomingMessage, res: http.ServerResponse) => void;
  const get = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
  const emptyPost = "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n";
  // Ticks run before immediates: a request that its listener reads has ended by then.
  const respondLater = (res: http.ServerResponse) => setImmediate(() => res.end("ok"));
  const resumeThenPause = (req: http.IncomingMessage) => {
    req.resume();
    req.pause();
  };
  // 'close' of the response is not in these lists. Node.js v26.3.0 emits it before 'end' of a
  // request that the response dumps, and later versions emit it after.
  const afterResponse = ["res finish", "req end", "req close"];
  const beforeResponse = ["req end", "req close", "res finish"];
  const pauseInClose: Arrange = (req, res) => {
    res.on("close", () => req.pause());
    res.end("ok");
  };
  const resumePauseRespond: Arrange = (req, res) => {
    resumeThenPause(req);
    respondLater(res);
  };
  const cases: [name: string, arrange: Arrange, expected: string[]][] = [
    ["req.pause() in 'close' of the response", pauseInClose, afterResponse],
    [
      "req.pause() in 'close' of a response that ends later",
      (req, res) => {
        res.on("close", () => req.pause());
        respondLater(res);
      },
      afterResponse,
    ],
    [
      "req.pause() in 'finish' of the response",
      (req, res) => {
        res.on("finish", () => req.pause());
        res.end("ok");
      },
      afterResponse,
    ],
    ["req.resume(), then req.pause()", resumePauseRespond, beforeResponse],
    [
      "req.resume(), then req.pause() on the next tick",
      (req, res) => {
        req.resume();
        process.nextTick(() => req.pause());
        respondLater(res);
      },
      beforeResponse,
    ],
    [
      "req.pause() in 'resume'",
      (req, res) => {
        req.once("resume", () => req.pause());
        req.resume();
        respondLater(res);
      },
      beforeResponse,
    ],
    [
      "a 'data' listener, then req.pause()",
      (req, res) => {
        req.on("data", () => {});
        req.pause();
        respondLater(res);
      },
      beforeResponse,
    ],
    [
      "a 'readable' listener that does not read",
      (req, res) => {
        req.on("readable", () => {});
        respondLater(res);
      },
      beforeResponse,
    ],
  ];

  // The events of the request that `event` gives to its listener, and of its response. With `second`, that
  // request is the second one of a keep-alive connection.
  async function eventsOf(event: string, payload: string, arrange: Arrange, second = false) {
    const events: string[] = [];
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
    const server = http.createServer();
    let first = second;
    server.on(event, (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (first) {
        first = false;
        res.end("first");
        return;
      }
      req.on("end", () => events.push("req end"));
      req.on("close", () => events.push("req close"));
      res.on("finish", () => events.push("res finish"));
      res.on("close", () => events.push("res close"));
      // Every tick of the request has run by the time the client closes.
      req.socket.on("close", () => setImmediate(onClose));
      arrange(req, res);
    });
    await withServer(server, async port => {
      const socket = send(port, payload, reject);
      let received = "";
      socket.on("data", chunk => {
        received += chunk;
        if (received.endsWith("ok")) socket.destroy();
        else if (received.endsWith("first")) socket.write(payload);
      });
      await closed;
    });
    return { events: events.filter(name => name !== "res close"), responseClosed: events.includes("res close") };
  }

  for (const [request, payload] of [
    ["a GET", get],
    ["an empty POST", emptyPost],
  ]) {
    for (const [name, arrange, events] of cases) {
      test(`${request}: ${name}`, async () => {
        assert.deepStrictEqual(await eventsOf("request", payload, arrange), { events, responseClosed: true });
      });
    }
  }

  // Only the first request of a connection makes its socket flow.
  test("the second request of a connection: req.pause() in 'close' of the response", async () => {
    const seen = await eventsOf("request", get, pauseInClose, true);
    assert.deepStrictEqual(seen, { events: afterResponse, responseClosed: true });
  });
  test("the second request of a connection: req.resume(), then req.pause()", async () => {
    const seen = await eventsOf("request", get, resumePauseRespond, true);
    assert.deepStrictEqual(seen, { events: beforeResponse, responseClosed: true });
  });

  // The last chunk comes in the read of the head, but its EOF is a tick late here. Node.js ends all of these
  // requests, and Bun 1.4.2 ended the first one. The fix is in the native parser.
  const emptyChunked = "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n";
  for (const [name, arrange, events] of cases) {
    const run = name === "req.pause() in 'close' of a response that ends later" ? test : test.todo;
    run(`a chunked request with an empty body: ${name}`, async () => {
      assert.deepStrictEqual(await eventsOf("request", emptyChunked, arrange), { events, responseClosed: true });
    });
  }

  for (const [event, expectation] of [
    ["checkContinue", "100-continue"],
    ["checkExpectation", "meow"],
  ]) {
    test(`'${event}': req.resume(), then req.pause()`, async () => {
      const payload = `GET / HTTP/1.1\r\nHost: x\r\nExpect: ${expectation}\r\n\r\n`;
      const seen = await eventsOf(event, payload, resumePauseRespond);
      assert.deepStrictEqual(seen, { events: beforeResponse, responseClosed: true });
    });
  }

  const reads: [name: string, read: (req: http.IncomingMessage) => void][] = [
    ["req.resume(), then req.pause()", resumeThenPause],
    ["a 'readable' listener that does not read", req => void req.on("readable", () => {})],
  ];

  // The 503 is behind a response that is still in flight, or the server destroys the socket behind it.
  for (const [arm, pipelined] of [
    ["a pipelined request", true],
    ["the next request of the connection", false],
  ] as const) {
    for (const [name, read] of reads) {
      test(`'dropRequest' for ${arm}: ${name}`, async () => {
        const events: string[] = [];
        const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
        const server = http.createServer((req, res) => res.end("ok"));
        server.maxRequestsPerSocket = 1;
        server.on("dropRequest", (req: http.IncomingMessage, socket: Socket) => {
          for (const name of ["aborted", "error", "end", "close"]) req.on(name, () => events.push(`req ${name}`));
          socket.on("close", () => setImmediate(onClose));
          read(req);
        });
        await withServer(server, async port => {
          // Bun closes the connection behind the 503.
          const socket = send(port, pipelined ? get + get : get, () => {});
          let received = "";
          socket.on("data", chunk => {
            received += chunk;
            if (received.includes("HTTP/1.1 503 ") && received.endsWith("\r\n\r\n")) socket.destroy();
            else if (!pipelined && received.endsWith("ok")) socket.write(get);
          });
          await closed;
        });
        assert.deepStrictEqual(events, ["req end", "req close"]);
      });
    }
  }

  // llhttp completes these at the end of the head, so the request has its EOF inside the listener.
  const handoffs = [
    ["connect", "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"],
    ["upgrade", "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"],
  ];
  const handoffReads: typeof reads = [...reads, ["req.read()", req => void req.read()]];
  for (const [event, payload] of handoffs) {
    for (const [name, read] of handoffReads) {
      test(`'${event}': ${name}`, async () => {
        const events: string[] = [];
        const { promise: sampled, resolve: onSampled, reject } = Promise.withResolvers<void>();
        const server = http.createServer();
        server.on(event, (req: http.IncomingMessage, socket: Socket) => {
          req.on("end", () => events.push("req end"));
          req.on("close", () => events.push("req close"));
          read(req);
          setImmediate(() => {
            socket.destroy();
            onSampled();
          });
        });
        await withServer(server, async port => {
          send(port, payload, reject);
          await sampled;
        });
        assert.deepStrictEqual(events, ["req end", "req close"]);
      });
    }
  }

  test("each of two pipelined requests, with req.pause() in 'close' of its response", async () => {
    const events: Record<string, string[]> = {};
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      const mine: string[] = (events[req.url!] = []);
      req.on("end", () => mine.push("end"));
      req.on("close", () => mine.push("close"));
      res.on("close", () => req.pause());
      if (req.url === "/1") req.socket.on("close", () => setImmediate(onClose));
      res.end(req.url);
    });
    await withServer(server, async port => {
      const socket = send(port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\nGET /2 HTTP/1.1\r\nHost: x\r\n\r\n", reject);
      let received = "";
      socket.on("data", chunk => {
        received += chunk;
        if (received.endsWith("/2")) socket.destroy();
      });
      await closed;
    });
    assert.deepStrictEqual(events, { "/1": ["end", "close"], "/2": ["end", "close"] });
  });

  // With the EOF there before the first tick, the listeners of the readers run inside the push.
  const consumers: [name: string, consume: (req: http.IncomingMessage) => Promise<unknown>][] = [
    [
      "for await",
      async req => {
        for await (const _ of req);
      },
    ],
    ["stream/consumers text()", req => text(req)],
  ];
  for (const [request, payload] of [
    ["a GET", get],
    ["an empty POST", emptyPost],
  ]) {
    for (const [name, consume] of consumers) {
      test(`${request}: ${name} in the listener has the EOF before the first tick`, async () => {
        const events: string[] = [];
        const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
        const server = http.createServer((req, res) => {
          req.on("end", () => events.push("req end"));
          req.on("close", () => events.push("req close"));
          res.on("finish", () => events.push("res finish"));
          req.socket.on("close", () => setImmediate(onClose));
          process.nextTick(() => events.push("tick"));
          req.on("readable", () => events.push("req readable"));
          consume(req).then(() => {
            events.push("consumed");
            res.end("ok");
          }, reject);
        });
        await withServer(server, async port => {
          const socket = send(port, payload, reject);
          socket.once("data", () => socket.destroy());
          await closed;
        });
        assert.deepStrictEqual(events, ["req readable", "tick", "req end", "req close", "consumed", "res finish"]);
      });
    }
  }

  // hapi sends `Connection: close` behind a response to a request that has not ended.
  for (const [request, payload] of [
    ["a GET", get],
    ["an empty POST", emptyPost],
  ]) {
    test(`${request} that nothing reads has ended on the first promise job`, async () => {
      const ended: boolean[] = [];
      const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
      const server = http.createServer(async (req, res) => {
        await null;
        ended.push((req as any)._readableState.ended);
        if (!ended.at(-1)) res.setHeader("Connection", "close");
        res.end("ok");
      });
      let received = "";
      await withServer(server, async port => {
        const socket = send(port, payload, reject);
        socket.on("data", chunk => {
          received += chunk;
          const responses = received.split("HTTP/1.1 200 OK").length - 1;
          if (!received.endsWith("ok")) return;
          if (responses === 1) socket.write(payload);
          else socket.destroy();
        });
        socket.on("close", () => onClose());
        await closed;
      });
      assert.deepStrictEqual(
        {
          ended,
          responses: received.split("HTTP/1.1 200 OK").length - 1,
          closeHeaders: received.split(/^connection: close/im).length - 1,
        },
        { ended: [true, true], responses: 2, closeHeaders: 0 },
      );
    });
  }

  test("stream.finished() gives no error for a request that is destroyed before anything reads it", async () => {
    const { promise: done, resolve: onDone } = Promise.withResolvers<string>();
    const server = http.createServer(req => {
      finished(req, err => onDone(err ? String((err as NodeJS.ErrnoException).code) : "no error"));
      setImmediate(() => req.destroy());
    });
    await withServer(server, async port => {
      // req.destroy() resets the connection.
      send(port, get, () => {});
      assert.strictEqual(await done, "no error");
    });
  });

  // No request here has an 'error' listener.
  for (const [request, payload] of abortedRequests) {
    for (const [name, consume] of lateReaders) {
      test(`${request}: ${name} that starts after the client went away gets ECONNRESET`, async () => {
        const { promise: result, resolve: onResult, reject } = Promise.withResolvers<string>();
        let client: Socket;
        const server = http.createServer(req => {
          req.socket.on("close", () => settled(consume(req)).then(onResult));
          client.destroy();
        });
        await withServer(server, async port => {
          client = send(port, payload, reject);
          assert.strictEqual(await result, "ECONNRESET");
        });
      });
    }

    test(`${request}: stream.finished() of a pipelined request whose client went away gets ECONNRESET`, async () => {
      const { promise: result, resolve: onResult, reject } = Promise.withResolvers<string>();
      let client: Socket;
      const server = http.createServer(req => {
        // The first response does not end, so the second request waits behind it.
        if (req.url === "/1") return;
        req.socket.on("close", () => settled(finishedCode(req)).then(onResult));
        client.destroy();
      });
      await withServer(server, async port => {
        client = send(port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\n" + payload, reject);
        assert.strictEqual(await result, "ECONNRESET");
      });
    });
  }

  // The error is for the request. The socket closed with no error, and the client made none.
  for (const path of paths) {
    test(`a client that goes away under an open response gives no 'clientError' and no 'error' of the socket (${path})`, async () => {
      const events: string[] = [];
      const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
      let client: Socket;
      const server = http.createServer(req => {
        req.socket.on("error", err => events.push(`socket error ${code(err)}`));
        req.on("close", () => events.push(`req close ${code(req.errored)}`));
        req.socket.on("close", () => setImmediate(onClose));
        client.destroy();
      });
      server.on("clientError", err => events.push(`clientError ${code(err)}`));
      await withPath(path, server, async port => {
        client = send(port, get, reject);
        await closed;
      });
      assert.deepStrictEqual(events, ["req close ECONNRESET"]);
    });
  }

  for (const path of paths) {
    test(`req.socket.pause() in the listener does not outlive the message (${path})`, async () => {
      const seen: Record<string, boolean[]> = { listener: [], nextTick: [] };
      const { promise: sampled, resolve: onSampled, reject } = Promise.withResolvers<void>();
      const isBarrier = barrierListener(onSampled);
      const server = http.createServer((req, res) => {
        if (isBarrier(req, res)) return;
        req.socket.pause();
        seen.listener.push(req.socket.isPaused());
        process.nextTick(() => seen.nextTick.push(req.socket.isPaused()));
        setImmediate(() => res.end("ok"));
      });
      await withPath(path, server, async port => {
        const socket = send(port, get, reject);
        let received = "";
        socket.on("data", chunk => {
          received += chunk;
          if (seen.listener.length !== 1 || !received.endsWith("ok")) return;
          // The second request arrives on a socket that flows.
          socket.write(get);
          barrier(port, reject);
        });
        await sampled;
      });
      assert.deepStrictEqual(seen, { listener: [true, true], nextTick: [false, false] });
    });
  }

  // The response stays open, so only the readStart() of message-complete makes the connection read again.
  describe("req.socket.pause() in a listener that leaves its response open", () => {
    const request = (url: string) => `GET ${url} HTTP/1.1\r\nHost: x\r\n\r\n`;
    // What the server saw of the connection after `then`, in any order. With `second`, a request came before.
    async function afterPause(
      options: http.ServerOptions,
      second: boolean,
      arrange: (req: http.IncomingMessage) => void,
      then: (client: Socket) => void,
    ) {
      const events: string[] = [];
      const { promise: sampled, resolve: onSampled, reject } = Promise.withResolvers<void>();
      const isBarrier = barrierListener(onSampled);
      const server = http.createServer(options, (req, res) => {
        if (isBarrier(req, res)) return;
        if (req.url === "/first") return void res.end("first");
        if (req.url === "/next") return void events.push("next request");
        req.socket.pause();
        arrange(req);
        req.on("close", () => events.push(`req close ${code(req.errored)}`));
        res.on("close", () => events.push("res close"));
        res.write("open");
      });
      await withServer(server, async port => {
        const client = send(port, request(second ? "/first" : "/open"), reject);
        let received = "";
        client.on("data", chunk => {
          received += chunk;
          if (received.endsWith("first")) {
            client.write(request("/open"));
          } else if (received.endsWith("open\r\n")) {
            received = "";
            then(client);
            barrier(port, reject);
          }
        });
        await sampled;
      });
      return events.sort();
    }
    const nothing = () => {};

    for (const second of [false, true]) {
      const which = second ? "the second request of a connection" : "the first request of a connection";
      test(`${which}: the close of the client reaches the request and the response`, async () => {
        const events = await afterPause({}, second, nothing, client => client.destroy());
        assert.deepStrictEqual(events, ["req close ECONNRESET", "res close"]);
      });
      test(`${which}: the next request of the connection gets its listener`, async () => {
        const events = await afterPause({}, second, nothing, client => client.write(request("/next")));
        assert.deepStrictEqual(events, ["next request"]);
      });
    }
    // optimizeEmptyRequests closes the request before the listener, and req._dump() ends it.
    test("with optimizeEmptyRequests: the close of the client reaches the response", async () => {
      const events = await afterPause({ optimizeEmptyRequests: true }, false, nothing, client => client.destroy());
      assert.deepStrictEqual(events, ["res close"]);
    });
    test("after req._dump(): the close of the client reaches the response", async () => {
      const events = await afterPause(
        {},
        false,
        req => void (req as any)._dump(),
        client => client.destroy(),
      );
      assert.deepStrictEqual(events, ["req close no error", "res close"]);
    });
  });

  // The native side reads again when the response ends, so Bun gives the next request to its listener at once. Node.js
  // waits for socket.resume().
  test("req.socket.isPaused() holds after a req.socket.pause() behind the message, when the response dumps the request", async () => {
    const { promise: sampled, resolve: onSampled, reject } = Promise.withResolvers<boolean>();
    const server = http.createServer((req, res) => {
      setImmediate(() => {
        req.socket.pause();
        // The dump of the request has run when the immediate after 'close' does.
        res.on("close", () => setImmediate(() => onSampled(req.socket.isPaused())));
        res.end("ok");
      });
    });
    await withServer(server, async port => {
      send(port, get, reject);
      assert.strictEqual(await sampled, true);
    });
  });

  describe("socket.parser.incoming", () => {
    const readers: [name: string, read: (req: http.IncomingMessage) => void][] = [
      ["the dump of the response", () => {}],
      [
        "a 'readable' listener",
        req => {
          req.on("readable", () => {
            while (req.read() !== null);
          });
        },
      ],
    ];
    for (const [request, payload] of [
      ["a GET", get],
      ["a POST with a body", "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello"],
    ]) {
      for (const [name, read] of readers) {
        test(`is ${request} inside its 'end', and null after it, when ${name} reads it`, async () => {
          const seen: Seen = {};
          const { promise: sampled, resolve: onSampled, reject } = Promise.withResolvers<void>();
          const server = http.createServer((req, res) => {
            const parser = (req.socket as any).parser;
            read(req);
            req.on("end", () => {
              seen.end = parser.incoming === req;
              process.nextTick(() => {
                seen.afterEnd = parser.incoming === req;
                onSampled();
              });
            });
            res.end("ok");
          });
          await withServer(server, async port => {
            send(port, payload, reject);
            await sampled;
          });
          assert.deepStrictEqual(seen, { end: true, afterEnd: false });
        });
      }
    }

    test("stays the request that ended until its response finishes", async () => {
      const seen: Seen = {};
      const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        const parser = (req.socket as any).parser;
        req.on("end", () => (seen.end = parser.incoming === req));
        req.resume();
        res.on("close", () => {
          seen.responseClosed = parser.incoming === req;
          onClose();
        });
        setImmediate(() => {
          seen.beforeResponse = parser.incoming === req;
          res.end("ok");
        });
      });
      await withServer(server, async port => {
        send(port, get, reject);
        await closed;
      });
      assert.deepStrictEqual(seen, { end: true, beforeResponse: true, responseClosed: false });
    });

    test("stays the next request when a request before it ends late", async () => {
      const { promise: sampled, resolve: onSampled, reject } = Promise.withResolvers<boolean>();
      let first: http.IncomingMessage;
      const server = http.createServer((req, res) => {
        if (req.url === "/next") {
          const parser = (req.socket as any).parser;
          first.on("end", () => process.nextTick(() => onSampled(parser.incoming === req)));
          first.resume();
          return;
        }
        first = req;
        // After the dump: the request has its body and its EOF, and does not end.
        res.on("finish", () => req.pause());
        res.end("ok");
      });
      await withServer(server, async port => {
        const socket = send(port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello", reject);
        socket.once("data", () => socket.write("GET /next HTTP/1.1\r\nHost: x\r\n\r\n"));
        assert.strictEqual(await sampled, true);
      });
    });
  });

  test("a request with a body that is paused in 'close' of its response does not end", async () => {
    const payload = "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello";
    const seen = await eventsOf("request", payload, pauseInClose);
    assert.deepStrictEqual(seen, { events: ["res finish"], responseClosed: true });
  });

  test("req.read() alone does not end the request", async () => {
    let chunk: unknown;
    const seen = await eventsOf("request", get, (req, res) => {
      chunk = req.read();
      respondLater(res);
    });
    assert.deepStrictEqual({ chunk, ...seen }, { chunk: null, events: ["res finish"], responseClosed: true });
  });

  // 'end' and 'close' run in the store of the read that ends the request. These rows are the same in Node.js
  // v26.3.0 and v26.11.1.
  describe("the AsyncLocalStorage store of the listener", () => {
    for (const [request, payload] of [
      ["a GET", get],
      ["an empty POST", emptyPost],
    ]) {
      test(`${request}: is in 'end' and 'close' of a request with a 'readable' listener, not in 'readable'`, async () => {
        const seen = await storesOf(payload, (req, res, seen) => {
          req.on("readable", () => (seen.readable ??= String(storage.getStore())));
          res.end("ok");
        });
        assert.deepStrictEqual(seen, { readable: "undefined", end: "listener", close: "listener" });
      });
      test(`${request}: is in 'end' and 'close' of a request that the listener resumes`, async () => {
        const seen = await storesOf(payload, (req, res) => {
          req.resume();
          res.end("ok");
        });
        assert.deepStrictEqual(seen, { end: "listener", close: "listener" });
      });
      test(`${request}: is in 'end' and 'close' of a request that a later response dumps`, async () => {
        const seen = await storesOf(payload, (req, res) => void setImmediate(() => res.end("ok")));
        assert.deepStrictEqual(seen, { end: "listener", close: "listener" });
      });
    }
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

  for (const [request, payload] of abortedRequests) {
    test(`${request}: stream.finished() that starts after the client went away gets ECONNRESET`, async () => {
      const { promise: result, resolve: onResult, reject } = Promise.withResolvers<string>();
      let client: Socket;
      const server = http.createServer(req => {
        req.socket.on("close", () => settled(finishedCode(req)).then(onResult));
        client.destroy();
      });
      await withForwarder(server, async port => {
        client = send(port, payload, reject);
        assert.strictEqual(await result, "ECONNRESET");
      });
    });
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

// A TLS connection goes through the same dispatcher.
describe("a request without a body over https", () => {
  const get = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";

  test("req.pause() in 'close' of the response", async () => {
    const events: string[] = [];
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
    const server = https.createServer(tlsOptions, (req, res) => {
      req.on("end", () => events.push("req end"));
      req.on("close", () => events.push("req close"));
      res.on("finish", () => events.push("res finish"));
      res.on("close", () => req.pause());
      req.socket.on("close", () => setImmediate(onClose));
      res.end("ok");
    });
    await withServer(server, async port => {
      const socket = send(port, get, reject, true);
      socket.once("data", () => socket.destroy());
      await closed;
    });
    assert.deepStrictEqual(events, ["res finish", "req end", "req close"]);
  });

  test("stream.pipeline() that starts after the client went away gets ECONNRESET", async () => {
    const { promise: result, resolve: onResult, reject } = Promise.withResolvers<string>();
    let client: Socket;
    const server = https.createServer(tlsOptions, req => {
      req.socket.on("close", () => settled(lateReaders[0][1](req)).then(onResult));
      client.destroy();
    });
    await withServer(server, async port => {
      client = send(port, get, reject, true);
      assert.strictEqual(await result, "ECONNRESET");
    });
  });

  test("req.socket.pause() in the listener does not outlive the message", async () => {
    const seen: Record<string, boolean[]> = { listener: [], nextTick: [] };
    const { promise: sampled, resolve: onSampled, reject } = Promise.withResolvers<void>();
    const isBarrier = barrierListener(onSampled);
    const server = https.createServer(tlsOptions, (req, res) => {
      if (isBarrier(req, res)) return;
      req.socket.pause();
      seen.listener.push(req.socket.isPaused());
      process.nextTick(() => seen.nextTick.push(req.socket.isPaused()));
      setImmediate(() => res.end("ok"));
    });
    await withServer(server, async port => {
      const socket = send(port, get, reject, true);
      let received = "";
      socket.on("data", chunk => {
        received += chunk;
        if (seen.listener.length !== 1 || !received.endsWith("ok")) return;
        socket.write(get);
        barrier(port, reject, true);
      });
      await sampled;
    });
    assert.deepStrictEqual(seen, { listener: [true, true], nextTick: [false, false] });
  });
});

// nodejs/node#65732: at 'finish' of a response the server ends a complete request that nothing read with read(0),
// and a clean destroy of a message calls back with no tick. Node.js has it since v26.9.0 and v24.22.0. The versions
// before resume the request, and their 'close' is two ticks behind 'end'. The "fast-forward" rows are the output of
// Node.js v26.11.1 and do not run on the older versions. The other rows are the same in v26.3.0 and v26.11.1.
describe("the end of a message, tick for tick", () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const isBun = typeof Bun !== "undefined";
  const fastForwards = isBun || major > 26 || (major === 26 && minor >= 9) || (major === 24 && minor >= 22);
  // nodejs/node#65952 (v26.10.0, v24.22.0): the client drops the destroy() of a request whose response is complete.
  const clientDropsLateDestroy =
    !isBun && (major > 26 || (major === 26 && minor >= 10) || (major === 24 && minor >= 22));

  type Log = (line: string) => void;
  type Arrange = (req: http.IncomingMessage, res: http.ServerResponse, log: Log) => void;
  const get = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
  const emptyPost = "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n";
  const post = "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 11\r\n\r\nhello world";
  const halfPost = "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 11\r\n\r\nhello";
  const state = (message: http.IncomingMessage) =>
    `ended=${message.readableEnded} destroyed=${message.destroyed} closed=${message.closed} flowing=${message.readableFlowing}`;
  // One tick for each name. An event between two of them is that many ticks behind the start.
  const ticks = (log: Log, names: string[]) => {
    const [name, ...rest] = names;
    process.nextTick(() => {
      log(name);
      if (rest.length > 0) ticks(log, rest);
    });
  };
  const endAndClose = (req: http.IncomingMessage, log: Log) => {
    req.on("end", () => log("end"));
    req.on("close", () => log("close"));
  };
  const abortedAndClose = (req: http.IncomingMessage, log: Log) => {
    req.on("aborted", () => log("aborted"));
    req.on("end", () => log("end"));
    req.on("close", () => log(`close ended=${req.readableEnded} aborted=${req.aborted}`));
  };
  // "fast-forward": not on a Node.js without nodejs/node#65732. "fallback": the JS parser of emit('connection') in
  // Bun still ends this request after its abort, on main as well.
  type Tag = "fast-forward" | "fallback";
  const rows: [name: string, payload: string, arrange: Arrange, expected: string[], tag?: Tag][] = [
    [
      "a GET that nothing reads has closed one tick after 'finish'",
      get,
      (req, res, log) => {
        res.on("finish", () => process.nextTick(() => log(state(req))));
        res.end("ok");
      },
      ["ended=true destroyed=true closed=true flowing=null"],
      "fast-forward",
    ],
    [
      "an empty POST that nothing reads has closed one tick after 'finish'",
      emptyPost,
      (req, res, log) => {
        res.on("finish", () => process.nextTick(() => log(state(req))));
        res.end("ok");
      },
      ["ended=true destroyed=true closed=true flowing=null"],
      "fast-forward",
    ],
    [
      "a GET that nothing reads does not flow and emits no 'resume'",
      get,
      (req, res, log) => {
        req.on("resume", () => log("resume"));
        req.on("end", () => log(`end ${state(req)}`));
        req.on("close", () => log(`close ${state(req)}`));
        res.end("ok");
      },
      [
        "end ended=true destroyed=false closed=false flowing=null",
        "close ended=true destroyed=true closed=true flowing=null",
      ],
      "fast-forward",
    ],
    [
      "a GET that nothing reads: 'end' is before the first tick of a 'finish' listener, 'close' before the second",
      get,
      (req, res, log) => {
        res.on("finish", () => {
          log("finish");
          ticks(log, ["A", "B", "C", "D"]);
        });
        endAndClose(req, log);
        res.end("ok");
      },
      ["finish", "end", "A", "close", "B", "C", "D"],
      "fast-forward",
    ],
    [
      "a GET that nothing reads: 'close' is one tick behind 'end'",
      get,
      (req, res, log) => {
        req.on("end", () => {
          log("end");
          ticks(log, ["A", "B", "C"]);
        });
        req.on("close", () => log("close"));
        res.end("ok");
      },
      ["end", "A", "close", "B", "C"],
      "fast-forward",
    ],
    [
      "a POST that its listener read: 'close' is one tick behind 'end'",
      post,
      (req, res, log) => {
        req.on("data", () => {});
        req.on("end", () => {
          log("end");
          ticks(log, ["A", "B", "C"]);
          res.end("ok");
        });
        req.on("close", () => log("close"));
      },
      ["end", "A", "close", "B", "C"],
      "fast-forward",
    ],
    [
      "a 'readable' listener that comes in 'finish' is behind 'end', and gets nothing",
      get,
      (req, res, log) => {
        res.on("finish", () => {
          req.on("readable", () => log(`readable ${req.read()}`));
          endAndClose(req, log);
        });
        res.end("ok");
      },
      ["end", "close"],
      "fast-forward",
    ],
    [
      "ticks and a promise job of a 'finish' listener are behind 'end' and the destroy",
      get,
      (req, res, log) => {
        res.on("finish", () => {
          queueMicrotask(() => log(`job ${state(req)}`));
          process.nextTick(() => {
            log(`tick ${state(req)}`);
            process.nextTick(() => log(`tick ${state(req)}`));
          });
        });
        res.end("ok");
      },
      [
        "tick ended=true destroyed=true closed=true flowing=null",
        "tick ended=true destroyed=true closed=true flowing=null",
        "job ended=true destroyed=true closed=true flowing=null",
      ],
      "fast-forward",
    ],
    [
      "destroy() one tick behind 'finish' comes after 'end': no abort",
      get,
      (req, res, log) => {
        req.on("aborted", () => log("aborted"));
        endAndClose(req, log);
        res.on("finish", () =>
          process.nextTick(() => {
            req.destroy();
            log(`destroyed=${req.destroyed} aborted=${req.aborted}`);
          }),
        );
        res.end("ok");
      },
      ["end", "destroyed=true aborted=false", "close"],
      "fast-forward",
    ],
    [
      "a POST with a body that nothing reads is resumed",
      post,
      (req, res, log) => {
        res.on("finish", () => process.nextTick(() => log(state(req))));
        req.on("resume", () => log("resume"));
        req.on("end", () => log(`end ${state(req)}`));
        req.on("close", () => log("close"));
        setImmediate(() => res.end("ok"));
      },
      [
        "resume",
        "ended=false destroyed=false closed=false flowing=true",
        "end ended=true destroyed=false closed=false flowing=true",
        "close",
      ],
    ],
    // Listeners and readers that come in a 'finish' listener, behind the dump. The request still ends for them.
    [
      "'end' and 'close' listeners that come in 'finish'",
      get,
      (req, res, log) => {
        res.on("finish", () => endAndClose(req, log));
        res.end("ok");
      },
      ["end", "close"],
    ],
    [
      "a 'data' listener that comes in 'finish'",
      get,
      (req, res, log) => {
        res.on("finish", () => {
          req.on("data", () => log("data"));
          endAndClose(req, log);
        });
        res.end("ok");
      },
      ["end", "close"],
    ],
    [
      "resume() in 'finish'",
      get,
      (req, res, log) => {
        res.on("finish", () => {
          endAndClose(req, log);
          req.resume();
        });
        res.end("ok");
      },
      ["end", "close"],
    ],
    [
      "read() in 'finish'",
      get,
      (req, res, log) => {
        res.on("finish", () => {
          endAndClose(req, log);
          log(`read ${req.read()}`);
        });
        res.end("ok");
      },
      ["read null", "end", "close"],
    ],
    [
      "destroy() in 'finish' is an abort, and 'end' is already on its way",
      get,
      (req, res, log) => {
        res.on("finish", () => {
          req.on("aborted", () => log("aborted"));
          endAndClose(req, log);
          req.destroy();
          log(`destroyed=${req.destroyed} aborted=${req.aborted}`);
        });
        res.end("ok");
      },
      ["aborted", "destroyed=true aborted=true", "end", "close"],
    ],
    [
      "stream.finished() in 'finish'",
      get,
      (req, res, log) => {
        res.on("finish", () => finished(req, err => log(`finished ${code(err)}`)));
        res.end("ok");
      },
      ["finished no error"],
    ],
    [
      "for await in 'finish'",
      get,
      (req, res, log) => {
        res.on("finish", async () => {
          let length = 0;
          for await (const chunk of req) length += chunk.length;
          log(`read ${length} bytes`);
        });
        res.end("ok");
      },
      ["read 0 bytes"],
    ],
    // A request that is destroyed before the response dumps it is not ended by the dump.
    [
      "destroy() in a 'finish' listener that runs before the dump: an abort, and no 'end'",
      get,
      (req, res, log) => {
        abortedAndClose(req, log);
        res.prependListener("finish", () => req.destroy());
        res.end("ok");
      },
      ["aborted", "close ended=false aborted=true"],
      "fallback",
    ],
    [
      "res.end() and then req.destroy(): an abort, and no 'end'",
      get,
      (req, res, log) => {
        abortedAndClose(req, log);
        res.end("ok");
        req.destroy();
      },
      ["aborted", "close ended=false aborted=true"],
      "fallback",
    ],
    // The half of _destroy() that keeps its tick.
    [
      "destroy(err) in 'end' keeps its tick: an 'error' listener that comes after it gets the error",
      post,
      (req, res, log) => {
        req.on("data", () => {});
        req.on("end", () => {
          log("end");
          req.destroy(new Error("boom"));
          log(`closed=${req.closed} aborted=${req.aborted}`);
          req.on("error", err => log(`error ${err.message}`));
          ticks(log, ["A", "B", "C"]);
          res.end("ok");
        });
        req.on("close", () => log("close"));
      },
      ["end", "closed=false aborted=false", "A", "error boom", "close", "B", "C"],
    ],
    [
      "destroy() of a request that has not ended, behind the destroy of its socket, is an abort and keeps its tick",
      halfPost,
      (req, res, log) => {
        req.on("aborted", () => log("aborted"));
        req.on("close", () => log("close"));
        req.socket.destroy();
        req.destroy();
        log(`closed=${req.closed} aborted=${req.aborted}`);
        ticks(log, ["A", "B", "C"]);
      },
      ["aborted", "closed=false aborted=true", "A", "close", "B", "C"],
    ],
  ];
  for (const path of paths) {
    describe(path, () => {
      for (const [name, payload, arrange, expected, tag] of rows) {
        const run =
          tag === "fast-forward" && !fastForwards
            ? test.skip
            : tag === "fallback" && isBun && path === paths[1]
              ? test.todo
              : test;
        run(name, async () => {
          const events: string[] = [];
          const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
          const server = http.createServer((req, res) => {
            // Every tick and promise job that the row queues has run before this immediate.
            req.on("close", () => setImmediate(onClose));
            arrange(req, res, line => events.push(line));
          });
          await withPath(path, server, async port => {
            const socket = send(port, payload, reject);
            // The client of the row that destroys its socket sees a reset.
            socket.removeListener("error", reject);
            socket.on("error", () => {});
            await closed;
            socket.destroy();
          });
          assert.deepStrictEqual(events, expected);
        });
      }

      // With 'close' of the request ahead of 'close' of the response, this destroy() comes to a response that has finished.
      test("res.destroy() in 'close' of a request keeps the connection for the next request", async () => {
        const { promise: answered, resolve: onAnswered, reject } = Promise.withResolvers<string>();
        const server = http.createServer((req, res) => {
          req.on("data", () => {});
          req.on("end", () => res.end(`answer ${req.url}`));
          req.on("close", () => res.destroy());
        });
        await withPath(path, server, async port => {
          const request = (url: string) => `POST ${url} HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello`;
          const socket = send(port, request("/1"), reject);
          let received = "";
          let sentSecond = false;
          socket.on("close", () => onAnswered(`closed after ${JSON.stringify(received)}`));
          socket.on("data", chunk => {
            received += chunk;
            if (!sentSecond && received.includes("answer /1")) {
              sentSecond = true;
              // Two immediates are behind every tick of the first exchange.
              setImmediate(() => setImmediate(() => socket.write(request("/2"))));
            } else if (received.includes("answer /2")) {
              onAnswered("answered");
            }
          });
          try {
            assert.strictEqual(await answered, "answered");
          } finally {
            socket.destroy();
          }
        });
      });
    });
  }

  (fastForwards ? test : test.skip)(
    "a response of the client that its listener read: 'close' is one tick behind 'end'",
    async () => {
      const events: string[] = [];
      const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => void res.end("ok"));
      await withServer(server, async port => {
        const request = http.get({ port, host: "127.0.0.1", agent: false }, res => {
          res.on("data", () => {});
          res.on("end", () => {
            events.push("end");
            ticks(line => events.push(line), ["A", "B", "C"]);
          });
          res.on("close", () => {
            events.push("close");
            setImmediate(onClose);
          });
        });
        request.on("error", reject);
        await closed;
      });
      assert.deepStrictEqual(events, ["end", "A", "close", "B", "C"]);
    },
  );

  // The client does not take the read(0) of the server: it would put 'end' of the response, which gives the socket
  // back to the agent, ahead of the error of the socket (nodejs/node#65938).
  for (const [how, destroy, expected] of [
    ["destroy(err)", (request: http.ClientRequest) => request.destroy(new Error("boom")), "boom"],
    ["an AbortSignal", (request: http.ClientRequest, controller: AbortController) => controller.abort(), "AbortError"],
  ] as const) {
    for (const [response, status, headers] of [
      ["a 204", 204, {}],
      ["an empty 200", 200, { "Content-Length": "0" }],
    ] as const) {
      (clientDropsLateDestroy ? test.skip : test)(
        `${how} of a keep-alive request of the client, behind ${response} that nothing read: the request gets the error`,
        async () => {
          const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
          const uncaught: unknown[] = [];
          const onUncaught = (err: unknown) => uncaught.push(err);
          process.on("uncaughtException", onUncaught);
          const server = http.createServer((req, res) => void res.writeHead(status, headers).end());
          const agent = new http.Agent({ keepAlive: true });
          const seen: string[] = [];
          try {
            await withServer(server, async port => {
              const controller = new AbortController();
              const request = http.get({ port, host: "127.0.0.1", agent, signal: controller.signal }, () => {
                setImmediate(() => destroy(request, controller));
              });
              request.on("error", err => seen.push(err.name === "AbortError" ? err.name : err.message));
              // The error of a socket that has no listener left is an uncaught exception on a later tick.
              request.on("close", () => setImmediate(() => setImmediate(onClose)));
              await closed;
            });
          } finally {
            agent.destroy();
            process.removeListener("uncaughtException", onUncaught);
          }
          assert.deepStrictEqual({ seen, uncaught }, { seen: [expected], uncaught: [] });
        },
      );
    }
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { expect } = await import("bun:test");
  const { bunEnv, bunExe, isASAN, isCI, isDebug, nodeExe } = await import("harness");
  const node = nodeExe();
  const get = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";

  // In a process of its own: each exception is an uncaught one, and the connection goes on behind it.
  // CI has its own time for each test. A local debug or ASAN build needs about 4 s to start the child.
  const spawnTimeout = { timeout: (isASAN || isDebug) && !isCI ? 90_000 : undefined };
  test("user code that throws in the dispatch of a request without a body", spawnTimeout, async () => {
    const script = `
      const http = require("node:http");
      const net = require("node:net");
      const uncaught = [];
      process.on("uncaughtException", err => uncaught.push(err.message));
      // After a read, the EOF emits 'readable' in place and not on a tick.
      function throwAtEOF(req, name) {
        req.read();
        req.on("readable", () => {
          throw new Error(name);
        });
      }
      class Incoming extends http.IncomingMessage {
        constructor(...args) {
          super(...args);
          if (this.method === "CONNECT") throwAtEOF(this, "connect");
        }
      }
      const events = {};
      function watch(req) {
        const mine = (events[req.url] = []);
        for (const name of ["aborted", "end"]) req.on(name, () => mine.push(name));
        req.on("close", () => mine.push("close " + (req.errored ? req.errored.code : "no error")));
        req.socket.on("error", err => mine.push("socket error " + err.code));
      }
      const server = http.createServer({ IncomingMessage: Incoming }, (req, res) => {
        if (req.url === "/answers-then-throws") {
          watch(req);
          res.end("answered");
          throw new Error("listener behind res.end()");
        }
        if (req.url === "/throws") {
          watch(req);
          throw new Error("listener");
        }
        throwAtEOF(req, "request");
        setImmediate(() => res.end("answered"));
      });
      server.on("clientError", (err, socket) => {
        (events.clientError ??= []).push(err.code);
        socket.destroy();
      });
      server.shouldUpgradeCallback = req => {
        if (req.url === "/callback-throws") {
          watch(req);
          req.resume();
          throw new Error("shouldUpgradeCallback");
        }
        throwAtEOF(req, "upgrade");
        return true;
      };
      server.on("upgrade", (req, socket) => socket.end("upgraded"));
      server.on("connect", (req, socket) => socket.end("connected"));
      const exchange = payload =>
        new Promise((resolve, reject) => {
          const socket = net.connect(server.address().port, "127.0.0.1", () => socket.write(payload));
          let received = "";
          socket.on("data", chunk => (received += chunk));
          socket.on("error", reject);
          socket.on("close", () => resolve(received.split("\\r\\n").at(-1)));
        });
      const request = (url, headers) => "GET " + url + " HTTP/1.1\\r\\nHost: x\\r\\n" + headers + "\\r\\n";
      const close = "Connection: close\\r\\n";
      const upgrade = "Connection: Upgrade\\r\\nUpgrade: websocket\\r\\n";
      server.listen(0, "127.0.0.1", async () => {
        const received = [];
        received.push(await exchange(request("/", close)));
        received.push(await exchange(request("/", upgrade)));
        received.push(await exchange("CONNECT example.com:443 HTTP/1.1\\r\\nHost: example.com:443\\r\\n\\r\\n"));
        received.push(await exchange(request("/answers-then-throws", close)));
        received.push(await exchange(request("/throws", close)));
        received.push(await exchange(request("/callback-throws", upgrade)));
        setImmediate(() =>
          setImmediate(() => {
            console.log(JSON.stringify({ received, uncaught, events }));
            server.close();
          }),
        );
      });
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    assert.deepStrictEqual(
      { stdout: stdout.trim(), stderr, exitCode },
      {
        stdout: JSON.stringify({
          // A 'readable' listener that throws under the EOF push does not fail the dispatch. For the request,
          // Node.js v26.3.0 gives the same result. For 'upgrade' and 'connect', Node.js does not emit the event.
          // The two empty answers are those of the native side for a dispatch that threw.
          received: ["answered", "upgraded", "connected", "answered", "", ""],
          uncaught: ["request", "upgrade", "connect", "listener behind res.end()", "listener", "shouldUpgradeCallback"],
          // The parser of Node.js is dead after such a throw. Here the connection goes on, so the request still ends.
          // A dispatch that fails with no answer is not an error of the client or of the socket.
          events: {
            "/answers-then-throws": ["end", "close no error"],
            "/throws": ["aborted", "close ECONNRESET"],
            "/callback-throws": ["end", "close no error"],
          },
        }),
        stderr: "",
        exitCode: 0,
      },
    );
  });

  // Node.js v26.3.0 emits this 'readable' with nobody there, and the listener never gets it. v26.9.0 has
  // nodejs/node#65749.
  for (const [request, payload] of [
    ["a GET", get],
    ["an empty POST", "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n"],
  ]) {
    test(`${request}: a 'readable' listener that comes an immediate later gets the EOF`, async () => {
      const { promise: read, resolve: onRead, reject } = Promise.withResolvers<unknown>();
      const server = http.createServer(req => {
        setImmediate(() => req.on("readable", () => onRead(req.read())));
      });
      await withServer(server, async port => {
        send(port, payload, reject);
        assert.strictEqual(await read, null);
      });
    });
  }

  // Node.js keeps such a request, with the body it has buffered, until the next request of the connection.
  describe("socket.parser.incoming lets go at 'finish' of the response", () => {
    const rows: [name: string, arrange: (req: http.IncomingMessage, res: http.ServerResponse) => void][] = [
      [
        "of a request that does not flow",
        (req, res) => {
          req.once("readable", () => {
            req.read(1);
            res.end("ok");
          });
        },
      ],
      [
        "of a request that a failed pipeline() destroyed",
        (req, res) => {
          const sink = new Writable({ write: (chunk, encoding, callback) => callback(new Error("sink")) });
          pipeline(req, sink, () => res.end("ok"));
        },
      ],
    ];
    for (const [name, arrange] of rows) {
      test(name, async () => {
        const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<boolean>();
        const server = http.createServer((req, res) => {
          const parser = (req.socket as any).parser;
          res.on("close", () => onClose(parser.incoming === req));
          arrange(req, res);
        });
        await withServer(server, async port => {
          send(port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello", reject);
          assert.strictEqual(await closed, false);
        });
      });
    }
  });

  // A request with nothing to read needs no resume() of a socket that flows. Node.js calls it for each message.
  test("message-complete calls resume() of the socket for the first request of a connection only", async () => {
    const resumed: string[] = [];
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
    // The request whose dispatch runs. The ticks behind it, with the dump of the request, are not a part of it.
    let dispatching: string | undefined;
    const server = http.createServer((req, res) => {
      const socket = req.socket;
      if (req.url === "/1") {
        const resume = socket.resume;
        socket.resume = function () {
          if (dispatching !== undefined) resumed.push(dispatching);
          return resume.call(this);
        };
        socket.on("close", () => onClose());
      }
      dispatching = req.url;
      process.nextTick(() => (dispatching = undefined));
      res.end(req.url);
    });
    await withServer(server, async port => {
      const socket = send(port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\n", reject);
      let received = "";
      socket.on("data", chunk => {
        received += chunk;
        if (received.endsWith("/1")) socket.write("GET /2 HTTP/1.1\r\nHost: x\r\n\r\n");
        else if (received.endsWith("/2")) socket.destroy();
      });
      await closed;
    });
    assert.deepStrictEqual(resumed, ["/1"]);
  });

  // bun:test waits for `expect(promise).resolves` with an event loop of its own. Inside the listener of the GET, that
  // loop dispatches the CONNECT that the client sends behind it. The readStart() of the GET must not make a tunnel flow.
  test("a CONNECT that a nested event loop dispatches inside the listener of the request ahead keeps its socket paused", async () => {
    const { promise: connected, resolve: onConnect } = Promise.withResolvers<void>();
    const { promise: sampled, resolve: onSampled, reject } = Promise.withResolvers<object>();
    let client: Socket;
    let tunnel: Socket | undefined;
    let inside = false;
    let dispatchedInside = false;
    const server = http.createServer(() => {
      inside = true;
      client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
      expect(connected).resolves.toBeUndefined();
      inside = false;
      // Message-complete of the GET is behind its listener, and this tick is behind message-complete.
      process.nextTick(() => onSampled({ dispatchedInside, flowing: tunnel?.readableFlowing }));
    });
    server.on("connect", (req, socket: Socket) => {
      tunnel = socket;
      dispatchedInside = inside;
      socket.on("error", () => {});
      onConnect();
    });
    await withServer(server, async port => {
      client = send(port, get, reject);
      try {
        assert.deepStrictEqual(await sampled, { dispatchedInside: true, flowing: null });
      } finally {
        tunnel?.destroy();
      }
    });
  });

  // Over http, Node.js v26.3.0 gives "undefined" for both: the 'readable' tick of the EOF starts the flow outside
  // the store.
  for (const secure of [false, true]) {
    test(`'end' and 'close' of a request that nothing reads are in the AsyncLocalStorage store of a listener that ends the response (${secure ? "https" : "http"})`, async () => {
      const seen = await storesOf(get, (req, res) => void res.end("ok"), secure);
      assert.deepStrictEqual(seen, { end: "listener", close: "listener" });
    });
  }

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
