import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { pipeline, Writable } from "node:stream";

// Each test opens a raw TCP socket against a server whose timeout knob is a
// few hundred ms and waits for the server to close the connection. A small
// connectionsCheckingInterval makes the headers/request sweep run well inside
// the probe window. Every probe awaits the 'close' event rather than a fixed
// delay, so on a build that does not enforce the knob the test times out.

async function listen(server: http.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
}

describe("node:http server timeout enforcement", () => {
  test("headersTimeout closes a connection that never completes its request headers", async () => {
    const server = http.createServer({ connectionsCheckingInterval: 50 }, (req, res) => {
      req.resume();
      req.on("end", () => res.end("ok"));
    });
    server.headersTimeout = 200;
    server.requestTimeout = 800;
    let clientErrorCode: string | undefined;
    server.on("clientError", (err: any, socket) => {
      clientErrorCode = err.code;
      socket.destroy();
    });
    const port = await listen(server);
    try {
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<number>();
      const socket = net.connect(port, "127.0.0.1");
      const t0 = Date.now();
      socket.setNoDelay(true);
      socket.on("error", () => {});
      socket.resume();
      socket.on("connect", () => {
        // A valid but incomplete request head: no terminating CRLF.
        socket.write("GET / HTTP/1.1\r\nHost: a\r\n");
      });
      socket.on("close", () => onClosed(Date.now() - t0));
      const elapsed = await closed;
      expect({ clientErrorCode, closedPromptly: elapsed < 3000 }).toEqual({
        clientErrorCode: "ERR_HTTP_REQUEST_TIMEOUT",
        closedPromptly: true,
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("requestTimeout closes a connection that stalls mid-body", async () => {
    const server = http.createServer({ connectionsCheckingInterval: 50 }, (req, res) => {
      req.resume();
      req.on("end", () => res.end("ok"));
    });
    server.headersTimeout = 150;
    server.requestTimeout = 300;
    let clientErrorCode: string | undefined;
    server.on("clientError", (err: any, socket) => {
      clientErrorCode = err.code;
      socket.destroy();
    });
    const port = await listen(server);
    try {
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<number>();
      const socket = net.connect(port, "127.0.0.1");
      const t0 = Date.now();
      socket.setNoDelay(true);
      socket.on("error", () => {});
      socket.resume();
      socket.on("connect", () => {
        // Complete headers, then only 2 of the promised 50 body bytes.
        socket.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 50\r\n\r\nab");
      });
      socket.on("close", () => onClosed(Date.now() - t0));
      const elapsed = await closed;
      expect({ clientErrorCode, closedPromptly: elapsed < 3000 }).toEqual({
        clientErrorCode: "ERR_HTTP_REQUEST_TIMEOUT",
        closedPromptly: true,
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("server.setTimeout() fires the 'timeout' event for an inactive connection", async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => res.end("ok"));
    });
    let timeoutFired = false;
    server.setTimeout(200, socket => {
      timeoutFired = true;
      socket.destroy();
    });
    expect(server.timeout).toBe(200);
    const port = await listen(server);
    try {
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<number>();
      const socket = net.connect(port, "127.0.0.1");
      const t0 = Date.now();
      socket.setNoDelay(true);
      socket.on("error", () => {});
      socket.resume();
      // A valid-but-incomplete request head, then silence. headersTimeout
      // and requestTimeout keep their large defaults, so only the
      // server.setTimeout inactivity timer can close this connection.
      socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: a\r\n"));
      socket.on("close", () => onClosed(Date.now() - t0));
      const elapsed = await closed;
      expect({ timeoutFired, closedPromptly: elapsed < 3000 }).toEqual({
        timeoutFired: true,
        closedPromptly: true,
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("keepAliveTimeout closes an idle keep-alive connection after the response", async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.end("ok");
    });
    server.keepAliveTimeout = 200;
    const port = await listen(server);
    try {
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<number>();
      const { promise: gotResponse, resolve: onResponse } = Promise.withResolvers<void>();
      const socket = net.connect(port, "127.0.0.1");
      let t0 = 0;
      socket.setNoDelay(true);
      socket.on("error", () => {});
      socket.resume();
      socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n"));
      socket.once("data", () => {
        t0 = Date.now();
        onResponse();
      });
      socket.on("close", () => onClosed(t0 ? Date.now() - t0 : -1));
      await gotResponse;
      const elapsed = await closed;
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(3000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("emits 'clientError' once per stalled request when the listener keeps the socket open", async () => {
    const server = http.createServer({ connectionsCheckingInterval: 50 }, (req, res) => res.end("ok"));
    server.headersTimeout = 200;
    server.requestTimeout = 800;
    const codes: unknown[] = [];
    const fires = new Map<unknown, number>();
    // Log-only listener: records the error but does NOT destroy the socket.
    server.on("clientError", (err: any, socket) => {
      codes.push(err.code);
      fires.set(socket, (fires.get(socket) ?? 0) + 1);
    });
    const port = await listen(server);
    const clients: net.Socket[] = [];
    const stall = async () => {
      const c = net.connect(port, "127.0.0.1");
      clients.push(c);
      c.on("error", () => {});
      c.setNoDelay(true);
      await once(c, "connect");
      c.write("GET / HTTP/1.1\r\nHost: a\r\n");
      return c;
    };
    const nextDistinctSocket = () => {
      const before = fires.size;
      const { promise, resolve } = Promise.withResolvers<void>();
      const onFire = () => {
        if (fires.size > before) {
          server.removeListener("clientError", onFire);
          resolve();
        }
      };
      server.on("clientError", onFire);
      return promise;
    };
    try {
      // Three stalled sockets, one headersTimeout apart; the first also trickles
      // more header bytes after its timeout (slowloris).
      const first = await stall();
      await nextDistinctSocket();
      first.write("X-Slow: v\r\n");
      await stall();
      await nextDistinctSocket();
      first.write("X-Slow: v\r\n");
      await stall();
      await nextDistinctSocket();
      expect({ codes, fires: [...fires.values()] }).toEqual({
        codes: ["ERR_HTTP_REQUEST_TIMEOUT", "ERR_HTTP_REQUEST_TIMEOUT", "ERR_HTTP_REQUEST_TIMEOUT"],
        fires: [1, 1, 1],
      });

      // Completing the message re-arms: a second stalled request on the same
      // keep-alive socket gets its own timeout.
      let response = "";
      first.on("data", d => (response += d.toString("latin1")));
      first.write("\r\n");
      while (!response.includes("\r\n\r\nok")) await once(first, "data");
      first.write("GET / HTTP/1.1\r\nHost: a\r\n");
      await once(server, "clientError");
      expect({ codes, fires: [...fires.values()] }).toEqual({
        codes: Array(4).fill("ERR_HTTP_REQUEST_TIMEOUT"),
        fires: [2, 1, 1],
      });
    } finally {
      for (const c of clients) c.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("headersTimeout answers 408 when there is no 'clientError' listener", async () => {
    const server = http.createServer({ connectionsCheckingInterval: 50 }, (req, res) => res.end("ok"));
    server.headersTimeout = 200;
    server.requestTimeout = 800;
    const port = await listen(server);
    try {
      const { promise: done, resolve } = Promise.withResolvers<string>();
      const socket = net.connect(port, "127.0.0.1");
      socket.setNoDelay(true);
      let received = "";
      socket.on("data", chunk => {
        received += chunk.toString("latin1");
      });
      socket.on("error", () => {});
      socket.on("close", () => resolve(received));
      socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: a\r\n"));
      const response = await done;
      expect(response).toContain("408 Request Timeout");
      expect(response).toContain("Connection: close");
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("requestTimeout does not fire while a slow handler streams a response", async () => {
    // The request (a body-less GET) is complete as soon as its head is
    // parsed, so requestTimeout must stop ticking even though the handler
    // holds the response open well past it.
    const server = http.createServer({ connectionsCheckingInterval: 25 }, (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("started\n");
      setTimeout(() => res.end("done\n"), 400);
    });
    server.headersTimeout = 100;
    server.requestTimeout = 100;
    let sawClientError = false;
    server.on("clientError", (_err, socket) => {
      sawClientError = true;
      socket.destroy();
    });
    const port = await listen(server);
    try {
      const { promise: done, resolve } = Promise.withResolvers<string>();
      const socket = net.connect(port, "127.0.0.1");
      socket.setNoDelay(true);
      let received = "";
      socket.on("data", chunk => {
        received += chunk.toString("latin1");
      });
      socket.on("error", () => {});
      socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
      socket.on("close", () => resolve(received));
      const response = await done;
      expect({ sawClientError, ok: response.includes("started") && response.includes("done") }).toEqual({
        sawClientError: false,
        ok: true,
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  // A POST whose body stalls is pipelined behind a GET that is never answered,
  // so the GET's response still owns the socket when the inactivity timeout
  // fires. Like Node's socketOnTimeout (`parser.incoming`), the request that is
  // still being received sees 'timeout', not the one that owns the response.
  const pipelinedStalledPost =
    "GET /a HTTP/1.1\r\nHost: a\r\n\r\n" + "POST /b HTTP/1.1\r\nHost: a\r\nContent-Length: 100\r\n\r\n0123456789";

  test("a pipelined request that is still being received gets 'timeout' and can keep the socket", async () => {
    const events: string[] = [];
    const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<void>();
    const server = http.createServer(req => {
      if (req.url !== "/b") return;
      req.setTimeout(200, () => events.push(`POST /b 'timeout' complete=${req.complete}`));
      // Runs after the server's own socket 'timeout' listener, which is the
      // one that destroys the socket when nothing handled the timeout.
      req.socket.on("timeout", () => {
        events.push(`socket destroyed=${req.socket.destroyed}`);
        onTimedOut();
      });
    });
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(pipelinedStalledPost));
      await timedOut;
      expect(events).toEqual(["POST /b 'timeout' complete=false", "socket destroyed=false"]);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("with pipelining, 'timeout' goes to the incoming request, the response that owns the socket, then the server", async () => {
    const events: string[] = [];
    const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      const name = `${req.method} ${req.url}`;
      req.on("timeout", () => events.push(`req ${name} complete=${req.complete}`));
      res.on("timeout", () => events.push(`res ${name}`));
      if (req.url === "/b") req.socket.setTimeout(200);
    });
    server.on("timeout", socket => {
      events.push(`server destroyed=${socket.destroyed}`);
      onTimedOut();
    });
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(pipelinedStalledPost));
      await timedOut;
      expect(events).toEqual(["req POST /b complete=false", "res GET /a", "server destroyed=false"]);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("a pipelined request that stream.pipeline() destroyed does not keep the idle keep-alive socket open", async () => {
    // POST /b is pipelined behind GET /a. Its destination fails, so pipeline()
    // destroys the request and leaves the connection open for the 500. Both
    // responses go out, the client finishes the upload and idles. The destroyed
    // request never completes in JS. Its response has finished, so its
    // 'timeout' listener must not veto the keep-alive timeout.
    const events: string[] = [];
    const { promise: settled, resolve: onSettled } = Promise.withResolvers<void>();
    let resA: http.ServerResponse | undefined;
    const server = http.createServer((req, res) => {
      if (req.url === "/a") {
        resA = res;
        return;
      }
      req.setTimeout(30_000, () => {
        events.push(`req 'timeout' destroyed=${req.destroyed}`);
        onSettled();
      });
      const failing = new Writable({
        write(chunk, encoding, callback) {
          callback(new Error("disk full"));
        },
      });
      pipeline(req, failing, () => {
        res.statusCode = 500;
        res.end("failed");
        resA!.end("a");
      });
    });
    server.keepAliveTimeout = 200;
    server.keepAliveTimeoutBuffer = 0;
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      const body = Buffer.alloc(100, "a").toString();
      let received = "";
      let sentRest = false;
      client.on("error", () => {});
      client.on("connect", () => {
        client.write(
          "GET /a HTTP/1.1\r\nHost: a\r\n\r\n" +
            "POST /b HTTP/1.1\r\nHost: a\r\nContent-Length: 100\r\n\r\n" +
            body.slice(0, 10),
        );
      });
      client.on("data", chunk => {
        received += chunk.toString("latin1");
        // "failed" ends the second response: the client now finishes its upload and idles.
        if (!sentRest && received.endsWith("failed")) {
          sentRest = true;
          client.write(body.slice(10));
        }
      });
      client.on("close", () => {
        events.push("closed by the server");
        onSettled();
      });
      await settled;
      expect({
        responses: received.match(/HTTP\/1\.1 \d+ [^\r]*/g),
        keepAlive: received.match(/^connection: keep-alive\r$/gim)?.length,
        events,
      }).toEqual({
        responses: ["HTTP/1.1 200 OK", "HTTP/1.1 500 Internal Server Error"],
        keepAlive: 2,
        events: ["closed by the server"],
      });
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });
});

// Node emits 'upgrade' as soon as it has the head of an Upgrade request. A
// declared body keeps arriving through `req`, and until it is complete the
// socket inactivity timeout is still the server's business.
describe("socket timeout and an Upgrade request with a body", () => {
  // 10 of the 100 declared body bytes.
  const partialRequest =
    "POST / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: test\r\nContent-Length: 100\r\n\r\n0123456789";

  // shouldUpgradeCallback gets the request before the 'upgrade' listener does.
  // A 'readable' listener there reports isPaused() and stops no reads.
  const readsInReadableMode = (req: http.IncomingMessage) => {
    req.on("readable", () => {
      while (req.read() !== null);
    });
    return true;
  };
  test.each([
    ["emits 'timeout' on the request", "request", { request: true, server: false, destroyed: false }, undefined],
    ["emits 'timeout' on the server", "server", { request: false, server: true, destroyed: false }, undefined],
    ["destroys the socket when nothing listens", "none", { request: false, server: false, destroyed: true }, undefined],
    [
      "destroys the socket when shouldUpgradeCallback started to read the request",
      "none",
      { request: false, server: false, destroyed: true },
      readsInReadableMode,
    ],
  ] as const)("while the body arrives, %s", async (_name, listener, expected, shouldUpgradeCallback) => {
    const server = http.createServer({ shouldUpgradeCallback });
    server.timeout = 200;
    const seen = { request: false, server: false };
    if (listener === "server") server.on("timeout", () => (seen.server = true));
    const { promise: timedOut, resolve: onTimeout } = Promise.withResolvers<object>();
    server.on("upgrade", (req, stream) => {
      stream.on("error", () => {});
      if (listener === "request") req.on("timeout", () => (seen.request = true));
      // The server's own 'timeout' listener is older than this one, so it has
      // already run when this one does.
      req.socket.on("timeout", () => onTimeout({ ...seen, destroyed: req.socket.destroyed }));
    });
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    try {
      const closed = once(client, "close");
      client.write(partialRequest);
      expect(await timedOut).toEqual(expected);
      if (expected.destroyed) await closed;
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("once the body is complete, the timeout belongs to the 'upgrade' listener", async () => {
    const server = http.createServer();
    const { promise: upgraded, resolve: onUpgrade } = Promise.withResolvers<http.IncomingMessage>();
    server.on("upgrade", (req, stream) => {
      stream.on("error", () => {});
      onUpgrade(req);
    });
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    try {
      client.write(partialRequest);
      const req = await upgraded;
      const held = () => ({
        timeoutListeners: req.socket.listenerCount("timeout"),
        parser: req.socket.parser !== null,
      });
      const whileBodyArrives = held();
      // Nothing reads the body. Node completes the message all the same.
      client.write(Buffer.alloc(90, "x"));
      while (!req.complete) await new Promise(resolve => setImmediate(resolve));
      const afterBody = held();

      let requestTimeout = false;
      req.on("timeout", () => (requestTimeout = true));
      const timedOut = once(req.socket, "timeout");
      req.socket.setTimeout(200);
      await timedOut;
      expect({ whileBodyArrives, afterBody, requestTimeout, destroyed: req.socket.destroyed }).toEqual({
        whileBodyArrives: { timeoutListeners: 1, parser: true },
        afterBody: { timeoutListeners: 0, parser: false },
        requestTimeout: false,
        destroyed: false,
      });
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  // Bun sees the end of the body only while it reads the connection and the
  // request. In every flow below the body is complete on the wire, so Node has
  // released the socket, and the timeout must not cost the listener its tunnel.
  const restOfBody = Buffer.alloc(90, "x").toString();
  const chunkedHead =
    "POST / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: test\r\nTransfer-Encoding: chunked\r\n\r\n";
  // One chunk above the request buffer of the server below, then the last chunk.
  const chunkedBody = "7d0\r\n" + Buffer.alloc(2000, "x").toString() + "\r\n0\r\n\r\n";
  const failingDestination = () =>
    new Writable({ write: (_chunk, _encoding, callback) => callback(new Error("full")) });
  type Flow = {
    // What the client writes before 'upgrade' and after it.
    writes?: [string, string?];
    server?: http.ServerOptions;
    listener(req: http.IncomingMessage, stream: net.Socket): void | Promise<unknown>;
    clientReceives?: string;
  };
  test.each<[string, Flow]>([
    [
      "pauses the request, body in the same write",
      { writes: [partialRequest + restOfBody], listener: req => void req.pause() },
    ],
    ["pauses the request, rest of the body later", { listener: req => void req.pause() }],
    ["pauses the socket", { listener: (_req, stream) => void stream.pause() }],
    [
      "gets a request that shouldUpgradeCallback paused",
      { server: { shouldUpgradeCallback: req => (req.pause(), true) }, listener: () => {} },
    ],
    [
      "leaves a for await loop over the request",
      {
        listener: async req => {
          for await (const _chunk of req) break;
        },
      },
    ],
    [
      "pipes the request into a stream that fails",
      { listener: req => new Promise(resolve => pipeline(req, failingDestination(), resolve)) },
    ],
    [
      "dumps the request while it reads it",
      {
        listener: async req => {
          await once(req, "data");
          await new Promise(resolve => setImmediate(resolve));
          (req as http.IncomingMessage & { _dump(): void })._dump();
        },
      },
    ],
    [
      "reads nothing and one read fills the request buffer and ends the body",
      { writes: [chunkedHead + chunkedBody], server: { highWaterMark: 1024 }, listener: () => {} },
    ],
    // Bun reads nothing more once its side is shut down. The client keeps its side open.
    ["ends its side of the socket", { listener: (_req, stream) => void stream.end("bye"), clientReceives: "bye" }],
  ])("the tunnel survives the timeout when the listener %s", async (_name, flow) => {
    const [beforeUpgrade, afterUpgrade] = flow.writes ?? [partialRequest, restOfBody];
    const server = http.createServer(flow.server ?? {});
    server.timeout = 200;
    const { promise: upgraded, resolve: onUpgrade } = Promise.withResolvers<net.Socket>();
    const { promise: timedOut, resolve: onTimeout } = Promise.withResolvers<boolean>();
    server.on("upgrade", async (req, stream) => {
      stream.on("error", () => {});
      req.on("error", () => {});
      // Runs after the server's own 'timeout' listener, when that one is still there.
      const socket = req.socket;
      socket.on("timeout", () => onTimeout(socket.destroyed));
      // A close before the timeout fails the test too. It must not hang it.
      socket.on("close", () => onTimeout(true));
      await flow.listener(req, stream);
      onUpgrade(stream);
    });
    const port = await listen(server);
    const client = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    client.on("error", () => {});
    const expected = flow.clientReceives ?? "still open";
    const { promise: receivedAll, resolve: onReceivedAll, reject: onClientClose } = Promise.withResolvers<void>();
    receivedAll.catch(() => {});
    let received = "";
    client.on("data", chunk => {
      received += chunk;
      if (received.length >= expected.length) onReceivedAll();
    });
    client.on("close", () => onClientClose(new Error(`the client socket closed after ${JSON.stringify(received)}`)));
    try {
      client.write(beforeUpgrade);
      const stream = await upgraded;
      if (afterUpgrade) client.write(afterUpgrade);
      expect(await timedOut).toBe(false);
      // Only the flow that ends the socket has sent its text already.
      expect(stream.writable).toBe(flow.clientReceives === undefined);
      if (stream.writable) stream.write(expected);
      await receivedAll;
      expect(received).toBe(expected);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("the release after the body leaves a parser alone that the 'upgrade' listener put on the socket", async () => {
    const server = http.createServer();
    type Parser = { freed: boolean; free(): void };
    const { promise: upgraded, resolve: onUpgrade } = Promise.withResolvers<[http.IncomingMessage, Parser]>();
    server.on("upgrade", (req, stream) => {
      stream.on("error", () => {});
      // http.request({ createConnection: () => socket }) puts its HTTPParser there.
      const parser: Parser = { freed: false, free: () => void (parser.freed = true) };
      (req.socket as net.Socket & { parser: unknown }).parser = parser;
      onUpgrade([req, parser]);
    });
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    try {
      client.write(partialRequest);
      const [req, parser] = await upgraded;
      client.write(restOfBody);
      while (!req.complete) await new Promise(resolve => setImmediate(resolve));
      const socket = req.socket as net.Socket & { parser: unknown };
      expect({
        kept: socket.parser === parser,
        freed: parser.freed,
        timeoutListeners: socket.listenerCount("timeout"),
      }).toEqual({ kept: true, freed: false, timeoutListeners: 0 });
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test.each([
    ["upgrade", "GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n"],
    ["connect", "CONNECT a:443 HTTP/1.1\r\nHost: a:443\r\n\r\n"],
  ])("without a body, the '%s' listener gets a socket that the server has released", async (event, request) => {
    const server = http.createServer();
    const { promise: handedOff, resolve: onHandoff } = Promise.withResolvers<object>();
    server.on(event, (_req, socket: net.Socket & { parser: unknown }) => {
      socket.on("error", () => {});
      onHandoff({ timeoutListeners: socket.listenerCount("timeout"), parser: socket.parser });
    });
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    try {
      client.write(request);
      expect(await handedOff).toEqual({ timeoutListeners: 0, parser: null });
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });
});
