import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, jest, setSystemTime, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tls as tlsCert } from "harness";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { pipeline, Writable } from "node:stream";
import { text } from "node:stream/consumers";
import tls from "node:tls";

// Each test opens a raw TCP socket against a server whose timeout knob is a
// few hundred ms and waits for the server to close the connection. A small
// connectionsCheckingInterval makes the headers/request sweep run well inside
// the probe window. Every probe awaits the 'close' event rather than a fixed
// delay, so on a build that does not enforce the knob the test times out.

async function listen(server: net.Server) {
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

  test("server.setTimeout callback does not fire after the socket is destroyed (#39681)", async () => {
    const { promise: done, resolve: onDone } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      res.end();
      // Hold the event loop until the socket's 5ms inactivity timer is overdue,
      // so the destroy below races a 'timeout' that is already due.
      const deadline = Date.now() + 25;
      while (Date.now() < deadline) {}
      req.socket.destroy();
      // Timers run in the order they are due: this one runs behind the overdue
      // inactivity timer, so a stale 'timeout' (the bug) has fired by then.
      setTimeout(onDone, 0);
    });
    // Keep the 5ms timer in the slot across the response finish; a keep-alive
    // timeout would replace it with a longer one.
    server.keepAliveTimeout = 0;
    const timeoutCalls: boolean[] = [];
    server.setTimeout(5, (socket: net.Socket) => {
      timeoutCalls.push(socket.destroyed);
    });
    const port = await listen(server);
    try {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("error", () => {});
      socket.resume();
      socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n"));
      await done;
      // Node clears the inactivity timer in Socket._destroy, so the callback
      // never runs for a destroyed socket. The 5ms timer can expire once on the
      // live socket before the request arrives.
      expect(timeoutCalls).not.toContain(true);
      expect(timeoutCalls.length).toBeLessThanOrEqual(1);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("requestTimeout doesn't fire on an idle connection after a Content-Length: 0 request whose head was split across reads", async () => {
    const server = http.createServer({ connectionsCheckingInterval: 25, keepAliveTimeout: 0 }, (req, res) => {
      req.resume();
      res.end("ok");
    });
    server.headersTimeout = 100;
    server.requestTimeout = 100;
    const port = await listen(server);
    const idle = net.connect(port, "127.0.0.1");
    let stalled: net.Socket | undefined;
    try {
      let received = "";
      let wake = Promise.withResolvers<void>();
      idle.setNoDelay(true);
      idle.on("error", () => {});
      idle.on("close", () => wake.resolve());
      idle.on("data", chunk => {
        received += chunk.toString("latin1");
        wake.resolve();
      });
      // Resolves with the number of responses received once there are `count`, or once the server closes the connection.
      const responses = async (count: number) => {
        while ((received.match(/\r\n\r\nok/g) ?? []).length < count && !idle.closed) {
          wake = Promise.withResolvers<void>();
          await wake.promise;
        }
        return (received.match(/\r\n\r\nok/g) ?? []).length;
      };
      idle.write("GET /1 HTTP/1.1\r\nHost: a\r\n\r\nPOST /2 HTTP/1.1\r\nHost: a\r\nContent-Length: 0\r\n");
      expect(await responses(1)).toBe(1);
      idle.write("\r\n");
      expect(await responses(2)).toBe(2);

      // The sweep that closes this stalled upload has also checked the idle connection, whose last request is older.
      stalled = net.connect(port, "127.0.0.1");
      stalled.on("error", () => {});
      stalled.resume();
      stalled.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 50\r\n\r\nab");
      await once(stalled, "close");

      idle.write("GET /3 HTTP/1.1\r\nHost: a\r\n\r\n");
      expect(await responses(3)).toBe(3);
    } finally {
      idle.destroy();
      stalled?.destroy();
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

  test("keepAliveTimeout closes an idle connection after setSystemTime() moved the clock back", async () => {
    const server = http.createServer({ keepAliveTimeout: 200, keepAliveTimeoutBuffer: 0 }, (req, res) => res.end("ok"));
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      await once(socket, "data");
      setSystemTime(new Date(Date.now() - 3_600_000));
      await once(socket, "close");
    } finally {
      setSystemTime();
      socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("keepAliveTimeout closes an idle connection after useFakeTimers()", async () => {
    const server = http.createServer({ keepAliveTimeout: 200, keepAliveTimeoutBuffer: 0 }, (req, res) => res.end("ok"));
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      await once(socket, "data");
      jest.useFakeTimers();
      await once(socket, "close");
    } finally {
      jest.useRealTimers();
      socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  // Timers fire in deadline order, so a slow machine can't reorder these. The check is due after the timeout's first
  // deadline and before the one the write moved it to.
  test.each(["server.timeout", "req.setTimeout()", "res.setTimeout()"])(
    "%s doesn't fire while the response keeps writing",
    async knob => {
      let timedOut = false;
      const server = http.createServer((req, res) => {
        setTimeout(() => res.end(timedOut ? "timed out" : "done"), 700);
        setTimeout(() => res.write("x"), 200);
        if (knob === "req.setTimeout()") req.setTimeout(600);
        if (knob === "res.setTimeout()") res.setTimeout(600);
      });
      if (knob === "server.timeout") server.timeout = 600;
      server.on("timeout", () => {
        timedOut = true;
      });
      const port = await listen(server);
      try {
        const [res] = await once(http.get({ port, host: "127.0.0.1", agent: false }), "response");
        expect(await text(res)).toBe("xdone");
      } finally {
        server.closeAllConnections();
        server.close();
      }
    },
  );

  // The socket's timer is one of bun:test's fake timers here, so a gap of 40 s takes no time.
  describe.each(["http", "https"])("%s, with a timeout of 60 s", scheme => {
    async function exchange(
      knob: string,
      request: string,
      run: (req: http.IncomingMessage, res: http.ServerResponse, client: net.Socket) => Promise<void>,
    ) {
      jest.useFakeTimers();
      const { promise: dispatched, resolve: onRequest } =
        Promise.withResolvers<[http.IncomingMessage, http.ServerResponse]>();
      const server = scheme === "https" ? https.createServer(tlsCert) : http.createServer();
      server.on("request", (req, res) => {
        if (knob === "req.setTimeout()") req.setTimeout(60_000);
        if (knob === "res.setTimeout()") res.setTimeout(60_000);
        if (knob === "req.socket.setTimeout()") req.socket.setTimeout(60_000);
        onRequest([req, res]);
      });
      if (knob === "server.timeout") server.timeout = 60_000;
      if (knob === "server.setTimeout()") server.setTimeout(60_000);
      if (knob === "socket.setTimeout() in a 'connection' listener") {
        server.on("connection", socket => socket.setTimeout(60_000));
      }
      const port = await listen(server);
      const client =
        scheme === "https"
          ? tls.connect({ port, host: "127.0.0.1", ca: tlsCert.cert })
          : net.connect(port, "127.0.0.1");
      try {
        let received = "";
        client.on("error", () => {});
        client.on("data", chunk => {
          received += chunk;
        });
        const closed = new Promise(resolve => client.on("close", resolve));
        client.write(request);
        const [req, res] = await dispatched;
        await run(req, res, client);
        await closed;
        return received;
      } finally {
        jest.useRealTimers();
        client.destroy();
        server.closeAllConnections();
        server.close();
      }
    }
    // Resolves at the next event, or once the connection is gone, so that a cut connection fails the expectation and not the wait.
    const next = (emitter: NodeJS.EventEmitter, event: string, client: net.Socket) =>
      new Promise<void>(resolve => {
        if (client.closed) return resolve();
        emitter.once(event, () => resolve());
        client.once("close", () => resolve());
      });
    const pieces = (received: string) => received.match(/HTTP\/1\.1 \d+|tick;|END/g);
    // Whether the timer cuts the connection in the last of these milliseconds. The connection is gone afterwards either way.
    function cutAfter(ms: number, socket: net.Socket) {
      jest.advanceTimersByTime(ms - 1);
      const early = socket.destroyed;
      jest.advanceTimersByTime(1);
      const onTime = socket.destroyed;
      socket.destroy();
      return { early, onTime };
    }
    const turnOfTheLoop = () => new Promise(resolve => setImmediate(resolve));
    const get = "GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n";
    const getKeepAlive = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";

    test.each([
      "server.timeout",
      "server.setTimeout()",
      "socket.setTimeout() in a 'connection' listener",
      "req.setTimeout()",
      "res.setTimeout()",
      "req.socket.setTimeout()",
    ])("%s doesn't cut a response that writes every 40 s", async knob => {
      const received = await exchange(knob, get, async (req, res, client) => {
        for (let i = 0; i < 4; i++) {
          res.write("tick;");
          await next(client, "data", client);
          jest.advanceTimersByTime(40_000);
        }
        res.end("END");
      });
      expect(pieces(received)).toEqual(["HTTP/1.1 200", "tick;", "tick;", "tick;", "tick;", "END"]);
    });

    test("server.timeout doesn't cut a response that sends 102 Processing every 40 s", async () => {
      const received = await exchange("server.timeout", get, async (req, res, client) => {
        for (let i = 0; i < 4; i++) {
          res.writeProcessing();
          await next(client, "data", client);
          jest.advanceTimersByTime(40_000);
        }
        res.end("END");
      });
      expect(pieces(received)).toEqual([...Array(4).fill("HTTP/1.1 102"), "HTTP/1.1 200", "END"]);
    });

    test("server.timeout doesn't cut an upload that sends every 40 s", async () => {
      const post = "POST / HTTP/1.1\r\nHost: a\r\nConnection: close\r\nContent-Length: 20\r\n\r\n";
      const received = await exchange("server.timeout", post, async (req, res, client) => {
        let body = "";
        req.on("data", chunk => {
          body += chunk;
        });
        req.on("end", () => res.end(body === "tick;tick;tick;tick;" ? "END" : body));
        for (let i = 0; i < 4; i++) {
          jest.advanceTimersByTime(40_000);
          client.write("tick;");
          await next(req, "data", client);
        }
      });
      expect(pieces(received)).toEqual(["HTTP/1.1 200", "END"]);
    });

    test("a connection that leaves HTTP at its second request gets no 'timeout' from the keep-alive timer", async () => {
      let timeouts = 0;
      const received = await exchange("", getKeepAlive, async (req, res, client) => {
        const upgraded = once((req.socket as any).server, "upgrade");
        res.end("END");
        await next(client, "data", client);
        client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
        const [, socket] = await upgraded;
        socket.on("timeout", () => timeouts++);
        jest.advanceTimersByTime(60_000);
        socket.end("HTTP/1.1 101 Switching Protocols\r\n\r\n");
      });
      expect({ timeouts, received: pieces(received) }).toEqual({
        timeouts: 0,
        received: ["HTTP/1.1 200", "END", "HTTP/1.1 101"],
      });
    });

    test("server.timeout cuts a request that gets no answer, and not before the 60 s are over", async () => {
      let cut;
      const received = await exchange("server.timeout", get, async req => {
        cut = cutAfter(60_000, req.socket);
      });
      expect({ cut, received }).toEqual({ cut: { early: false, onTime: true }, received: "" });
    });

    test("server.timeout cuts a response 60 s after its last write", async () => {
      let cut;
      const received = await exchange("server.timeout", get, async (req, res, client) => {
        res.write("tick;");
        await next(client, "data", client);
        jest.advanceTimersByTime(30_000);
        res.write("tick;");
        await next(client, "data", client);
        cut = cutAfter(60_000, req.socket);
      });
      expect({ cut, received: pieces(received) }).toEqual({
        cut: { early: false, onTime: true },
        received: ["HTTP/1.1 200", "tick;", "tick;"],
      });
    });

    test("keepAliveTimeout closes an idle connection after its 5 s and the 1 s of keepAliveTimeoutBuffer", async () => {
      let cut;
      await exchange("", getKeepAlive, async (req, res, client) => {
        res.end("END");
        await next(client, "data", client);
        cut = cutAfter(6_000, req.socket);
      });
      expect(cut).toEqual({ early: false, onTime: true });
    });

    test("keepAliveTimeout counts from the last response of the connection", async () => {
      let cut;
      await exchange("", getKeepAlive, async (req, res, client) => {
        const again = once((req.socket as any).server, "request");
        res.end("END");
        await next(client, "data", client);
        jest.advanceTimersByTime(3_000);
        client.write(getKeepAlive);
        (await again)[1].end("END");
        await next(client, "data", client);
        cut = cutAfter(6_000, req.socket);
      });
      expect(cut).toEqual({ early: false, onTime: true });
    });

    // Windows takes a first send of any size whole, so nothing is queued there.
    describe.skipIf(isWindows)("and a write queue", () => {
      // With these buffers the kernel takes a fraction of the body, and the rest waits in the server's write queue.
      const big = Buffer.alloc(2 << 20, "x");
      function sendBig(how: string, req: http.IncomingMessage, res: http.ServerResponse, client: net.Socket) {
        client.pause();
        setSocketOptions(client, 2, 65536);
        setSocketOptions(req.socket, 1, 65536);
        res.writeHead(200, { "Content-Length": big.length });
        if (how === "res.end(big)") return void res.end(big);
        res.write(big);
        if (how === "res.write(big) and res.end()") res.end();
      }

      async function readALittleEvery60s(res: http.ServerResponse, client: net.Socket) {
        for (let i = 0; i < 4; i++) {
          const queued = res.writableLength;
          client.resume();
          while (queued > 0 && res.writableLength >= queued && !client.closed) await turnOfTheLoop();
          client.pause();
          jest.advanceTimersByTime(60_000);
        }
        client.resume();
      }
      const bodyLengths = (received: string) =>
        received
          .split(/HTTP\/1\.1 200 OK\r\n(?:.+\r\n)+\r\n/)
          .slice(1)
          .map(body => body.length);

      test.each(["res.end(big)", "res.write(big) and res.end()"])(
        "server.timeout doesn't cut %s while the peer reads a little every 60 s",
        async how => {
          const received = await exchange("server.timeout", get, async (req, res, client) => {
            sendBig(how, req, res, client);
            await readALittleEvery60s(res, client);
          });
          expect(bodyLengths(received)).toEqual([big.length]);
        },
      );

      test("server.timeout doesn't cut the second big response of a connection either", async () => {
        let second: http.ServerResponse | undefined;
        const received = await exchange("server.timeout", getKeepAlive, async (req, res, client) => {
          const server: http.Server = (req.socket as any).server;
          sendBig("res.end(big)", req, res, client);
          await readALittleEvery60s(res, client);
          await next(res, "finish", client);
          server.once("request", (req, res) => {
            sendBig("res.end(big)", req, res, client);
            second = res;
          });
          client.write(get);
          await next(server, "request", client);
          if (second) await readALittleEvery60s(second, client);
        });
        expect(bodyLengths(received)).toEqual([big.length, big.length]);
      });

      test("server.timeout cuts an idle connection 60 s after the last byte of a big response went out", async () => {
        let cut;
        await exchange("server.timeout", getKeepAlive, async (req, res, client) => {
          (req.socket as any).server.keepAliveTimeout = 0;
          sendBig("res.end(big)", req, res, client);
          jest.advanceTimersByTime(90_000);
          client.resume();
          await next(res, "finish", client);
          cut = cutAfter(60_000, req.socket);
        });
        expect(cut).toEqual({ early: false, onTime: true });
      });

      // An added chunk can push a few more bytes into the kernel's buffers, and each time that earns the peer another 60 s.
      test.each([
        ["res.end(big)", 2],
        ["res.write(big), and more every 60 s", 9],
      ] as const)("server.timeout cuts %s when the peer reads nothing", async (how, atMost) => {
        let periods = 0;
        await exchange("server.timeout", get, async (req, res, client) => {
          sendBig(how, req, res, client);
          while (!req.socket.destroyed && periods <= atMost) {
            jest.advanceTimersByTime(60_000);
            periods++;
            if (how !== "res.end(big)") res.write("more");
          }
          req.socket.destroy();
          client.resume();
        });
        expect(periods).toBeLessThanOrEqual(atMost);
      });
    });
  });

  test("'timeout' fires again after a write when its listener kept the socket open", async () => {
    let timeouts = 0;
    const server = http.createServer((req, res) => {
      server.once("timeout", () => res.write("x"));
    });
    server.timeout = 200;
    server.on("timeout", socket => {
      if (++timeouts === 2) socket.destroy();
    });
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      socket.resume();
      socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      await once(socket, "close");
      expect(timeouts).toBe(2);
    } finally {
      socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("server.timeout still fires when the handler keeps writing to a client that stopped reading", async () => {
    const chunk = Buffer.alloc(1024 * 1024, "x");
    let interval: ReturnType<typeof setInterval> | undefined;
    const server = http.createServer((req, res) => {
      interval = setInterval(() => res.write(chunk), 20);
    });
    server.timeout = 300;
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      socket.pause();
      socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      const [timedOutSocket] = await once(server, "timeout");
      timedOutSocket.destroy();
    } finally {
      clearInterval(interval);
      socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  // The "tr" column of /proc/net/tcp for the server's end of a connection: "02" while the keep-alive timer is armed.
  function kernelTimer({ localPort, remotePort }: net.Socket) {
    const hex = (port: number | undefined) => ":" + port!.toString(16).toUpperCase().padStart(4, "0");
    for (const line of readFileSync("/proc/self/net/tcp", "utf8").split("\n")) {
      const [, local, remote, , , timer] = line.trim().split(/\s+/);
      if (local?.endsWith(hex(localPort)) && remote.endsWith(hex(remotePort))) return timer.slice(0, 2);
    }
  }

  test.skipIf(!isLinux)("socket.setKeepAlive() and the keepAlive option turn on TCP keep-alive", async () => {
    const timers = async (options: http.ServerOptions) => {
      const server = http.createServer(options, (req, res) => {
        const accepted = kernelTimer(req.socket);
        const enabled = kernelTimer(req.socket.setKeepAlive(true, 1000));
        const disabled = kernelTimer(req.socket.setKeepAlive(false));
        res.end(JSON.stringify({ accepted, enabled, disabled }));
      });
      const port = await listen(server);
      try {
        const [res] = await once(http.get({ port, host: "127.0.0.1", agent: false }), "response");
        return JSON.parse(await text(res));
      } finally {
        server.close();
      }
    };
    expect(await timers({})).toEqual({ accepted: "00", enabled: "02", disabled: "00" });
    expect(await timers({ keepAlive: true, keepAliveInitialDelay: 1000 })).toEqual({
      accepted: "02",
      enabled: "02",
      disabled: "00",
    });
  });

  test("createServer() stores keepAlive and keepAliveInitialDelay like net.Server", () => {
    const { keepAlive, keepAliveInitialDelay } = http.createServer({ keepAlive: true, keepAliveInitialDelay: 2500 });
    expect({ keepAlive, keepAliveInitialDelay }).toEqual({ keepAlive: true, keepAliveInitialDelay: 2 });
    expect(() => http.createServer({ keepAliveInitialDelay: "5" as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

// server.setTimeout (applied per connection), req.setTimeout, res.setTimeout
// and req.socket.setTimeout all end up in the server socket's setTimeout,
// which has to check msecs the way net.Socket#setTimeout does.
describe.concurrent.each(["server.emit('connection')", "an allowHTTP1 http2 server"])(
  "timeouts on an HTTP/1.1 connection from %s",
  kind => {
    // Sends `request`, waits for the server to close the connection, and resolves with what the server reported.
    async function closedBy(options: http.ServerOptions & { timeout?: number }, request: string) {
      const events: string[] = [];
      const { timeout, ...serverOptions } = { connectionsCheckingInterval: 20, ...options };
      const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
        req.resume().on("end", () => res.end("ok"));
      };
      let server: http.Server | http2.Http2SecureServer;
      let listener: net.Server;
      if (kind === "server.emit('connection')") {
        server = http.createServer(serverOptions, handler);
        listener = net.createServer(socket => server.emit("connection", socket));
        // The headersTimeout and requestTimeout sweep starts at 'listening'.
        await listen(server);
      } else {
        server = listener = http2.createSecureServer(
          { ...tlsCert, allowHTTP1: true, ...serverOptions },
          handler as any,
        );
      }
      if (timeout) server.setTimeout(timeout);
      server.on("clientError", (err: NodeJS.ErrnoException, socket: net.Socket) => {
        events.push(err.code!);
        socket.destroy();
      });
      server.on("timeout", (socket: net.Socket) => {
        events.push("timeout");
        socket.destroy();
      });
      const port = await listen(listener);
      const client =
        listener === server
          ? tls.connect({ port, host: "127.0.0.1", ca: tlsCert.cert, ALPNProtocols: ["http/1.1"] })
          : net.connect(port, "127.0.0.1");
      try {
        let received = "";
        client.on("error", () => {});
        client.on("data", chunk => (received += chunk));
        client.write(request);
        await new Promise(resolve => client.on("close", resolve));
        return { events, statusLine: received.split("\r\n")[0] };
      } finally {
        client.destroy();
        listener.close();
        server.close();
      }
    }

    test.each([
      ["headersTimeout", "sends nothing", { headersTimeout: 100 }, ""],
      ["headersTimeout", "sends half a request head", { headersTimeout: 100 }, "GET / HTTP/1.1\r\nHost:"],
      [
        "requestTimeout",
        "sends half a request body",
        { headersTimeout: 100, requestTimeout: 100 },
        "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc",
      ],
    ])("%s closes a connection that %s", async (_, __, options, request) => {
      expect(await closedBy(options, request)).toEqual({ events: ["ERR_HTTP_REQUEST_TIMEOUT"], statusLine: "" });
    });

    test("keepAliveTimeout closes a connection that is idle after a response", async () => {
      const options = { keepAliveTimeout: 100, keepAliveTimeoutBuffer: 0 };
      expect(await closedBy(options, "GET / HTTP/1.1\r\nHost: x\r\n\r\n")).toEqual({
        events: ["timeout"],
        statusLine: "HTTP/1.1 200 OK",
      });
    });

    test("server.setTimeout() closes a connection that sends nothing", async () => {
      expect(await closedBy({ timeout: 100 }, "")).toEqual({ events: ["timeout"], statusLine: "" });
    });
  },
);

test("an allowHTTP1 http2 server listens in a process that never loaded node:http", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const server = require("node:http2").createSecureServer({ allowHTTP1: true });
      server.listen(0, "127.0.0.1", () => {
        console.log("listening");
        server.close();
      });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "listening\n", stderr: "" });
  expect(exitCode).toBe(0);
});

describe.concurrent("node:http server socket setTimeout(msecs) checks", () => {
  const TIMEOUT_MAX = 2 ** 31 - 1;

  function thrownBy(fn: () => unknown) {
    try {
      fn();
      return "did not throw";
    } catch (err: any) {
      return { name: err.constructor.name, code: err.code, message: err.message };
    }
  }

  function outOfRange(received: string) {
    return {
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: `The value of "msecs" is out of range. It must be a non-negative finite number. Received ${received}`,
    };
  }

  function invalidDurations(setTimeout: (msecs: any) => unknown) {
    return {
      negative: thrownBy(() => setTimeout(-1)),
      nan: thrownBy(() => setTimeout(NaN)),
      infinity: thrownBy(() => setTimeout(Infinity)),
      string: thrownBy(() => setTimeout("foo")),
    };
  }

  const expectedInvalidDurations = {
    negative: outOfRange("-1"),
    nan: outOfRange("NaN"),
    infinity: outOfRange("Infinity"),
    string: {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "msecs" argument must be of type number. Received type string ('foo')`,
    },
  };

  test("socket, req and res setTimeout reject invalid msecs like net.Socket#setTimeout", async () => {
    let observed: unknown;
    const server = http.createServer((req, res) => {
      const socket = req.socket;
      observed = {
        socket: invalidDurations(msecs => socket.setTimeout(msecs)),
        req: invalidDurations(msecs => req.setTimeout(msecs)),
        res: invalidDurations(msecs => res.setTimeout(msecs)),
        msecsIsCheckedBeforeCallback: thrownBy(() => socket.setTimeout(-1, "not a function" as any)),
        timeoutAfterRejectedCalls: socket.timeout,
        validCallReturnsSocket: socket.setTimeout(1000) === socket,
        timeoutAfterValidCall: socket.timeout,
      };
      res.end("ok");
    });
    const port = await listen(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.text()).toBe("ok");
    } finally {
      server.closeAllConnections();
      server.close();
    }
    expect(observed).toEqual({
      socket: expectedInvalidDurations,
      req: expectedInvalidDurations,
      res: expectedInvalidDurations,
      msecsIsCheckedBeforeCallback: outOfRange("-1"),
      // net.Socket#setTimeout() stores msecs before it checks it, as in Node.
      timeoutAfterRejectedCalls: -1,
      validCallReturnsSocket: true,
      timeoutAfterValidCall: 1000,
    });
  });

  // Node truncates a duration above 2**31 - 1 ms to that maximum and warns.
  // Passing the raw value on to setTimeout() would instead arm a 1 ms timer
  // (with a different warning), which destroys the connection at once. Both
  // warnings start with the duration, so each case gets its own duration to
  // pick its warning out of the process-wide 'warning' event.
  type Configure = (msecs: number, server: http.Server) => unknown;
  type Arm = (msecs: number, req: http.IncomingMessage, res: http.ServerResponse) => unknown;
  const oversizedDurations: [string, number, Configure | undefined, Arm | undefined][] = [
    ["server.setTimeout()", TIMEOUT_MAX + 1, (msecs, server) => server.setTimeout(msecs), undefined],
    ["req.setTimeout()", TIMEOUT_MAX + 2, undefined, (msecs, req) => req.setTimeout(msecs)],
    ["res.setTimeout()", TIMEOUT_MAX + 3, undefined, (msecs, _req, res) => res.setTimeout(msecs)],
    ["req.socket.setTimeout()", TIMEOUT_MAX + 4, undefined, (msecs, req) => req.socket.setTimeout(msecs)],
  ];
  test.each(oversizedDurations)(
    "%s truncates a duration above 2**31 - 1 ms like net.Socket#setTimeout",
    async (_name, msecs, configure, arm) => {
      const warnings: { name: string; message: string }[] = [];
      const onWarning = (warning: Error) => {
        if (warning.message.startsWith(`${msecs} `)) warnings.push({ name: warning.name, message: warning.message });
      };
      process.on("warning", onWarning);
      const server = http.createServer((req, res) => {
        arm?.(msecs, req, res);
        res.end("ok");
      });
      configure?.(msecs, server);
      const port = await listen(server);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        expect(await response.text()).toBe("ok");
      } finally {
        server.closeAllConnections();
        server.close();
        process.removeListener("warning", onWarning);
      }
      // The warning is emitted while the request is handled, so it has been
      // delivered by the time the response has arrived.
      expect(warnings).toEqual([
        {
          name: "TimeoutOverflowWarning",
          message: `${msecs} does not fit into a 32-bit signed integer.\nTimer duration was truncated to ${TIMEOUT_MAX}.`,
        },
      ]);
    },
  );
});
