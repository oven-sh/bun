/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
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
import { describe, test } from "node:test";
import { connect as tlsConnect } from "node:tls";
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

// Node.js emits 'upgrade' when its parser has consumed the read that carried the head of the request
// (onParserExecuteCommon). A request whose body is complete by then gets the raw socket, and the rest of
// the read as the head. Node.js parses the body of an Upgrade request since v26.
describe("an Upgrade request with a body", { skip: Number(process.versions.node.split(".")[0]) < 26 }, () => {
  const isBun = typeof Bun !== "undefined";
  const keys = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "keys");
  const tlsOptions = {
    key: readFileSync(join(keys, "agent1-key.pem")),
    cert: readFileSync(join(keys, "agent1-cert.pem")),
  };
  const reply = "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n";
  const requestHead = (framing: string) =>
    `POST / HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: raw\r\n${framing}\r\n\r\n`;
  // The body of each request is "hello".
  const requests: Record<string, { head: string; body: string; trailers: object }> = {
    "Content-Length": { head: requestHead("Content-Length: 5"), body: "hello", trailers: {} },
    "chunked": { head: requestHead("Transfer-Encoding: chunked"), body: "5\r\nhello\r\n0\r\n\r\n", trailers: {} },
    "chunked with a trailer": {
      head: requestHead("Transfer-Encoding: chunked"),
      body: "5\r\nhello\r\n0\r\nX-Trailer: yes\r\n\r\n",
      trailers: { "x-trailer": "yes" },
    },
  };
  const fixedLength = requests["Content-Length"];
  type Proto = "http" | "https";
  type Listening = { server: http.Server; dial: () => Socket; connect: () => Promise<Socket> };

  async function listening(proto: Proto, options: http.ServerOptions, run: (t: Listening) => Promise<void>) {
    // The barrier of writeInTwoReads() is a plain request.
    const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => void res.end("ok");
    const server =
      proto === "https"
        ? https.createServer({ ...tlsOptions, ...options }, onRequest)
        : http.createServer(options, onRequest);
    // A handed-off socket is no connection of the server any more: closeAllConnections() leaves it open.
    const sockets: Socket[] = [];
    server.on("connection", socket => sockets.push(socket));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const to = { port: (server.address() as AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true };
    const dial = () => {
      const socket = proto === "https" ? tlsConnect({ ...to, rejectUnauthorized: false }) : connect(to);
      socket.on("error", () => {});
      sockets.push(socket);
      return socket;
    };
    const connected = async () => {
      const socket = dial();
      await once(socket, proto === "https" ? "secureConnect" : "connect");
      return socket;
    };
    try {
      await run({ server, dial, connect: connected });
    } finally {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  }

  // Settles like `promise`, or rejects when the client closes first.
  function unlessClosed<T>(client: Socket, promise: Promise<T>) {
    const { promise: closed, reject } = Promise.withResolvers<never>();
    const onClose = () => reject(new Error("the client closed first"));
    client.once("close", onClose);
    return Promise.race([promise, closed]).finally(() => client.off("close", onClose));
  }

  // A partial head emits nothing on the server, so a whole request on a second connection is the barrier:
  // the server has read `first` by the time it has answered and closed that connection.
  async function writeInTwoReads(client: Socket, first: string, second: string, dial: () => Socket) {
    client.write(first);
    const barrier = dial();
    barrier.resume();
    barrier.end("GET /barrier HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
    await once(barrier, "close");
    client.write(second);
  }

  for (const proto of ["http", "https"] as const) {
    for (const [framing, { head, body, trailers }] of Object.entries(requests)) {
      for (const [reads, rest] of [
        ["one read", "AFTER"],
        ["two reads", "AFTER"],
        ["two reads", ""],
      ]) {
        test(`${proto}, ${framing}, head in ${reads}, ${JSON.stringify(rest)} behind the body: the listener gets the complete request, and the rest of the read as the head`, async () => {
          await listening(proto, {}, async t => {
            const seen = Promise.withResolvers<object>();
            t.server.on("upgrade", (req, socket, upgradeHead) => {
              const atUpgrade = {
                complete: req.complete,
                buffered: req.readableLength,
                trailers: { ...req.trailers },
                head: upgradeHead.toString("latin1"),
                // The socket has read what it hands over as the head.
                headCounted: (socket as Socket).bytesRead >= upgradeHead.length,
                parserFreed: (socket as any).parser === null,
                flowing: socket.readableFlowing,
                // close, data, drain, end, error, timeout. A TLSSocket of Node.js has listeners of its own.
                listeners:
                  proto === "https"
                    ? undefined
                    : ["close", "data", "drain", "end", "error", "timeout"].map(name => socket.listenerCount(name)),
              };
              let received = "";
              req.on("data", chunk => (received += chunk));
              req.on("end", () => seen.resolve({ ...atUpgrade, body: received }));
              req.on("error", seen.reject);
              socket.on("error", seen.reject);
            });
            const client = await t.connect();
            if (reads === "one read") client.write(head + body + rest);
            else await writeInTwoReads(client, head.slice(0, 30), head.slice(30) + body + rest, t.dial);
            assert.deepStrictEqual(await unlessClosed(client, seen.promise), {
              complete: true,
              buffered: 5,
              trailers,
              head: rest,
              headCounted: true,
              parserFreed: true,
              flowing: null,
              listeners: proto === "https" ? undefined : [0, 0, 0, 1, 0, 0],
              body: "hello",
            });
          });
        });
      }
    }

    // The listener has nothing to send and ends its side at once. The socket still reads: it has allowHalfOpen.
    for (const [framing, head, body] of [
      ["Content-Length", fixedLength.head, fixedLength.body],
      ["chunked", requests.chunked.head, requests.chunked.body],
      ["Content-Length of 200 KB", requestHead("Content-Length: 200000"), Buffer.alloc(200000, "b").toString()],
    ]) {
      for (const [arrival, withHead] of [
        ["with the head", body.length],
        ["partly with the head", 2],
        ["in a later read", 0],
      ] as const) {
        test(`${proto}, ${framing}, body ${arrival}: socket.end() in the listener loses nothing`, async () => {
          await listening(proto, {}, async t => {
            const result = Promise.withResolvers<object>();
            t.server.on("upgrade", (req, socket) => {
              const events: string[] = [];
              let requestBody = 0;
              let received = 0;
              req.on("data", chunk => (requestBody += chunk.length));
              socket.on("data", chunk => (received += chunk.length));
              socket.on("finish", () => events.push("finish"));
              socket.on("end", () => events.push("end"));
              socket.on("close", () => result.resolve({ body: requestBody, received, events }));
              socket.on("error", result.reject);
              socket.write(reply);
              socket.end();
            });
            const client = await t.connect();
            client.write(head + body.slice(0, withHead));
            // The 101: the listener has run.
            await unlessClosed(client, once(client, "data"));
            client.end(body.slice(withHead) + Buffer.alloc(2000, "a").toString());
            assert.deepStrictEqual(await result.promise, {
              body: framing === "Content-Length of 200 KB" ? 200000 : 5,
              received: 2000,
              events: ["finish", "end"],
            });
          });
        });
      }
    }
  }

  test("a body that continues in a later read: the listener gets the part that came with the head", async () => {
    await listening("http", {}, async t => {
      const upgraded = Promise.withResolvers<object>();
      const finished = Promise.withResolvers<object>();
      t.server.on("upgrade", (req, socket, head) => {
        upgraded.resolve({ complete: req.complete, buffered: req.readableLength, head: head.toString("latin1") });
        let body = "";
        let tunnel = "";
        req.on("data", chunk => (body += chunk));
        socket.on("data", chunk => {
          tunnel += chunk;
          if (tunnel.length >= "AFTER".length) finished.resolve({ complete: req.complete, body, tunnel });
        });
        socket.on("error", finished.reject);
        socket.write(reply);
      });
      const client = await t.connect();
      client.write(fixedLength.head + "he");
      // The 101: the listener has run.
      await unlessClosed(client, once(client, "data"));
      assert.deepStrictEqual(await upgraded.promise, { complete: false, buffered: 2, head: "" });
      client.write("lloAFTER");
      assert.deepStrictEqual(await unlessClosed(client, finished.promise), {
        complete: true,
        body: "hello",
        tunnel: "AFTER",
      });
    });
  });

  test("a body that fails in the read of its head: the listener gets the part that was parsed", async () => {
    await listening("http", {}, async t => {
      const events: string[] = [];
      const upgraded = Promise.withResolvers<object>();
      t.server.on("clientError", (err, socket) => {
        events.push("clientError");
        socket.destroy();
      });
      t.server.on("upgrade", (req, socket, head) => {
        socket.on("error", () => {});
        events.push("upgrade");
        upgraded.resolve({ complete: req.complete, buffered: req.readableLength, head: head.toString("latin1") });
        socket.destroy();
      });
      const client = await t.connect();
      client.on("end", () => client.end());
      const closed = once(client, "close");
      client.write(requests.chunked.head + "5\r\nhello\r\nZZ\r\n\r\n");
      assert.deepStrictEqual(await upgraded.promise, { complete: false, buffered: 5, head: "" });
      await closed;
      // Node.js reports no parse error for a request that is an upgrade. The listener always comes first.
      assert.strictEqual(events[0], "upgrade");
    });
  });

  // Node.js runs the nextTick queue behind each chunk of the body, and not between the end of the message
  // and 'upgrade'. A request that already flows ends behind the listener.
  const ticksFirst = ["shouldUpgradeCallback", "tick of shouldUpgradeCallback"];
  const listenerFirst = ["shouldUpgradeCallback", "upgrade, complete: false", "tick of shouldUpgradeCallback"];
  for (const [name, request, expected, readInData] of [
    [
      "a body with the head",
      fixedLength.head + fixedLength.body,
      [...ticksFirst, "data hello", "upgrade, complete: true", "end", "tick of upgrade"],
    ],
    // The read() finds the body complete. The request still ends behind the listener.
    [
      "a body with the head and a read() inside its 'data'",
      fixedLength.head + fixedLength.body,
      [...ticksFirst, "data hello", "upgrade, complete: true", "end", "tick of upgrade"],
      true,
    ],
    ["a Content-Length head alone", fixedLength.head, [...listenerFirst, "tick of upgrade"]],
    ["a chunked head alone", requests.chunked.head, [...listenerFirst, "tick of upgrade"]],
    // No chunk of the body came, so Node.js has run no tick. Bun runs the ticks when its dispatch returns.
    [
      "a chunked head and the size line of a chunk",
      requests.chunked.head + "5\r\n",
      isBun ? [...ticksFirst, "upgrade, complete: false", "tick of upgrade"] : [...listenerFirst, "tick of upgrade"],
    ],
  ] as const) {
    test(`the order of the listener and the ticks of shouldUpgradeCallback, for ${name}`, async () => {
      const order: string[] = [];
      const done = Promise.withResolvers<void>();
      await listening(
        "http",
        {
          shouldUpgradeCallback(req: http.IncomingMessage) {
            order.push("shouldUpgradeCallback");
            process.nextTick(() => order.push("tick of shouldUpgradeCallback"));
            req.on("data", chunk => {
              order.push(`data ${chunk}`);
              if (readInData) req.read();
            });
            req.on("end", () => order.push("end"));
            return true;
          },
        } as http.ServerOptions,
        async t => {
          t.server.on("upgrade", (req, socket) => {
            socket.on("error", () => {});
            order.push(`upgrade, complete: ${req.complete}`);
            process.nextTick(() => {
              order.push("tick of upgrade");
              done.resolve();
            });
          });
          const client = await t.connect();
          client.write(request);
          await unlessClosed(client, done.promise);
          assert.deepStrictEqual(order, expected);
        },
      );
    });
  }

  test("the listener runs in the async context of listen()", async () => {
    const storage = new AsyncLocalStorage<string>();
    const server = http.createServer();
    const seen = Promise.withResolvers<object>();
    server.on("upgrade", (req, socket) => {
      const inListener = storage.getStore();
      req.on("end", () => seen.resolve({ inListener, atRequestEnd: storage.getStore() }));
      req.resume();
      socket.on("error", seen.reject);
    });
    const sockets: Socket[] = [];
    server.on("connection", socket => sockets.push(socket));
    storage.run("the store of listen()", () => server.listen(0, "127.0.0.1"));
    await once(server, "listening");
    try {
      const client = send((server.address() as AddressInfo).port, fixedLength.head + fixedLength.body, seen.reject);
      sockets.push(client);
      assert.deepStrictEqual(await unlessClosed(client, seen.promise), {
        inListener: "the store of listen()",
        atRequestEnd: "the store of listen()",
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  test("a complete request waits for a reader: 'end' does not come while nothing reads it", async () => {
    await listening("http", {}, async t => {
      const seen = Promise.withResolvers<object>();
      t.server.on("upgrade", (req, socket) => {
        socket.on("error", seen.reject);
        const events: string[] = [];
        req.once("end", () => events.push("end"));
        setImmediate(() => {
          const unread = { complete: req.complete, buffered: req.readableLength, events: [...events] };
          req.once("end", () => seen.resolve({ unread, events }));
          req.resume();
        });
      });
      const client = await t.connect();
      client.write(fixedLength.head + fixedLength.body);
      assert.deepStrictEqual(await unlessClosed(client, seen.promise), {
        unread: { complete: true, buffered: 5, events: [] },
        events: ["end"],
      });
    });
  });

  test("req.destroy() in the listener sends nothing behind the 101", async () => {
    await listening("http", {}, async t => {
      t.server.on("upgrade", (req, socket) => {
        socket.on("error", () => {});
        socket.write(reply);
        req.destroy();
      });
      const client = await t.connect();
      let received = "";
      client.on("data", chunk => (received += chunk));
      client.on("end", () => client.end());
      client.write(fixedLength.head + fixedLength.body);
      await once(client, "close");
      assert.strictEqual(received, reply);
    });
  });

  test("the socket is destroyed when the request has no listener", async () => {
    await listening("http", { shouldUpgradeCallback: () => true } as http.ServerOptions, async t => {
      const client = await t.connect();
      let received = "";
      client.on("data", chunk => (received += chunk));
      client.on("end", () => client.end());
      client.write(fixedLength.head + fixedLength.body);
      await once(client, "close");
      assert.strictEqual(received, "");
    });
  });

  // shouldUpgradeCallback, or a listener that it adds, lets go of the connection before the read is parsed.
  // The listener still runs. `bun` is what Bun gives where it differs from Node.js.
  type AtUpgrade = { complete: boolean; buffered: number; head: string; requestDestroyed: boolean };
  const whole = { complete: true, buffered: 5, head: "", requestDestroyed: false };
  const part = { complete: false, buffered: 2, head: "", requestDestroyed: false };
  // Bun does not parse on in a socket that is closed.
  const unparsed = { complete: false, buffered: 0, head: "", requestDestroyed: false };
  const exits: [
    name: string,
    act: (req: http.IncomingMessage) => void,
    rows: [sent: string, node: AtUpgrade, bun?: AtUpgrade][],
  ][] = [
    [
      "shouldUpgradeCallback ends the socket",
      req => void req.socket.end(),
      [
        ["hello", whole],
        ["he", part],
        ["helloAFTER", { ...whole, head: "AFTER" }],
      ],
    ],
    [
      "shouldUpgradeCallback destroys the socket",
      req => void req.socket.destroy(),
      [
        ["hello", whole],
        ["he", part],
        ["helloAFTER", { ...whole, head: "AFTER" }],
      ],
    ],
    [
      "shouldUpgradeCallback resets the socket",
      req => void req.socket.resetAndDestroy(),
      [
        ["hello", whole, unparsed],
        ["he", part, unparsed],
        ["helloAFTER", { ...whole, head: "AFTER" }, unparsed],
      ],
    ],
    [
      "shouldUpgradeCallback destroys the request",
      req => void req.destroy(),
      [
        ["hello", { ...whole, buffered: 0, requestDestroyed: true }],
        ["he", { ...part, buffered: 0, requestDestroyed: true }],
        ["helloAFTER", { ...whole, buffered: 0, head: "AFTER", requestDestroyed: true }],
      ],
    ],
    [
      "a 'data' listener of the request destroys the socket",
      req => void req.on("data", () => req.socket.destroy()),
      [
        ["hello", { ...whole, buffered: 0 }],
        ["he", { ...part, buffered: 0 }],
        // In Bun the socket closes inside the last chunk, and the rest of the read goes with it.
        ["helloAFTER", { ...whole, buffered: 0, head: "AFTER" }, { ...whole, buffered: 0 }],
      ],
    ],
    [
      "a 'data' listener of the request resets the socket",
      req => void req.on("data", () => req.socket.resetAndDestroy()),
      [
        ["hello", { ...whole, buffered: 0 }],
        // Bun ends the body of an Upgrade request when its socket closes.
        ["he", { ...part, buffered: 0 }, { ...whole, buffered: 0 }],
        ["helloAFTER", { ...whole, buffered: 0, head: "AFTER" }, { ...whole, buffered: 0 }],
      ],
    ],
  ];
  for (const [name, act, rows] of exits) {
    for (const [sent, node, bun = node] of rows) {
      test(`${name}, with ${JSON.stringify(sent)} behind the head`, async () => {
        const upgraded = Promise.withResolvers<AtUpgrade>();
        await listening(
          "http",
          {
            shouldUpgradeCallback(req: http.IncomingMessage) {
              act(req);
              return true;
            },
          } as http.ServerOptions,
          async t => {
            t.server.on("upgrade", (req, socket, head) => {
              socket.on("error", () => {});
              upgraded.resolve({
                complete: req.complete,
                buffered: req.readableLength,
                head: head.toString("latin1"),
                requestDestroyed: req.destroyed,
              });
              socket.destroy();
            });
            const client = await t.connect();
            client.write(fixedLength.head + sent);
            assert.deepStrictEqual(await upgraded.promise, isBun ? bun : node);
          },
        );
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
