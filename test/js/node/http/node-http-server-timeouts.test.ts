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

// A write on the response is activity on the connection, like a read: Node's
// net.Socket restarts its inactivity timer in _writeGeneric. Each probe holds
// one request open on a raw TCP socket. The timing checks are one-sided
// ('timeout' must not come sooner than a full period after the activity) or
// compare against a reference timer. Timers fire in deadline order, so a slow
// machine cannot swap the socket's timer and the reference.
describe("node:http response writes restart the socket inactivity timeout", () => {
  const TIMEOUT = 400;
  // The timer clock counts whole milliseconds. A server that ignores the
  // activity fires TIMEOUT / 2 early, far outside this.
  const SLACK = 50;

  // A stalled client never reads, so the server's writes back up.
  async function send(port: number, request: string, stalled = false) {
    const client = net.connect(port, "127.0.0.1");
    if (stalled) client.pause();
    else client.resume();
    await once(client, "connect");
    client.write(request);
    return client;
  }

  // Rejects when the connection fails or closes before the awaited event, so a regression
  // fails at once with the cause. The close at the end of a passing test settles nothing.
  function lost(client: net.Socket) {
    const { promise, reject } = Promise.withResolvers<never>();
    promise.catch(() => {});
    client.on("error", reject);
    client.on("close", () => reject(new Error("the connection closed before the awaited event")));
    return promise;
  }
  const GET = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";

  test.concurrent.each(["server.timeout", "res.setTimeout()", "req.setTimeout()", "socket.setTimeout()"])(
    "%s does not fire while the response keeps writing",
    async armedBy => {
      let lastWriteAt = 0;
      const { promise: firstTimeout, resolve: onFirstTimeout } = Promise.withResolvers<number>();
      const server = http.createServer((req, res) => {
        if (armedBy === "res.setTimeout()") res.setTimeout(TIMEOUT);
        if (armedBy === "req.setTimeout()") req.setTimeout(TIMEOUT);
        if (armedBy === "socket.setTimeout()") req.socket.setTimeout(TIMEOUT);
        req.socket.on("timeout", () => onFirstTimeout(performance.now() - lastWriteAt));
        res.writeHead(200, { "Content-Type": "text/plain" });
        // Stream for longer than the timeout, one chunk every TIMEOUT / 8.
        const startedAt = performance.now();
        const interval = setInterval(() => {
          lastWriteAt = performance.now();
          if (lastWriteAt - startedAt < TIMEOUT * 1.5) {
            res.write("chunk\n");
            return;
          }
          clearInterval(interval);
          res.end("done\n");
        }, TIMEOUT / 8);
        res.on("close", () => clearInterval(interval));
      });
      if (armedBy === "server.timeout") server.timeout = TIMEOUT;
      // The idle connection is closed one more period after the response.
      server.keepAliveTimeout = TIMEOUT;
      server.keepAliveTimeoutBuffer = 0;
      const port = await listen(server);
      let client: net.Socket | undefined;
      try {
        client = await send(port, GET);
        // A server that ignores writes fires within TIMEOUT / 8 of one. A machine that stalls
        // between two writes can only make this longer.
        expect(await Promise.race([firstTimeout, lost(client)])).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
      } finally {
        client?.destroy();
        server.closeAllConnections();
        server.close();
      }
    },
  );

  const activities: Record<string, (res: http.ServerResponse) => void> = {
    "res.write()": res => res.write("chunk\n"),
    "res.end()": res => res.end("done\n"),
    "res.flushHeaders()": res => res.flushHeaders(),
    "res.writeProcessing()": res => res.writeProcessing(),
    "res.writeContinue()": res => res.writeContinue(),
  };

  test.concurrent.each(Object.keys(activities))("the inactivity period restarts at %s", async name => {
    let activityAt = 0;
    let reference: ReturnType<typeof setTimeout> | undefined;
    let referenceFired = false;
    const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<number>();
    const server = http.createServer((req, res) => {
      setTimeout(() => {
        // After the exact deadline (the activity plus TIMEOUT) and before the deadline of
        // a timer that only starts over when it fires (the activity plus 1.5 * TIMEOUT).
        reference = setTimeout(() => (referenceFired = true), TIMEOUT * 1.25);
        activityAt = performance.now();
        activities[name](res);
      }, TIMEOUT / 2);
    });
    server.timeout = TIMEOUT;
    // No keep-alive timeout: server.timeout stays armed after res.end().
    server.keepAliveTimeout = 0;
    server.on("timeout", socket => {
      // Only on a machine that stalls past the timeout before the activity runs. The
      // activity then starts the timer again, and the next 'timeout' is the one measured.
      if (activityAt === 0) return;
      onTimedOut(performance.now());
      socket.destroy();
    });
    const port = await listen(server);
    let client: net.Socket | undefined;
    try {
      client = await send(port, GET);
      const quietFor = (await Promise.race([timedOut, lost(client)])) - activityAt;
      expect(quietFor).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
      expect(referenceFired).toBe(false);
    } finally {
      clearTimeout(reference);
      client?.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test.concurrent("a write after a 'timeout' that kept the socket open starts the timer again", async () => {
    const events: string[] = [];
    let writeAt = 0;
    const { promise: timedOutAgain, resolve: onTimedOutAgain } = Promise.withResolvers<number>();
    let response: http.ServerResponse | undefined;
    const server = http.createServer((req, res) => {
      response = res;
      res.writeHead(200, { "Content-Type": "text/plain" });
    });
    server.timeout = TIMEOUT;
    server.on("timeout", () => {
      events.push("timeout");
      if (writeAt !== 0) return onTimedOutAgain(performance.now());
      // A listener keeps the socket open. Nothing reads or writes until this write.
      setTimeout(() => {
        events.push("write");
        writeAt = performance.now();
        response!.write("late\n");
      }, TIMEOUT / 4);
    });
    const port = await listen(server);
    let client: net.Socket | undefined;
    try {
      client = await send(port, GET);
      const quietFor = (await Promise.race([timedOutAgain, lost(client)])) - writeAt;
      expect(events).toEqual(["timeout", "write", "timeout"]);
      expect(quietFor).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
    } finally {
      client?.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  // Writes that are no activity in Node: write_() drops a write to a response without a body
  // and validates before it sends anything, and a write to a peer that stopped reading only
  // backs up. A server that ignores every write passes these too. They guard against counting
  // such a write, which keeps the connection of a handler that writes forever open.
  const noActivity: Record<string, { request: string; stalled?: boolean; setup: (res: http.ServerResponse) => void }> =
    {
      "a write that a HEAD response discards": {
        request: "HEAD / HTTP/1.1\r\nHost: a\r\n\r\n",
        setup: res => res.writeHead(200, { "Content-Type": "text/event-stream" }),
      },
      "a write that throws": {
        request: GET,
        // The implicit header is invalid, so every write throws before it sends anything.
        setup: res => (res.statusCode = 1000),
      },
      "a write to a peer that stopped reading": {
        request: GET,
        stalled: true,
        // More than the kernel buffers take: this write and every later one back up.
        setup: res => res.write(Buffer.alloc(16 * 1024 * 1024, "a")),
      },
    };

  test.concurrent.each(Object.keys(noActivity))("%s does not restart the timer", async name => {
    let reference: ReturnType<typeof setTimeout> | undefined;
    const { promise: settled, resolve: onSettled } = Promise.withResolvers<string>();
    const server = http.createServer((req, res) => {
      noActivity[name].setup(res);
      const interval = setInterval(() => {
        try {
          res.write("data: ping\n\n");
        } catch {}
      }, TIMEOUT / 8);
      res.on("close", () => clearInterval(interval));
      // Long after the 'timeout' of a connection without activity.
      reference = setTimeout(() => onSettled("the reference timer"), TIMEOUT * 2.5);
    });
    server.timeout = TIMEOUT;
    server.on("timeout", socket => {
      onSettled("'timeout'");
      socket.destroy();
    });
    const port = await listen(server);
    let client: net.Socket | undefined;
    try {
      client = await send(port, noActivity[name].request, noActivity[name].stalled);
      expect(await Promise.race([settled, lost(client)])).toBe("'timeout'");
    } finally {
      clearTimeout(reference);
      client?.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test.concurrent("a request body chunk after a write moved the deadline gets a full period", async () => {
    // The write at 0.6 * TIMEOUT moves the deadline from TIMEOUT to 1.6 * TIMEOUT, and the
    // body chunk arrives between the two. This guards how the deadline moves, not the bug.
    // A server that ignores writes passes too: the 'timeout' at TIMEOUT is swallowed below
    // and the chunk restarts the spent timer. It fails when the expiry puts a new, shorter
    // timer in the slot, because the chunk then refreshes only 0.6 * TIMEOUT.
    let chunkSentAt = 0;
    let chunkReceived = false;
    const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<number>();
    const { promise: wrote, resolve: onWrote } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      req.on("data", chunk => {
        if (chunk.toString("latin1") === "late") chunkReceived = true;
      });
      setTimeout(() => {
        res.write("chunk\n");
        onWrote();
      }, TIMEOUT * 0.6);
    });
    server.timeout = TIMEOUT;
    server.on("timeout", socket => {
      // Before the chunk: a server that ignores writes, or a machine that stalls until the
      // moved deadline has passed. The chunk then starts the timer again.
      if (!chunkReceived) return;
      onTimedOut(performance.now());
      socket.destroy();
    });
    const port = await listen(server);
    let client: net.Socket | undefined;
    try {
      client = await send(port, "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 100\r\n\r\nearly");
      const connectionLost = lost(client);
      await Promise.race([wrote, connectionLost]);
      setTimeout(() => {
        chunkSentAt = performance.now();
        client!.write("late");
      }, TIMEOUT * 0.7);
      const quietFor = (await Promise.race([timedOut, connectionLost])) - chunkSentAt;
      expect(quietFor).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
    } finally {
      client?.destroy();
      server.closeAllConnections();
      server.close();
    }
  });
});
