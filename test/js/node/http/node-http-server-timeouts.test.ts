import { afterEach, describe, expect, jest, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import { Duplex, duplexPair, pipeline, Writable } from "node:stream";
import tls from "node:tls";

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

// The headers/request sweep of a server, to run it now. Its timer is under the same symbol as in Node.
function sweepOf(server: object) {
  const key = Object.getOwnPropertySymbols(server).find(
    symbol => symbol.description === "http.server.connectionsCheckingInterval",
  )!;
  return () => (server as any)[key]._onTimeout();
}

// One turn of the event loop, so that the server has what a client wrote. Then more turns until the
// clock is `ms` further: a sweep that follows finds a timeout of 1 ms over.
async function clockPasses(ms: number) {
  await new Promise(resolve => setImmediate(resolve));
  const start = performance.now();
  while (performance.now() - start < ms) await new Promise(resolve => setImmediate(resolve));
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
    // The 'error' listeners on a socket at each of its reports. The server's own listener leaves one
    // that does nothing, and a later report must not add another.
    const errorListeners = new Map<unknown, number[]>();
    // Log-only listener: records the error but does NOT destroy the socket.
    server.on("clientError", (err: any, socket) => {
      codes.push(err.code);
      fires.set(socket, (fires.get(socket) ?? 0) + 1);
      errorListeners.set(socket, [...(errorListeners.get(socket) ?? []), socket.listenerCount("error")]);
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
      expect({ codes, fires: [...fires.values()], errorListeners: [...errorListeners.values()] }).toEqual({
        codes: Array(4).fill("ERR_HTTP_REQUEST_TIMEOUT"),
        fires: [2, 1, 1],
        errorListeners: [[1, 1], [1], [1]],
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
      // never runs for a socket destroyed before the expired timer fired.
      expect(timeoutCalls).toEqual([]);
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

// server.setTimeout (applied per connection), req.setTimeout, res.setTimeout
// and req.socket.setTimeout all end up in the server socket's setTimeout,
// which has to check msecs the way net.Socket#setTimeout does.
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
      timeoutAfterRejectedCalls: 0,
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

// A socket that the server gets through server.emit("connection", socket) is parsed in JS, not by
// the native listener. Node has one connection listener for both, so every timeout is the same.
// Each test waits for the event that the timeout produces. Without the timeout it never comes.
describe("node:http server timeouts on a connection from server.emit('connection')", () => {
  const requestTimeoutResponse = "HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n";

  // One duplexPair() per name. emit() gives the server half to the server, and `received` has what
  // each client half read.
  function connectionPairs<const Name extends string>(server: http.Server, names: readonly Name[]) {
    const pairs = Object.fromEntries(names.map(name => [name, duplexPair()])) as Record<
      Name,
      ReturnType<typeof duplexPair>
    >;
    const received = Object.fromEntries(names.map(name => [name, ""])) as Record<Name, string>;
    for (const name of names) {
      pairs[name][0].on("data", chunk => (received[name] += chunk.toString("latin1")));
    }
    return {
      received,
      emit(...emitted: Name[]) {
        for (const name of emitted) server.emit("connection", pairs[name][1]);
      },
      client: (name: Name) => pairs[name][0],
      nameOf: (socket: unknown) => names.find(name => pairs[name][1] === socket),
      destroyed: () => Object.fromEntries(names.map(name => [name, pairs[name][1].destroyed])),
      // duplexPair() does not pass destroy() on to the other half, so this watches the server half.
      // Not events.once(): a half that is destroyed with an error would reject it.
      closed: (...watched: Name[]) =>
        Promise.all(watched.map(name => new Promise<void>(resolve => pairs[name][1].once("close", resolve)))),
      destroyAll() {
        for (const name of names) {
          pairs[name][0].destroy();
          pairs[name][1].destroy();
        }
      },
    };
  }

  // Reads one response that has a Content-Length from the client half of a pair.
  function readResponseBody(clientSide: ReturnType<typeof duplexPair>[0]): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let raw = "";
    function settle(body?: string, error?: Error) {
      clientSide.off("data", onData);
      clientSide.off("close", onClose);
      if (error) reject(error);
      else resolve(body!);
    }
    function onData(chunk: Buffer) {
      raw += chunk.toString("latin1");
      const headersEnd = raw.indexOf("\r\n\r\n");
      if (headersEnd === -1) return;
      const contentLength = /\r\ncontent-length: (\d+)/i.exec(raw.slice(0, headersEnd));
      if (!contentLength) return settle(undefined, new Error(`no Content-Length in: ${JSON.stringify(raw)}`));
      const body = raw.slice(headersEnd + 4);
      if (body.length >= Number(contentLength[1])) settle(body);
    }
    function onClose() {
      settle(undefined, new Error(`closed before the response was complete: ${JSON.stringify(raw)}`));
    }
    clientSide.on("data", onData);
    clientSide.on("close", onClose);
    return promise;
  }

  // The http.Server never listens here. A net.Server accepts each connection and gives it over.
  async function acceptFor(server: http.Server) {
    const accepted: net.Socket[] = [];
    const acceptor = net.createServer(socket => {
      accepted.push(socket);
      server.emit("connection", socket);
    });
    await once(acceptor.listen(0, "127.0.0.1"), "listening");
    return {
      accepted,
      port: (acceptor.address() as net.AddressInfo).port,
      close() {
        acceptor.close();
        for (const socket of accepted) socket.destroy();
      },
    };
  }

  // A raw client. `closed` resolves with everything that it read.
  function connect(port: number, request?: string) {
    const socket = net.connect(port, "127.0.0.1");
    let received = "";
    // Resolves what waitUntil() waits for. Data and close both wake it.
    let wake = () => {};
    socket.on("data", chunk => {
      received += chunk.toString("latin1");
      wake();
    });
    socket.on("error", () => {});
    if (request) socket.on("connect", () => socket.write(request));
    const { promise: closed, resolve } = Promise.withResolvers<string>();
    socket.on("close", () => {
      resolve(received);
      wake();
    });
    return {
      socket,
      closed,
      received: () => received,
      // A connection that closes before the bytes came fails the test with what it got, and does not hang.
      async waitUntil(predicate: (received: string) => boolean) {
        while (!predicate(received)) {
          if (socket.destroyed) throw new Error(`the connection closed, received: ${JSON.stringify(received)}`);
          await new Promise<void>(resolve => (wake = resolve));
        }
        wake = () => {};
      },
    };
  }

  test("headersTimeout and requestTimeout end a connection that sends nothing, half a head or half a body", async () => {
    const heldResponse = Promise.withResolvers<http.ServerResponse>();
    const dispatched: string[] = [];
    const server = http.createServer(
      { headersTimeout: 100, requestTimeout: 200, connectionsCheckingInterval: 10 },
      (req, res) => {
        dispatched.push(req.url!);
        // "/body" gets no answer. Its body never completes, so requestTimeout ends it.
        if (req.url === "/held") heldResponse.resolve(res);
      },
    );
    // Node covers a connection with this sweep only on a server that has listened.
    await listen(server);
    const connections = connectionPairs(server, ["silent", "partial", "body", "held"]);
    try {
      connections.emit("silent", "partial", "body", "held");
      const expired = connections.closed("silent", "partial", "body");
      connections.client("partial").write("GET /partial HTTP/1.1\r\nHost: x\r\n");
      connections.client("body").write("POST /body HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      connections.client("held").write("GET /held HTTP/1.1\r\nHost: x\r\n\r\n");
      const held = await heldResponse.promise;
      await expired;
      expect({ received: connections.received, destroyed: connections.destroyed(), dispatched }).toEqual({
        received: {
          silent: requestTimeoutResponse,
          partial: requestTimeoutResponse,
          body: requestTimeoutResponse,
          held: "",
        },
        destroyed: { silent: true, partial: true, body: true, held: false },
        dispatched: ["/body", "/held"],
      });

      // A request that arrived in full is under neither timeout. It still gets its answer.
      const heldBody = readResponseBody(connections.client("held"));
      held.end("answered");
      expect(await heldBody).toBe("answered");
    } finally {
      connections.destroyAll();
      server.close();
    }
  });

  test("headersTimeout is for each request of a kept-alive connection, and not for a request whose head is complete", async () => {
    const server = http.createServer(
      { headersTimeout: 100, requestTimeout: 60_000, connectionsCheckingInterval: 10 },
      (req, res) => {
        if (req.url !== "/body") return void res.end(`served ${req.url}`);
        let bodyBytes = 0;
        req.on("data", chunk => (bodyBytes += chunk.length));
        req.on("end", () => res.end(`body ${bodyBytes}`));
      },
    );
    await listen(server);
    const connections = connectionPairs(server, ["partial", "reused", "body"]);
    try {
      connections.emit("partial", "reused", "body");
      const expired = connections.closed("partial", "reused");
      // The head of "/body" is complete before the others start, so each sweep that ends them has
      // looked at it too.
      connections.client("body").write("POST /body HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      connections.client("partial").write("GET /partial HTTP/1.1\r\nHost: x\r\n");
      const firstReusedBody = readResponseBody(connections.client("reused"));
      connections.client("reused").write("GET /reused-1 HTTP/1.1\r\nHost: x\r\n\r\n");
      expect(await firstReusedBody).toBe("served /reused-1");
      const firstReusedResponse = connections.received.reused;
      connections.client("reused").write("GET /reused-2 HTTP/1.1\r\n");
      await expired;
      expect({ received: connections.received, destroyed: connections.destroyed() }).toEqual({
        received: {
          partial: requestTimeoutResponse,
          reused: firstReusedResponse + requestTimeoutResponse,
          body: "",
        },
        destroyed: { partial: true, reused: true, body: false },
      });

      const bodyResponse = readResponseBody(connections.client("body"));
      connections.client("body").write("defghij");
      expect(await bodyResponse).toBe("body 10");
    } finally {
      connections.destroyAll();
      server.close();
    }
  });

  test("a request timeout goes to 'clientError' once for each request", async () => {
    const server = http.createServer({ headersTimeout: 50, requestTimeout: 50, connectionsCheckingInterval: 10 });
    await listen(server);
    const connections = connectionPairs(server, ["destroyed", "kept", "later"]);
    const reports: { name: string | undefined; code: string; message: string }[] = [];
    const keptErrorListeners: number[] = [];
    let awaited: { count: number; resolve: () => void } | undefined;
    function reportCountReaches(count: number) {
      if (reports.length >= count) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      awaited = { count, resolve };
      return promise;
    }
    server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
      const name = connections.nameOf(socket);
      reports.push({ name, code: err.code!, message: err.message });
      // "destroyed": the listener of Node's documentation. destroy(err) emits the error on the socket again.
      // "kept": the listener leaves the connection to the next sweeps. The server's own 'error' listener
      // has left one that does nothing, and a later report must not add another.
      if (name === "kept") keptErrorListeners.push(socket.listenerCount("error"));
      else socket.destroy(err);
      if (awaited && reports.length >= awaited.count) awaited.resolve();
    });
    try {
      connections.emit("destroyed", "kept");
      const destroyedClosed = connections.closed("destroyed");
      connections.client("kept").write("GET / HTTP/1.1\r\nHost: x\r\n");
      await reportCountReaches(2);
      await destroyedClosed;
      // "later" starts now. By the time it is reported, the sweep has passed "kept" several more times.
      connections.emit("later");
      await reportCountReaches(3);
      // The end of the request and the start of the next one put "kept" under the timeout again.
      connections.client("kept").write("\r\nGET /next HTTP/1.1\r\n");
      await reportCountReaches(4);

      const report = (name: string) => ({ name, code: "ERR_HTTP_REQUEST_TIMEOUT", message: "Request timeout" });
      const firstTwo = reports.slice(0, 2).sort((a, b) => a.name!.localeCompare(b.name!));
      expect({
        reports: [...firstTwo, ...reports.slice(2)],
        keptErrorListeners,
        // The listener took each report, so the server wrote no 408.
        received: connections.received,
        destroyed: connections.destroyed(),
      }).toEqual({
        reports: [report("destroyed"), report("kept"), report("later"), report("kept")],
        keptErrorListeners: [1, 1],
        received: { destroyed: "", kept: "", later: "" },
        destroyed: { destroyed: true, kept: false, later: true },
      });
    } finally {
      connections.destroyAll();
      server.close();
    }
  });

  test("a request timeout does not write the 408 behind a response head", async () => {
    // Node's socketOnError writes its raw answer only while no byte of a response is out:
    // writeHead() alone sends nothing, the first write() does.
    const server = http.createServer(
      { headersTimeout: 100, requestTimeout: 100, connectionsCheckingInterval: 10 },
      (req, res) => {
        res.writeHead(200, { "content-length": "10" });
        if (req.url === "/written") res.write("partial");
      },
    );
    await listen(server);
    const connections = connectionPairs(server, ["written", "headOnly"]);
    try {
      connections.emit("written", "headOnly");
      const expired = connections.closed("written", "headOnly");
      for (const name of ["written", "headOnly"] as const) {
        connections.client(name).write(`POST /${name} HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc`);
      }
      await expired;
      const [writtenHead, ...writtenAfterHead] = connections.received.written.split("\r\n\r\n");
      expect({
        writtenStatusLine: writtenHead.split("\r\n")[0],
        writtenAfterHead,
        headOnly: connections.received.headOnly,
      }).toEqual({
        writtenStatusLine: "HTTP/1.1 200 OK",
        writtenAfterHead: ["partial"],
        headOnly: requestTimeoutResponse,
      });
    } finally {
      connections.destroyAll();
      server.close();
    }
  });

  test("the sweep covers a connection only when the server has listened before it came", async () => {
    // Node makes the list of connections at the first 'listening' and keeps it. close() stops the sweep.
    const options = { headersTimeout: 50, requestTimeout: 50, connectionsCheckingInterval: 10 };
    const neverListened = http.createServer(options);
    const server = http.createServer(options);
    const onNeverListened = connectionPairs(neverListened, ["silent"]);
    const connections = connectionPairs(server, [
      "beforeListen",
      "beforeListenHalfHead",
      "whileListening",
      "whileClosed",
    ]);
    try {
      onNeverListened.emit("silent");
      connections.emit("beforeListen", "beforeListenHalfHead");
      connections.client("beforeListenHalfHead").write("GET / HTTP/1.1\r\nHost: x\r\n");
      await listen(server);
      connections.emit("whileListening");
      await connections.closed("whileListening");
      // The other three came first. A sweep that covered them has ended them by now.
      expect({
        neverListened: onNeverListened.destroyed().silent,
        beforeListen: connections.destroyed().beforeListen,
        beforeListenHalfHead: connections.destroyed().beforeListenHalfHead,
        whileListening: connections.received.whileListening,
      }).toEqual({
        neverListened: false,
        beforeListen: false,
        beforeListenHalfHead: false,
        whileListening: requestTimeoutResponse,
      });

      await new Promise(resolve => server.close(resolve));
      connections.emit("whileClosed");
      await listen(server);
      await connections.closed("whileClosed");
      expect(connections.received.whileClosed).toBe(requestTimeoutResponse);
    } finally {
      onNeverListened.destroyAll();
      connections.destroyAll();
      server.close();
    }
  });

  test("keepAliveTimeout ends a connection that is idle behind a response", async () => {
    const server = http.createServer({ keepAliveTimeout: 100, keepAliveTimeoutBuffer: 0 }, (req, res) => res.end("ok"));
    const acceptor = await acceptFor(server);
    try {
      // The client sends nothing more, so only the server can close the connection.
      const received = await connect(acceptor.port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n").closed;
      expect(received).toStartWith("HTTP/1.1 200 OK\r\n");
      expect(received.toLowerCase()).toContain("\r\nconnection: keep-alive\r\n");
      expect(received).toEndWith("\r\n\r\nok");
    } finally {
      acceptor.close();
    }
  });

  test("the keep-alive timeout is armed behind a response and ends at the next request", async () => {
    // What net.Socket#setTimeout() recorded, so no timer has to fire. Node arms keepAliveTimeout +
    // keepAliveTimeoutBuffer when a response finishes and no other one waits. The next request puts
    // server.timeout back. A response that closes the connection arms nothing.
    const observed: { url: string; atRequest: number; afterFinish?: number }[] = [];
    const allFinished = Promise.withResolvers<void>();
    const server = http.createServer({ keepAliveTimeout: 10_000, keepAliveTimeoutBuffer: 500 }, (req, res) => {
      const entry: (typeof observed)[number] = { url: req.url!, atRequest: req.socket.timeout! };
      observed.push(entry);
      res.on("finish", () => {
        entry.afterFinish = req.socket.timeout!;
        if (observed.length === 3) allFinished.resolve();
      });
      res.end("ok");
    });
    server.setTimeout(7000);
    const acceptor = await acceptFor(server);
    try {
      const client = connect(acceptor.port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\n");
      const responses = () => client.received().split("\r\n\r\nok").length - 1;
      await client.waitUntil(() => responses() >= 1);
      client.socket.write("GET /2 HTTP/1.1\r\nHost: x\r\n\r\n");
      await client.waitUntil(() => responses() >= 2);
      client.socket.write("GET /3 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      await allFinished.promise;
      await client.closed;
      expect(observed).toEqual([
        { url: "/1", atRequest: 7000, afterFinish: 10_500 },
        { url: "/2", atRequest: 7000, afterFinish: 10_500 },
        { url: "/3", atRequest: 7000, afterFinish: 7000 },
      ]);
    } finally {
      acceptor.close();
    }
  });

  test("server.setTimeout() ends a connection that stays silent, and a 'timeout' listener keeps it", async () => {
    const server = http.createServer((req, res) => res.end("ok"));
    server.setTimeout(100);
    const acceptor = await acceptFor(server);
    try {
      expect(await connect(acceptor.port).closed).toBe("");

      const timedOut = Promise.withResolvers<net.Socket>();
      server.once("timeout", socket => timedOut.resolve(socket));
      const kept = connect(acceptor.port);
      expect(await timedOut.promise).toBe(acceptor.accepted[1]);
      // The listener took the connection, so it still serves a request.
      kept.socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      expect(await kept.closed).toStartWith("HTTP/1.1 200 OK\r\n");
    } finally {
      acceptor.close();
    }
  });

  test("'timeout' goes to the request that still arrives, to the response, then to the server", async () => {
    const events: string[] = [];
    const server = http.createServer((req, res) => {
      req.once("timeout", () => events.push(`req ${req.url}`));
      res.once("timeout", () => events.push(`res ${req.url}`));
      server.once("timeout", () => events.push(`server ${req.url}`));
      // The answer comes from the timeout callback: a timeout that nobody takes destroys the connection.
      if (req.url === "/half-body") req.setTimeout(50, () => res.end("ok"));
      else res.setTimeout(50, () => res.end("ok"));
    });
    const acceptor = await acceptFor(server);
    try {
      // A request that arrived in full does not hear the timeout, as in Node.
      await connect(acceptor.port, "GET /complete HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").closed;
      expect(events.splice(0)).toEqual(["res /complete", "server /complete"]);

      // 3 of the 10 body bytes arrive.
      const stalled = connect(acceptor.port, "POST /half-body HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      await stalled.waitUntil(received => received.endsWith("\r\n\r\nok"));
      expect(events).toEqual(["req /half-body", "res /half-body", "server /half-body"]);
    } finally {
      acceptor.close();
    }
  });

  test("a request whose response ended first still hears the keep-alive timeout", async () => {
    // Node keeps the request as parser.incoming until it ends, so its 'timeout' listener can keep the connection.
    const heard = Promise.withResolvers<string[]>();
    const events: string[] = [];
    const server = http.createServer({ keepAliveTimeout: 100, keepAliveTimeoutBuffer: 0 }, (req, res) => {
      req.on("timeout", () => events.push("req"));
      server.on("timeout", () => {
        events.push("server");
        heard.resolve(events);
      });
      req.resume();
      res.end("early");
    });
    const acceptor = await acceptFor(server);
    try {
      const client = connect(acceptor.port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      expect(await heard.promise).toEqual(["req", "server"]);
      // The server's timer can fire before this side has read the response.
      await client.waitUntil(received => received.endsWith("\r\n\r\nearly"));
      expect({
        answered: client.received().endsWith("\r\n\r\nearly"),
        destroyed: acceptor.accepted[0].destroyed,
      }).toEqual({
        answered: true,
        destroyed: false,
      });
    } finally {
      acceptor.close();
    }
  });

  test("a connection lets go of a request that has arrived, also when its response ended first", async () => {
    // Node's clearIncoming. Else a connection that is idle keeps its last request and all that the request holds.
    const arrived = Promise.withResolvers<http.IncomingMessage>();
    const server = http.createServer((req, res) => {
      req.on("end", () => arrived.resolve(req));
      req.resume();
      res.end("early");
    });
    const acceptor = await acceptFor(server);
    try {
      const client = connect(acceptor.port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      await client.waitUntil(received => received.endsWith("\r\n\r\nearly"));
      client.socket.write("defghij");
      const request = await arrived.promise;
      const socket = acceptor.accepted[0] as unknown as Record<PropertyKey, unknown>;
      expect({
        complete: request.complete,
        heldUnder: Reflect.ownKeys(socket)
          .filter(key => socket[key] === request)
          .map(String),
        destroyed: acceptor.accepted[0].destroyed,
      }).toEqual({ complete: true, heldUnder: [], destroyed: false });
    } finally {
      acceptor.close();
    }
  });

  test("the socket that an 'upgrade' listener gets has no 'timeout' listener of the server, and keeps its timer", async () => {
    const server = http.createServer();
    server.setTimeout(50);
    const handedOff = Promise.withResolvers<number>();
    let handed = false;
    const serverTimeouts: string[] = [];
    // A timeout that comes before the request goes to this listener, so the connection stays whatever
    // the machine's speed. After the hand-off the server must not hear the socket's timeout.
    server.on("timeout", () => serverTimeouts.push(handed ? "after the hand-off" : "before the request"));
    server.on("upgrade", (req, socket) => {
      handed = true;
      handedOff.resolve(socket.listenerCount("timeout"));
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n");
      // The new owner of the socket decides what a timeout means. Here it answers through the tunnel.
      socket.once("timeout", () => socket.end("still open"));
    });
    const acceptor = await acceptFor(server);
    try {
      const client = connect(
        acceptor.port,
        "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n",
      );
      expect(await handedOff.promise).toBe(0);
      const received = await client.closed;
      expect(received).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
      expect(received).toEndWith("\r\n\r\nstill open");
      expect(serverTimeouts.filter(when => when === "after the hand-off")).toEqual([]);
    } finally {
      acceptor.close();
    }
  });

  test("a Duplex that has no setTimeout() is served without socket timers", async () => {
    // As in Node, only a socket that can carry a timeout gets one.
    const responseFinished = Promise.withResolvers<void>();
    const server = http.createServer({ keepAliveTimeout: 50, keepAliveTimeoutBuffer: 0 }, (req, res) => {
      res.on("finish", () => responseFinished.resolve());
      res.end("ok");
    });
    server.setTimeout(50);
    const [clientSide, serverSide] = duplexPair();
    try {
      server.emit("connection", serverSide);
      const body = readResponseBody(clientSide);
      clientSide.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      expect(await body).toBe("ok");
      await responseFinished.promise;
      // Node's listener is there also when the stream never emits the event.
      expect({ destroyed: serverSide.destroyed, timeoutListeners: serverSide.listenerCount("timeout") }).toEqual({
        destroyed: false,
        timeoutListeners: 1,
      });
    } finally {
      clientSide.destroy();
      serverSide.destroy();
    }
  });

  test.each([
    { off: "requestTimeout", options: { headersTimeout: 60_000, requestTimeout: 0 }, lower: "headersTimeout" },
    { off: "headersTimeout", options: { headersTimeout: 0, requestTimeout: 60_000 }, lower: "requestTimeout" },
  ] as const)("$off 0 is off, and the sweep ends what is over the other timeout", async ({ options, lower }) => {
    const server = http.createServer({ ...options, connectionsCheckingInterval: 60_000 });
    await listen(server);
    const sweep = sweepOf(server);
    const connections = connectionPairs(server, ["silent", "halfHead", "halfBody"]);
    try {
      connections.emit("silent", "halfHead", "halfBody");
      connections.client("halfHead").write("GET /head HTTP/1.1\r\nHo");
      connections.client("halfBody").write("POST /body HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      await clockPasses(5);
      sweep();
      expect(connections.destroyed()).toEqual({ silent: false, halfHead: false, halfBody: false });

      // headersTimeout is for a head that is not complete. requestTimeout is for the whole request.
      server[lower] = 1;
      sweep();
      expect(connections.destroyed()).toEqual({ silent: true, halfHead: true, halfBody: lower === "requestTimeout" });
    } finally {
      connections.destroyAll();
      server.close();
    }
  });

  test("the sweep does not report a socket that is destroyed and has not closed yet (Node reports it once)", async () => {
    // This is Bun's rule, on accepted connections too. What destroyed the socket can have released its parser.
    const server = http.createServer({ headersTimeout: 1, requestTimeout: 1, connectionsCheckingInterval: 60_000 });
    const reported: unknown[] = [];
    server.on("clientError", (err, socket) => {
      reported.push((socket as any).name);
      socket.destroy();
    });
    await listen(server);
    let finishDestroy = () => {};
    class SlowCloseDuplex extends Duplex {
      _read() {}
      _write(chunk: unknown, encoding: unknown, callback: () => void) {
        callback();
      }
      _destroy(err: Error | null, callback: (err: Error | null) => void) {
        finishDestroy = () => callback(err);
      }
    }
    const slow: any = new SlowCloseDuplex();
    slow.name = "destroyed, not closed";
    slow.on("error", () => {});
    const [witnessClient, witness] = duplexPair();
    (witness as any).name = "witness";
    try {
      server.emit("connection", slow);
      slow.destroy();
      server.emit("connection", witness);
      await clockPasses(5);
      sweepOf(server)();
      expect(reported).toEqual(["witness"]);
    } finally {
      finishDestroy();
      witnessClient.destroy();
      witness.destroy();
      server.close();
    }
  });

  test("a sweep passes a tunnel socket that came back to the server and died with its 'close' listeners removed", async () => {
    const requestSeen = Promise.withResolvers<net.Socket>();
    const server = http.createServer(
      { headersTimeout: 60_000, requestTimeout: 60_000, connectionsCheckingInterval: 60_000 },
      req => {
        // The listener's cleanup is a 'close' listener. Without it the server keeps the dead socket, with no parser.
        req.socket.removeAllListeners("close");
        requestSeen.resolve(req.socket);
      },
    );
    server.on("connect", (req, socket) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      server.emit("connection", socket);
    });
    const port = await listen(server);
    const sweep = sweepOf(server);
    async function tunnel() {
      const client = connect(port, "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
      await client.waitUntil(received => received.endsWith("Connection Established\r\n\r\n"));
      return client;
    }
    const dead = await tunnel();
    const live = await tunnel();
    try {
      dead.socket.write("POST /x HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      const deadServerSide = await requestSeen.promise;
      // Not events.once(): the reset is an 'error' on this socket, which would reject it.
      const deadClosed = new Promise<void>(resolve => deadServerSide.once("close", () => resolve()));
      dead.socket.resetAndDestroy();
      await deadClosed;
      expect(sweep).not.toThrow();

      // The sweep still reaches the connections behind the dead one. The live tunnel has sent nothing, so
      // the server closes it with nothing unread: the 408 arrives whole on every platform.
      server.headersTimeout = 1;
      await clockPasses(5);
      sweep();
      expect(await live.closed).toEndWith(requestTimeoutResponse);
    } finally {
      dead.socket.destroy();
      live.socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("a connection that comes under fake timers is swept by the real clock", async () => {
    const server = http.createServer({ headersTimeout: 50, requestTimeout: 50, connectionsCheckingInterval: 10 });
    await listen(server);
    const connections = connectionPairs(server, ["silent"]);
    try {
      jest.useFakeTimers();
      try {
        connections.emit("silent");
      } finally {
        jest.useRealTimers();
      }
      await connections.closed("silent");
      expect(connections.received.silent).toBe(requestTimeoutResponse);
    } finally {
      connections.destroyAll();
      server.close();
    }
  });

  test("each response has the server's keepAliveTimeout of that moment in its Keep-Alive header", async () => {
    const server = http.createServer({ keepAliveTimeout: 5000 }, (req, res) => res.end("ok"));
    const connections = connectionPairs(server, ["x"]);
    try {
      connections.emit("x");
      for (const keepAliveTimeout of [5000, 9000]) {
        server.keepAliveTimeout = keepAliveTimeout;
        const body = readResponseBody(connections.client("x"));
        connections.client("x").write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        expect(await body).toBe("ok");
      }
      expect(connections.received.x.split("\r\n").filter(line => /^keep-alive:/i.test(line))).toEqual([
        "Keep-Alive: timeout=5",
        "Keep-Alive: timeout=9",
      ]);
    } finally {
      connections.destroyAll();
    }
  });

  test("the keep-alive timeout is not armed behind a response while a pipelined one waits", async () => {
    // "/a" is held until "/b" has come, so the response to "/b" waits behind it. Node arms the timeout behind "/b" only.
    const observed: { url: string; atRequest: number; afterFinish?: number }[] = [];
    const allFinished = Promise.withResolvers<void>();
    let resA!: http.ServerResponse;
    const server = http.createServer({ keepAliveTimeout: 10_000, keepAliveTimeoutBuffer: 500 }, (req, res) => {
      const entry: (typeof observed)[number] = { url: req.url!, atRequest: req.socket.timeout! };
      observed.push(entry);
      res.on("finish", () => {
        entry.afterFinish = req.socket.timeout!;
        if (req.url === "/b") allFinished.resolve();
      });
      if (req.url === "/a") return void (resA = res);
      resA.once("finish", () => res.end("ok"));
      resA.end("ok");
    });
    server.setTimeout(7000);
    const acceptor = await acceptFor(server);
    try {
      connect(acceptor.port, "GET /a HTTP/1.1\r\nHost: x\r\n\r\n" + "GET /b HTTP/1.1\r\nHost: x\r\n\r\n");
      await allFinished.promise;
      expect(observed).toEqual([
        { url: "/a", atRequest: 7000, afterFinish: 7000 },
        { url: "/b", atRequest: 7000, afterFinish: 10_500 },
      ]);
    } finally {
      acceptor.close();
    }
  });

  test.each([
    ["upgrade", "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n"],
    ["connect", "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"],
  ] as const)(
    "an '%s' listener behind a keep-alive response gets the socket with server.timeout, not the keep-alive timeout",
    async (event, request) => {
      const afterFinish = Promise.withResolvers<number | undefined>();
      const handedOff = Promise.withResolvers<{ timeout: number | undefined; timeoutListeners: number }>();
      const server = http.createServer({ keepAliveTimeout: 10_000, keepAliveTimeoutBuffer: 500 }, (req, res) => {
        res.on("finish", () => afterFinish.resolve(req.socket.timeout));
        res.end("ok");
      });
      server.setTimeout(7000);
      server.on(event, (req, socket) => {
        handedOff.resolve({
          timeout: (socket as net.Socket).timeout,
          timeoutListeners: socket.listenerCount("timeout"),
        });
      });
      const acceptor = await acceptFor(server);
      try {
        const client = connect(acceptor.port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        expect(await afterFinish.promise).toBe(10_500);
        client.socket.write(request);
        expect(await handedOff.promise).toEqual({ timeout: 7000, timeoutListeners: 0 });
      } finally {
        acceptor.close();
      }
    },
  );

  test("the server takes the socket's timeout over from a caller that armed one, as in Node", async () => {
    // The caller's timer is gone after the first response: keepAliveTimeout + keepAliveTimeoutBuffer, then server.timeout.
    const observed = { atRequest: [] as number[], afterFinish: [] as number[] };
    const bothFinished = Promise.withResolvers<void>();
    const server = http.createServer({ keepAliveTimeout: 5000 }, (req, res) => {
      observed.atRequest.push(req.socket.timeout!);
      res.on("finish", () => {
        observed.afterFinish.push(req.socket.timeout!);
        if (observed.afterFinish.length === 2) bothFinished.resolve();
      });
      res.end("ok");
    });
    const acceptor = net.createServer(socket => {
      socket.setTimeout(2_000_000);
      server.emit("connection", socket);
    });
    await once(acceptor.listen(0, "127.0.0.1"), "listening");
    const client = connect((acceptor.address() as net.AddressInfo).port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\n");
    try {
      await client.waitUntil(received => received.endsWith("\r\n\r\nok"));
      client.socket.write("GET /2 HTTP/1.1\r\nHost: x\r\n\r\n");
      await bothFinished.promise;
      expect(observed).toEqual({ atRequest: [2_000_000, 0], afterFinish: [6000, 6000] });
    } finally {
      client.socket.destroy();
      acceptor.close();
    }
  });

  test("a response to a request that said Connection: close destroys the socket, also when the client keeps its side open", async () => {
    const server = http.createServer((req, res) => res.end("ok"));
    const acceptor = await acceptFor(server);
    const client = net.connect({ port: acceptor.port, host: "127.0.0.1", allowHalfOpen: true });
    try {
      client.on("error", () => {});
      let received = "";
      client.on("data", chunk => (received += chunk.toString("latin1")));
      const ended = once(client, "end");
      client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      await ended;
      // The client never sends its FIN. The server does not wait for it.
      if (!acceptor.accepted[0].destroyed) await once(acceptor.accepted[0], "close");
      expect({ answered: received.endsWith("\r\n\r\nok"), destroyed: acceptor.accepted[0].destroyed }).toEqual({
        answered: true,
        destroyed: true,
      });
    } finally {
      client.destroy();
      acceptor.close();
    }
  });

  test("a response to an HTTP/1.0 request ends its socket once, when it has finished", async () => {
    // Without a Content-Length the end of the connection is the end of the body. The server's 'finish'
    // listener ends the socket, before the listeners of the handler, as in Node.
    const events: string[] = [];
    const server = http.createServer((req, res) => {
      req.on("aborted", () => events.push("req aborted"));
      res.on("finish", () => events.push("res finish"));
      res.on("close", () => events.push("res close"));
      res.end("hello");
    });
    const [clientSide, serverSide] = duplexPair();
    const end = serverSide.end;
    serverSide.end = function (...args: Parameters<typeof end>) {
      events.push("socket end()");
      return end.apply(this, args);
    } as typeof end;
    try {
      let received = "";
      clientSide.on("data", chunk => (received += chunk.toString("latin1")));
      const ended = once(clientSide, "end");
      server.emit("connection", serverSide);
      clientSide.write("GET / HTTP/1.0\r\n\r\n");
      await ended;
      if (!events.includes("res close")) await new Promise(resolve => serverSide.once("close", resolve));
      expect({ body: received.split("\r\n\r\n")[1], events }).toEqual({
        body: "hello",
        events: ["socket end()", "res finish", "res close"],
      });
    } finally {
      clientSide.destroy();
      serverSide.destroy();
    }
  });

  test("a timeout that destroys the socket inside a request is no second 'clientError'", async () => {
    // node:net used to emit 'end' on a destroyed socket. The listener read it as the client's EOF inside a request.
    const server = http.createServer({ headersTimeout: 50, requestTimeout: 50, connectionsCheckingInterval: 10 });
    const reports: string[] = [];
    server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
      reports.push(err.code!);
      socket.destroy();
    });
    await listen(server);
    const acceptor = await acceptFor(server);
    try {
      // The sweep reports the half head, and the listener destroys the socket.
      const swept = connect(acceptor.port, "GET / HTTP/1.1\r\nHo");
      await swept.closed;
      if (!acceptor.accepted[0].closed) await once(acceptor.accepted[0], "close");
      expect(reports.splice(0)).toEqual(["ERR_HTTP_REQUEST_TIMEOUT"]);

      // The socket's own timeout ends half a body, with no report at all. The sweep is out of the way.
      server.headersTimeout = 60_000;
      server.requestTimeout = 60_000;
      server.setTimeout(50);
      const timedOut = connect(acceptor.port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      await timedOut.closed;
      if (!acceptor.accepted[1].closed) await once(acceptor.accepted[1], "close");
      expect(reports).toEqual([]);
    } finally {
      acceptor.close();
      server.close();
    }
  });

  test("an Http2Stream given to the server keeps the timer of its session, and its parse error is reported once", async () => {
    // The setTimeout() of a stream arms the one timer of its session here, so the server leaves it alone.
    // In Node a stream has a timer of its own, and the server arms it (#30308).
    const clientErrors: string[] = [];
    const server = http.createServer({ keepAliveTimeout: 100, keepAliveTimeoutBuffer: 0 }, (req, res) => res.end("ok"));
    server.setTimeout(7000);
    server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
      clientErrors.push(err.code!);
      socket.destroy(err);
    });
    const tunnelClosed = Promise.withResolvers<void>();
    // stream_base_commons' setTimeout() keeps the duration here, for a session as for a socket.
    let session!: http2.ServerHttp2Session & { timeout?: number };
    let timeoutListeners = -1;
    const h2 = http2.createServer();
    h2.on("session", serverSession => {
      session = serverSession;
      session.setTimeout(60_000);
    });
    h2.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.respond({ ":status": 200 });
      stream.on("error", () => {});
      stream.on("close", () => tunnelClosed.resolve());
      server.emit("connection", stream);
      timeoutListeners = stream.listenerCount("timeout");
    });
    await once(h2.listen(0, "127.0.0.1"), "listening");
    const client = http2.connect(`http://127.0.0.1:${(h2.address() as net.AddressInfo).port}`);
    try {
      client.on("error", () => {});
      const tunnel = client.request({ ":method": "CONNECT", ":authority": "example.test:80" });
      tunnel.on("error", () => {});
      let received = "";
      tunnel.on("data", chunk => (received += chunk.toString("latin1")));
      await once(tunnel, "response");
      tunnel.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      while (!received.endsWith("\r\n\r\nok")) await once(tunnel, "data");
      const afterResponse = session.timeout;
      tunnel.write("GARBAGE\r\n\r\n");
      await tunnelClosed.promise;
      expect({ timeoutListeners, afterResponse, atTheEnd: session.timeout, clientErrors }).toEqual({
        timeoutListeners: 0,
        afterResponse: 60_000,
        atTheEnd: 60_000,
        clientErrors: ["HPE_INVALID_METHOD"],
      });
    } finally {
      client.destroy();
      h2.close();
    }
  });
});

// Node swaps headersTimeout and requestTimeout when the first is above the second
// (ConnectionsList::Expired). Only a property assignment makes such a pair: the constructor rejects it.
// With the swap, half a head ends at the lower value and half a body at the higher one.
// The higher one is 60 s until the half head is reported, so that report can only come first. It then
// lowers the higher value, and the half body follows: no order here depends on how fast the machine is.
describe("node:http server with headersTimeout above requestTimeout", () => {
  const halfBody = "POST /body HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc";
  const halfHead = "GET /head HTTP/1.1\r\nHo";

  function invertedServer() {
    const order: string[] = [];
    const bothReported = Promise.withResolvers<string[]>();
    const server = http.createServer({ connectionsCheckingInterval: 10 }, () => {});
    server.headersTimeout = 60_000;
    server.requestTimeout = 100;
    server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
      order.push(`${(socket as any).name}: ${err.code}`);
      socket.destroy();
      if (order.length === 1) server.headersTimeout = 150;
      if (order.length === 2) bothReported.resolve(order);
    });
    return { server, bothReported: bothReported.promise };
  }
  // Without the swap both connections are under requestTimeout, and the sweep reports them in the
  // order in which they came: the half body first.
  const swapped = ["half head: ERR_HTTP_REQUEST_TIMEOUT", "half body: ERR_HTTP_REQUEST_TIMEOUT"];

  test("on a connection that the server accepted", async () => {
    const { server, bothReported } = invertedServer();
    const names = ["half body", "half head"];
    server.on("connection", socket => ((socket as any).name = names.shift()));
    const port = await listen(server);
    const clients: net.Socket[] = [];
    try {
      for (const request of [halfBody, halfHead]) {
        // The server has the connection, and its name, before the next one comes.
        const accepted = once(server, "connection");
        const client = net.connect(port, "127.0.0.1", () => client.write(request));
        clients.push(client);
        client.on("error", () => {});
        await accepted;
      }
      expect(await bothReported).toEqual(swapped);
    } finally {
      for (const client of clients) client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("on a connection from server.emit('connection')", async () => {
    const { server, bothReported } = invertedServer();
    await listen(server);
    const pairs = [duplexPair(), duplexPair()];
    try {
      for (const [i, request] of [halfBody, halfHead].entries()) {
        const [clientSide, serverSide] = pairs[i];
        (serverSide as any).name = i === 0 ? "half body" : "half head";
        serverSide.on("error", () => {});
        server.emit("connection", serverSide);
        clientSide.write(request);
      }
      expect(await bothReported).toEqual(swapped);
    } finally {
      for (const [clientSide, serverSide] of pairs) {
        clientSide.destroy();
        serverSide.destroy();
      }
      server.close();
    }
  });

  // A value that is not a finite number above 0 is off, for both kinds of connection. It is not the
  // higher value of a pair, so requestTimeout stays the timeout of half a body. This is the rule of
  // Bun's accepted connections. Node v26.3.0 aborts on a value that is not a number, and reads a
  // negative number as a very long timeout.
  test.each([[Infinity], ["not a number"]])("headersTimeout %p is off and is not swapped", async headersTimeout => {
    const reported: string[] = [];
    const allReported = Promise.withResolvers<void>();
    const names = ["accepted, half body", "accepted, half head", "given, half body", "given, half head"];
    const server = http.createServer({ connectionsCheckingInterval: 10 }, () => {});
    server.headersTimeout = headersTimeout as number;
    server.requestTimeout = 100;
    server.on("connection", socket => ((socket as any).name = names.shift()));
    server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
      reported.push(`${(socket as any).name}: ${err.code}`);
      socket.destroy();
      if (reported.length === 4) allReported.resolve();
    });
    const port = await listen(server);
    const clients: net.Socket[] = [];
    const pairs = [duplexPair(), duplexPair()];
    try {
      for (const request of [halfBody, halfHead]) {
        const accepted = once(server, "connection");
        const client = net.connect(port, "127.0.0.1", () => client.write(request));
        clients.push(client);
        client.on("error", () => {});
        await accepted;
      }
      for (const [i, request] of [halfBody, halfHead].entries()) {
        const [clientSide, serverSide] = pairs[i];
        serverSide.on("error", () => {});
        server.emit("connection", serverSide);
        clientSide.write(request);
      }
      await allReported.promise;
      expect(reported.sort()).toEqual([
        "accepted, half body: ERR_HTTP_REQUEST_TIMEOUT",
        "accepted, half head: ERR_HTTP_REQUEST_TIMEOUT",
        "given, half body: ERR_HTTP_REQUEST_TIMEOUT",
        "given, half head: ERR_HTTP_REQUEST_TIMEOUT",
      ]);
    } finally {
      for (const client of clients) client.destroy();
      for (const [clientSide, serverSide] of pairs) {
        clientSide.destroy();
        serverSide.destroy();
      }
      server.closeAllConnections();
      server.close();
    }
  });
});

// An HTTP/1.1 client of http2.createSecureServer({ allowHTTP1: true }) is served by node:http's
// connection listener, on a TLS socket. Node gives the server http.Server's options and its sweep.
describe("node:http server timeouts on an HTTP/1.1 connection of an http2 server with allowHTTP1", () => {
  const requestTimeoutResponse = "HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n";

  // What storeHTTPOptions puts on the server. The types of node:http2 do not have them.
  type Http1Timeouts = Pick<http.Server, "headersTimeout" | "requestTimeout">;
  function createServer(options: object, listener?: http.RequestListener) {
    const server = http2.createSecureServer({ ...tlsCert, allowHTTP1: true, ...options }, listener as never);
    return server as typeof server & Http1Timeouts;
  }

  async function listenOn(server: http2.Http2SecureServer) {
    await once(server.listen(0, "127.0.0.1"), "listening");
    return (server.address() as net.AddressInfo).port;
  }

  // A net.Server accepts the connection and gives the raw socket to the server, which does the TLS
  // handshake itself. The server listens too: its sweep timer starts there.
  const fronts: net.Server[] = [];
  afterEach(() => {
    for (const front of fronts.splice(0)) front.close();
  });
  async function listenBehindFront(server: http2.Http2SecureServer) {
    await listenOn(server);
    const front = net.createServer(socket => void server.emit("connection", socket));
    fronts.push(front);
    await once(front.listen(0, "127.0.0.1"), "listening");
    return (front.address() as net.AddressInfo).port;
  }
  const entries = {
    "the server accepts the connection": listenOn,
    "a net.Server gives the server the raw socket": listenBehindFront,
  };

  // A raw HTTP/1.1 client. The tests write the requests themselves and watch what the server does
  // with the connection between them and after them.
  async function openHttp1Connection(port: number, allowHalfOpen = false) {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
      allowHalfOpen,
    } as tls.ConnectionOptions);
    socket.setEncoding("utf8");
    let received = "";
    // Resolves what waitUntil() waits for. Data and close both wake it.
    let wake = () => {};
    socket.on("data", chunk => {
      received += chunk;
      wake();
    });
    socket.on("error", () => {});
    const closed = new Promise<void>(resolve =>
      socket.once("close", () => {
        resolve();
        wake();
      }),
    );
    await once(socket, "secureConnect");
    // Each response in these tests is res.end("ok") with a Content-Length.
    const responsesReceived = () => received.split("\r\n\r\nok").length - 1;
    return {
      socket,
      closed,
      received: () => received,
      async waitUntil(predicate: (received: string) => boolean) {
        while (!predicate(received)) {
          if (socket.destroyed) throw new Error(`the connection closed, received: ${JSON.stringify(received)}`);
          await new Promise<void>(resolve => (wake = resolve));
        }
        wake = () => {};
      },
      waitForResponse() {
        const before = responsesReceived();
        return this.waitUntil(() => responsesReceived() > before);
      },
      request(path: string, extraHeaders = "") {
        socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n${extraHeaders}\r\n`);
        return this.waitForResponse();
      },
    };
  }

  // Both entries serve the request on a TLSSocket. tls.Server puts one around a raw socket that it is given.
  describe.each(Object.keys(entries) as (keyof typeof entries)[])("when %s", entry => {
    const listenOn = entries[entry];

    test("keepAliveTimeout ends a connection that is idle behind a response", async () => {
      const serverSocketClosed = Promise.withResolvers<void>();
      const server = createServer({ keepAliveTimeout: 100, keepAliveTimeoutBuffer: 0 }, (req, res) => {
        req.socket.once("close", () => serverSocketClosed.resolve());
        res.end("ok");
      });
      const port = await listenOn(server);
      try {
        const client = await openHttp1Connection(port);
        await client.request("/");
        expect(client.received().toLowerCase()).toContain("\r\nconnection: keep-alive\r\n");
        // The client sends nothing more, so only the server can close the connection.
        await serverSocketClosed.promise;
        await client.closed;
      } finally {
        server.close();
      }
    });

    // What net.Socket#setTimeout() recorded, so no timer has to fire. Node arms keepAliveTimeout +
    // keepAliveTimeoutBuffer when a response finishes and no other one waits. The next request puts
    // server.timeout back. A response that closes the connection arms nothing, and so does keepAliveTimeout 0.
    test.each([
      { label: "no server.timeout", serverTimeout: 0, keepAliveTimeout: 10_000, afterKeepAliveResponse: 10_500 },
      {
        label: "server.setTimeout(7000)",
        serverTimeout: 7000,
        keepAliveTimeout: 10_000,
        afterKeepAliveResponse: 10_500,
      },
      { label: "keepAliveTimeout: 0", serverTimeout: 7000, keepAliveTimeout: 0, afterKeepAliveResponse: 7000 },
    ])(
      "the keep-alive timeout is armed behind a response and ends at the next request ($label)",
      async ({ serverTimeout, keepAliveTimeout, afterKeepAliveResponse }) => {
        const observed: { url: string; atRequest: number; afterFinish?: number }[] = [];
        const allFinished = Promise.withResolvers<void>();
        const server = createServer({ keepAliveTimeout, keepAliveTimeoutBuffer: 500 }, (req, res) => {
          const entry: (typeof observed)[number] = { url: req.url!, atRequest: req.socket.timeout! };
          observed.push(entry);
          res.on("finish", () => {
            entry.afterFinish = req.socket.timeout!;
            if (observed.length === 3) allFinished.resolve();
          });
          res.end("ok");
        });
        if (serverTimeout) server.setTimeout(serverTimeout);
        const port = await listenOn(server);
        try {
          const client = await openHttp1Connection(port);
          await client.request("/1");
          await client.request("/2");
          await client.request("/3", "Connection: close\r\n");
          await allFinished.promise;
          await client.closed;
          expect(observed).toEqual([
            { url: "/1", atRequest: serverTimeout, afterFinish: afterKeepAliveResponse },
            { url: "/2", atRequest: serverTimeout, afterFinish: afterKeepAliveResponse },
            { url: "/3", atRequest: serverTimeout, afterFinish: serverTimeout },
          ]);
        } finally {
          server.close();
        }
      },
    );

    test("the socket that an 'upgrade' listener gets has no 'timeout' listener of the server, and keeps its timer", async () => {
      const server = createServer({});
      server.setTimeout(50);
      let timeoutListenersAtHandoff = -1;
      let handed = false;
      const serverTimeouts: string[] = [];
      // As in the test of the same name above: a timeout before the request keeps the connection.
      server.on("timeout", () => serverTimeouts.push(handed ? "after the hand-off" : "before the request"));
      server.on("upgrade", (req, socket) => {
        handed = true;
        timeoutListenersAtHandoff = socket.listenerCount("timeout");
        socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n");
        // The new owner of the socket decides what a timeout means. Here it answers through the tunnel.
        socket.once("timeout", () => socket.write("still open"));
      });
      const port = await listenOn(server);
      try {
        const client = await openHttp1Connection(port);
        client.socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n");
        await client.waitUntil(received => received.endsWith("still open"));
        expect(client.received()).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
        expect(timeoutListenersAtHandoff).toBe(0);
        expect(serverTimeouts.filter(when => when === "after the hand-off")).toEqual([]);
        client.socket.destroy();
      } finally {
        server.close();
      }
    });

    test("server.setTimeout() ends a connection that stays silent, and a 'timeout' listener keeps it", async () => {
      const server = createServer({}, (req, res) => res.end("ok"));
      server.setTimeout(100);
      const port = await listenOn(server);
      try {
        const silent = await openHttp1Connection(port);
        await silent.closed;
        expect(silent.received()).toBe("");

        const timedOut = Promise.withResolvers<unknown>();
        server.once("timeout", socket => timedOut.resolve(socket));
        const kept = await openHttp1Connection(port);
        // A TLSSocket, or the stand-in for one that serves a raw socket.
        expect(((await timedOut.promise) as tls.TLSSocket).encrypted).toBe(true);
        // The listener took the connection, so it still serves a request.
        await kept.request("/", "Connection: close\r\n");
        expect(kept.received()).toStartWith("HTTP/1.1 200 OK\r\n");
        await kept.closed;
      } finally {
        server.close();
      }
    });

    test("'timeout' goes to the request that still arrives, to the response, then to the server", async () => {
      const events: string[] = [];
      const server = createServer({}, (req, res) => {
        req.once("timeout", () => events.push(`req ${req.url}`));
        res.once("timeout", () => events.push(`res ${req.url}`));
        server.once("timeout", () => events.push(`server ${req.url}`));
        // The answer comes from the timeout callback: a timeout that nobody takes destroys the connection.
        if (req.url === "/half-body") req.setTimeout(50, () => res.end("ok"));
        else res.setTimeout(50, () => res.end("ok"));
      });
      const port = await listenOn(server);
      try {
        // A request that arrived in full does not hear the timeout, as in Node.
        const client = await openHttp1Connection(port);
        await client.request("/complete", "Connection: close\r\n");
        await client.closed;
        expect(events.splice(0)).toEqual(["res /complete", "server /complete"]);

        // 3 of the 10 body bytes arrive.
        const stalled = await openHttp1Connection(port);
        stalled.socket.write("POST /half-body HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\n\r\nabc");
        await stalled.waitForResponse();
        expect(events).toEqual(["req /half-body", "res /half-body", "server /half-body"]);
        stalled.socket.destroy();
      } finally {
        server.close();
      }
    });

    test("the keep-alive timeout is not armed behind a response while a pipelined one waits", async () => {
      // "/a" is held until "/b" has come, so the response to "/b" waits behind it.
      const observed: { url: string; atRequest: number; afterFinish?: number }[] = [];
      const allFinished = Promise.withResolvers<void>();
      let resA!: http.ServerResponse;
      const server = createServer({ keepAliveTimeout: 10_000, keepAliveTimeoutBuffer: 500 }, (req, res) => {
        const entry: (typeof observed)[number] = { url: req.url!, atRequest: req.socket.timeout! };
        observed.push(entry);
        res.on("finish", () => {
          entry.afterFinish = req.socket.timeout!;
          if (req.url === "/b") allFinished.resolve();
        });
        if (req.url === "/a") return void (resA = res);
        resA.once("finish", () => res.end("ok"));
        resA.end("ok");
      });
      server.setTimeout(7000);
      const port = await listenOn(server);
      try {
        const client = await openHttp1Connection(port);
        client.socket.write("GET /a HTTP/1.1\r\nHost: x\r\n\r\n" + "GET /b HTTP/1.1\r\nHost: x\r\n\r\n");
        await allFinished.promise;
        expect(observed).toEqual([
          { url: "/a", atRequest: 7000, afterFinish: 7000 },
          { url: "/b", atRequest: 7000, afterFinish: 10_500 },
        ]);
        client.socket.destroy();
      } finally {
        server.close();
      }
    });

    // The client never ends its side, so only the server can let go of the connection. Node destroys
    // the socket behind the response.
    test.each([
      ["a response to a request that said Connection: close", "Connection: close\r\n"],
      ["the keep-alive timeout", ""],
    ])("%s destroys the socket, also when the client keeps its side open", async (_label, extraHeaders) => {
      const serverSocketClosed = Promise.withResolvers<void>();
      const server = createServer({ keepAliveTimeout: 100, keepAliveTimeoutBuffer: 0 }, (req, res) => {
        req.socket.once("close", () => serverSocketClosed.resolve());
        res.end("ok");
      });
      const port = await listenOn(server);
      const client = await openHttp1Connection(port, true);
      try {
        const ended = once(client.socket, "end");
        client.socket.write(`GET / HTTP/1.1\r\nHost: x\r\n${extraHeaders}\r\n`);
        await Promise.all([serverSocketClosed.promise, ended]);
        expect(client.received()).toEndWith("\r\n\r\nok");
      } finally {
        client.socket.destroy();
        server.close();
      }
    });

    test("the keep-alive timeout waits for a response that is still on its way to the client", async () => {
      // More than the kernel takes at once, to a client that does not read yet.
      const body = Buffer.alloc(16 * 1024 * 1024, "x");
      const largeWritten = Promise.withResolvers<void>();
      const server = createServer({ keepAliveTimeout: 50, keepAliveTimeoutBuffer: 0 }, (req, res) => {
        if (req.url !== "/large") return void res.end("ok");
        res.end(body);
        largeWritten.resolve();
      });
      const port = await listenOn(server);
      const slow = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
      try {
        slow.on("error", () => {});
        await once(slow, "secureConnect");
        slow.write("GET /large HTTP/1.1\r\nHost: x\r\n\r\n");
        await largeWritten.promise;
        // A second connection goes idle behind its response after the large one was written. When the
        // keep-alive timeout has ended it, the same time is over for the first connection too.
        const witness = await openHttp1Connection(port);
        await witness.request("/");
        await witness.closed;
        // Now the client reads, and sends its next request on the same connection.
        let receivedBytes = 0;
        let tail = "";
        const { promise: answered, resolve, reject } = Promise.withResolvers<void>();
        slow.on("data", chunk => {
          receivedBytes += chunk.length;
          tail = (tail + chunk.toString("latin1", Math.max(0, chunk.length - 8))).slice(-8);
          if (receivedBytes > body.length && tail.endsWith("\r\n\r\nok")) resolve();
        });
        slow.on("close", () => reject(new Error(`the connection closed after ${receivedBytes} bytes`)));
        slow.write("GET /small HTTP/1.1\r\nHost: x\r\n\r\n");
        await answered;
      } finally {
        slow.destroy();
        server.close();
      }
    });

    test("a timeout that destroys the socket inside a request is no second 'clientError'", async () => {
      const server = createServer({ headersTimeout: 50, requestTimeout: 50, connectionsCheckingInterval: 10 });
      const reports: string[] = [];
      server.on("clientError", (err: NodeJS.ErrnoException, socket: net.Socket) => {
        reports.push(err.code!);
        socket.destroy();
      });
      const port = await listenOn(server);
      try {
        // The sweep reports the half head, and the listener destroys the socket.
        const swept = await openHttp1Connection(port);
        swept.socket.write("GET / HTTP/1.1\r\nHo");
        await swept.closed;
        expect(reports.splice(0)).toEqual(["ERR_HTTP_REQUEST_TIMEOUT"]);

        // The socket's own timeout ends half a body, with no report at all. The sweep is out of the way.
        server.headersTimeout = 60_000;
        server.requestTimeout = 60_000;
        server.setTimeout(50);
        const timedOut = await openHttp1Connection(port);
        timedOut.socket.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
        await timedOut.closed;
        expect(reports).toEqual([]);
      } finally {
        server.close();
      }
    });
  });

  test("the sweep ends a connection that came as a raw socket and sends nothing or half a head", async () => {
    const server = createServer({ headersTimeout: 50, requestTimeout: 60_000, connectionsCheckingInterval: 10 });
    const port = await listenBehindFront(server);
    try {
      const silent = await openHttp1Connection(port);
      const halfHead = await openHttp1Connection(port);
      halfHead.socket.write("GET / HTTP/1.1\r\nHo");
      await Promise.all([silent.closed, halfHead.closed]);
      expect({ silent: silent.received(), halfHead: halfHead.received() }).toEqual({
        silent: requestTimeoutResponse,
        halfHead: requestTimeoutResponse,
      });
    } finally {
      server.close();
    }
  });

  test("close() completes when a connection that was busy at close() goes idle", async () => {
    const server = createServer({ keepAliveTimeout: 100, keepAliveTimeoutBuffer: 0 }, (req, res) => {
      // The connection is busy, so close() does not take it. The keep-alive timeout behind its response does.
      server.close();
      res.end("ok");
    });
    const serverClosed = once(server, "close");
    const client = await openHttp1Connection(await listenOn(server));
    try {
      await client.request("/");
      await serverClosed;
      await client.closed;
    } finally {
      client.socket.destroy();
    }
  });

  test("headersTimeout and requestTimeout end a connection that sends nothing or half a body, and leave HTTP/2 sessions alone", async () => {
    const heldResponse = Promise.withResolvers<http.ServerResponse>();
    const bodyDispatched = Promise.withResolvers<void>();
    const dispatched: string[] = [];
    // Nothing is under a timeout until every connection is where the test wants it: the sweep reads
    // the two values at each tick, and the test lowers them then.
    const server = createServer(
      { headersTimeout: 60_000, requestTimeout: 60_000, connectionsCheckingInterval: 10 },
      (req, res) => {
        dispatched.push(`HTTP/${req.httpVersion} ${req.url}`);
        if (req.httpVersion === "2.0") res.end("h2");
        else if (req.url === "/held") heldResponse.resolve(res);
        // "/body" gets no answer. Its body never completes, so requestTimeout ends it.
        else if (req.url === "/body") bodyDispatched.resolve();
      },
    );
    const port = await listenOn(server);
    const clients: tls.TLSSocket[] = [];
    let h2: http2.ClientHttp2Session | undefined;

    async function connectHttp1(requestBytes?: string) {
      const accepted = once(server, "secureConnection");
      const client = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
      clients.push(client);
      const connection = {
        client,
        serverSocket: undefined as unknown as tls.TLSSocket,
        received: "",
        closed: new Promise<void>(resolve => client.once("close", () => resolve())),
      };
      client.on("error", () => {});
      client.on("data", chunk => (connection.received += chunk.toString("latin1")));
      await once(client, "secureConnect");
      if (requestBytes) client.write(requestBytes);
      [connection.serverSocket] = await accepted;
      return connection;
    }

    try {
      const held = await connectHttp1("GET /held HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      const silent = await connectHttp1();
      const body = await connectHttp1("POST /body HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\n\r\nabc");
      h2 = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
      h2.on("error", () => {});
      const heldRes = await heldResponse.promise;
      await bodyDispatched.promise;
      server.headersTimeout = 50;
      server.requestTimeout = 100;
      await Promise.all([silent.closed, body.closed]);

      expect({
        received: { silent: silent.received, body: body.received, held: held.received },
        destroyed: {
          silent: silent.serverSocket.destroyed,
          body: body.serverSocket.destroyed,
          held: held.serverSocket.destroyed,
        },
      }).toEqual({
        received: { silent: requestTimeoutResponse, body: requestTimeoutResponse, held: "" },
        destroyed: { silent: true, body: true, held: false },
      });

      // Both timeouts have passed for the held request too. It still gets its answer.
      heldRes.end("answered");
      await held.closed;
      expect(held.received).toStartWith("HTTP/1.1 200 OK\r\n");
      expect(held.received).toEndWith("\r\n\r\nanswered");
      // The session that was there through every sweep still serves a request.
      const h2Status = await new Promise((resolve, reject) => {
        const stream = h2!.request({ ":path": "/h2" });
        stream.on("response", headers => resolve(headers[":status"]));
        stream.on("error", reject);
        stream.end();
      });
      expect({ h2Status, dispatched: dispatched.sort() }).toEqual({
        h2Status: 200,
        dispatched: ["HTTP/1.1 /body", "HTTP/1.1 /held", "HTTP/2.0 /h2"],
      });
    } finally {
      for (const client of clients) client.destroy();
      h2?.destroy();
      server.close();
    }
  });

  // Node stores the HTTP/1 options of an allowHTTP1 server with http.Server's storeHTTPOptions over
  // { ...options, ...options.http1Options }: the same defaults, the same checks. Then it replaces
  // shouldUpgradeCallback with "does 'upgrade' have a listener". The sweep timer starts at 'listening'
  // and close() clears it. Without allowHTTP1 none of this exists.
  test("the server has http.Server's timeout options, and its sweep timer while it listens", async () => {
    const stored = (server: any) => ({
      headersTimeout: server.headersTimeout,
      requestTimeout: server.requestTimeout,
      connectionsCheckingInterval: server.connectionsCheckingInterval,
      keepAliveTimeout: server.keepAliveTimeout,
      keepAliveTimeoutBuffer: server.keepAliveTimeoutBuffer,
    });
    const rejectedWith = (http1Options: object) => {
      try {
        createServer(http1Options);
      } catch (error) {
        return (error as NodeJS.ErrnoException).code;
      }
    };
    let callerUpgradeCallbackCalls = 0;
    const callerUpgradeCallback = () => {
      callerUpgradeCallbackCalls++;
      return true;
    };
    const withUpgradeCallback: any = createServer({ shouldUpgradeCallback: callerUpgradeCallback });
    const upgradeBeforeListener = withUpgradeCallback.shouldUpgradeCallback();
    withUpgradeCallback.on("upgrade", () => {});
    const upgradeWithListener = withUpgradeCallback.shouldUpgradeCallback();
    const withoutAllowHTTP1 = (options: object): any => http2.createSecureServer({ ...tlsCert, ...options });
    expect({
      defaults: stored(createServer({})),
      configured: stored(
        createServer({
          requestTimeout: 30_000,
          connectionsCheckingInterval: 1_000,
          http1Options: { connectionsCheckingInterval: 250, keepAliveTimeoutBuffer: 0 },
        }),
      ),
      requestTimeoutOff: stored(createServer({ requestTimeout: 0 })),
      // Node's storeHTTPOptions makes the property also when the option is not given.
      ownHttpValidation: [createServer({}), http.createServer()].map(server => Object.hasOwn(server, "httpValidation")),
      withoutAllowHTTP1: stored(withoutAllowHTTP1({ headersTimeout: 200, requestTimeout: 100 })),
      rejected: {
        headersTimeoutAboveRequestTimeout: rejectedWith({ headersTimeout: 200, requestTimeout: 100 }),
        negative: rejectedWith({ headersTimeout: -1 }),
        string: rejectedWith({ requestTimeout: "100" }),
        fraction: rejectedWith({ connectionsCheckingInterval: 1.5 }),
        nonFunctionUpgradeCallback: rejectedWith({ shouldUpgradeCallback: 1 }),
      },
      shouldUpgradeCallback: {
        storedCallerCallback: withUpgradeCallback.shouldUpgradeCallback === callerUpgradeCallback,
        callerCallbackCalls: callerUpgradeCallbackCalls,
        upgradeBeforeListener,
        upgradeWithListener,
        withoutAllowHTTP1: withoutAllowHTTP1({ shouldUpgradeCallback: callerUpgradeCallback }).shouldUpgradeCallback,
      },
    }).toEqual({
      defaults: {
        headersTimeout: 60_000,
        requestTimeout: 300_000,
        connectionsCheckingInterval: 30_000,
        keepAliveTimeout: 5_000,
        keepAliveTimeoutBuffer: 1_000,
      },
      configured: {
        headersTimeout: 30_000,
        requestTimeout: 30_000,
        connectionsCheckingInterval: 250,
        keepAliveTimeout: 5_000,
        keepAliveTimeoutBuffer: 0,
      },
      // Node's default for headersTimeout is min(60000, requestTimeout).
      requestTimeoutOff: {
        headersTimeout: 0,
        requestTimeout: 0,
        connectionsCheckingInterval: 30_000,
        keepAliveTimeout: 5_000,
        keepAliveTimeoutBuffer: 1_000,
      },
      ownHttpValidation: [true, true],
      withoutAllowHTTP1: {
        headersTimeout: undefined,
        requestTimeout: undefined,
        connectionsCheckingInterval: undefined,
        keepAliveTimeout: undefined,
        keepAliveTimeoutBuffer: undefined,
      },
      rejected: {
        headersTimeoutAboveRequestTimeout: "ERR_OUT_OF_RANGE",
        negative: "ERR_OUT_OF_RANGE",
        string: "ERR_INVALID_ARG_TYPE",
        fraction: "ERR_OUT_OF_RANGE",
        nonFunctionUpgradeCallback: "ERR_INVALID_ARG_TYPE",
      },
      shouldUpgradeCallback: {
        storedCallerCallback: false,
        callerCallbackCalls: 0,
        upgradeBeforeListener: false,
        upgradeWithListener: true,
        withoutAllowHTTP1: undefined,
      },
    });

    // The timer is under the same symbol as on an http.Server.
    const sweepTimer = (server: any) => {
      const key = Object.getOwnPropertySymbols(server).find(
        symbol => symbol.description === "http.server.connectionsCheckingInterval",
      );
      return key && server[key];
    };
    const listening = createServer({});
    const listeningWithout = withoutAllowHTTP1({});
    try {
      await Promise.all([listenOn(listening), listenOn(listeningWithout)]);
      const timer = sweepTimer(listening);
      expect({
        armed: timer !== undefined,
        keepsProcessAlive: timer?.hasRef(),
        withoutAllowHTTP1: sweepTimer(listeningWithout),
      }).toEqual({ armed: true, keepsProcessAlive: false, withoutAllowHTTP1: undefined });
      await new Promise(resolve => listening.close(resolve));
      expect(timer._destroyed).toBe(true);
      // Each 'listening' starts the sweep again.
      await listenOn(listening);
      expect({ sameTimer: sweepTimer(listening) === timer, destroyed: sweepTimer(listening)._destroyed }).toEqual({
        sameTimer: false,
        destroyed: false,
      });
    } finally {
      if (listening.listening) listening.close();
      listeningWithout.close();
    }
  });
});

// A connection that node:http parses in JS has the server's own 'error' listener, Node's
// socketOnError. It is also what answers a request timeout with the raw 408.
describe("node:http server 'clientError' on a connection from server.emit('connection') or http2 allowHTTP1", () => {
  const rawBadRequest = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n";

  // One duplexPair() per name. The server gets each server half, and `received` has what each client half read.
  function serve<const Name extends string>(server: http.Server, names: readonly Name[]) {
    const pairs = Object.fromEntries(names.map(name => [name, duplexPair()])) as Record<
      Name,
      ReturnType<typeof duplexPair>
    >;
    const received = Object.fromEntries(names.map(name => [name, ""])) as Record<Name, string>;
    for (const name of names) {
      pairs[name][0].on("data", chunk => (received[name] += chunk.toString("latin1")));
      server.emit("connection", pairs[name][1]);
    }
    return {
      received,
      client: (name: Name) => pairs[name][0],
      serverSide: (name: Name) => pairs[name][1],
      nameOf: (socket: unknown) => names.find(name => pairs[name][1] === socket),
      // duplexPair() does not pass destroy() on to the other half, so this watches the server half.
      // Not events.once(): a half that is destroyed with an error would reject it.
      closed: (...watched: Name[]) =>
        Promise.all(watched.map(name => new Promise<void>(resolve => pairs[name][1].once("close", resolve)))),
      destroyAll() {
        for (const name of names) {
          pairs[name][0].destroy();
          pairs[name][1].destroy();
        }
      },
    };
  }

  test("'clientError' gets each error once, and only an error of the parser's execute() carries the bytes", async () => {
    // The listener stops listening before it reports. So the error that the 'clientError' listener destroys the
    // socket with is not reported again.
    const server = http.createServer(() => {});
    const connections = serve(server, ["garbage", "truncated", "reset"]);
    const reports: { name: string | undefined; code: string; message: string; rawPacket: string | undefined }[] = [];
    server.on("clientError", (err: any, socket) => {
      reports.push({
        name: connections.nameOf(socket),
        code: err.code,
        message: err.message,
        rawPacket: err.rawPacket?.toString(),
      });
      socket.destroy(err);
    });
    try {
      const closed = connections.closed("garbage", "truncated", "reset");
      connections.client("garbage").write("GARBAGE\r\n\r\n");
      connections.client("truncated").end("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc");
      connections.serverSide("reset").destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
      await closed;
      reports.sort((a, b) => a.name!.localeCompare(b.name!));
      expect({ reports, received: connections.received }).toEqual({
        reports: [
          {
            name: "garbage",
            code: "HPE_INVALID_METHOD",
            message: "Parse Error: Invalid method encountered",
            rawPacket: "GARBAGE\r\n\r\n",
          },
          { name: "reset", code: "ECONNRESET", message: "read ECONNRESET", rawPacket: undefined },
          { name: "truncated", code: "HPE_INVALID_EOF_STATE", message: "Parse Error", rawPacket: undefined },
        ],
        received: { garbage: "", truncated: "", reset: "" },
      });
    } finally {
      connections.destroyAll();
    }
  });

  test("with no 'clientError' listener a parse error gets one 400, and the socket's own 'error' listeners get the error", async () => {
    const server = http.createServer(() => {});
    // A 'clientError' listener would turn the default answer off, so this counts at the source.
    let clientErrorEmits = 0;
    const emit = server.emit;
    server.emit = function (this: http.Server, event: string | symbol, ...args: any[]) {
      if (event === "clientError") clientErrorEmits++;
      return emit.call(this, event, ...args);
    } as typeof server.emit;
    const socketErrors: { code: string; rawPacket: string }[] = [];
    // Runs after the server's own 'connection' listener.
    server.on("connection", socket => {
      socket.on("error", (err: any) => socketErrors.push({ code: err.code, rawPacket: String(err.rawPacket) }));
    });
    const connections = serve(server, ["garbage"]);
    try {
      const closed = connections.closed("garbage");
      connections.client("garbage").write("GARBAGE\r\n\r\n");
      await closed;
      expect({ clientErrorEmits, received: connections.received, socketErrors }).toEqual({
        clientErrorEmits: 1,
        received: { garbage: rawBadRequest },
        socketErrors: [{ code: "HPE_INVALID_METHOD", rawPacket: "GARBAGE\r\n\r\n" }],
      });
    } finally {
      connections.destroyAll();
    }
  });

  // Node writes its raw answer only while no byte of a response is out ("Caution must be taken to avoid corrupting
  // the remote peer"). writeHead() alone sends nothing. The connection is destroyed in both cases.
  test.each([
    ["garbage bytes", "GET", "\r\n", (client: Duplex) => void client.write("GARBAGE\r\n\r\n")],
    [
      "the end of the stream inside the request body",
      "POST",
      "Content-Length: 10\r\n\r\nabc",
      (client: Duplex) => void client.end(),
    ],
  ] as const)("the default answer to %s is not written behind a response head", async (_what, method, rest, goBad) => {
    const bothHandled = Promise.withResolvers<void>();
    let handled = 0;
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Length": "10" });
      if (req.url === "/written") res.write("hello");
      if (++handled === 2) bothHandled.resolve();
    });
    const connections = serve(server, ["written", "headOnly"]);
    try {
      const closed = connections.closed("written", "headOnly");
      for (const name of ["written", "headOnly"] as const) {
        connections.client(name).write(`${method} /${name} HTTP/1.1\r\nHost: x\r\n${rest}`);
      }
      await bothHandled.promise;
      while (!connections.received.written.endsWith("\r\n\r\nhello")) await once(connections.client("written"), "data");
      goBad(connections.client("written"));
      goBad(connections.client("headOnly"));
      await closed;
      const { written, headOnly } = connections.received;
      expect({
        writtenStatusLine: written.split("\r\n")[0],
        writtenBody: written.slice(written.indexOf("\r\n\r\n") + 4),
        headOnly,
      }).toEqual({ writtenStatusLine: "HTTP/1.1 200 OK", writtenBody: "hello", headOnly: rawBadRequest });
    } finally {
      connections.destroyAll();
    }
  });

  test("an allowHTTP1 connection gets no raw 400 behind a response head, and one 'clientError'", async () => {
    const clientErrors: string[] = [];
    const server = http2.createSecureServer({ ...tlsCert, allowHTTP1: true }, ((
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => {
      res.writeHead(200, { "Content-Length": "10" });
      res.write("hello");
    }) as never);
    // A 'clientError' listener would turn the default answer off, so this counts at the source.
    const emit = server.emit;
    server.emit = function (this: typeof server, event: string | symbol, ...args: any[]) {
      if (event === "clientError") clientErrors.push(args[0].code);
      return emit.call(this, event, ...args);
    } as typeof server.emit;
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const { promise: closed, resolve: onClose } = Promise.withResolvers<string>();
      const socket = tls.connect(
        {
          host: "127.0.0.1",
          port: (server.address() as net.AddressInfo).port,
          rejectUnauthorized: false,
          ALPNProtocols: ["http/1.1"],
        },
        () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"),
      );
      let received = "";
      let sentGarbage = false;
      socket.on("data", chunk => {
        received += chunk;
        if (!sentGarbage && received.endsWith("\r\n\r\nhello")) {
          sentGarbage = true;
          socket.write("GARBAGE\r\n\r\n");
        }
      });
      // The server destroys the connection with no close_notify. The client can report that as an error before 'close'.
      socket.on("error", () => {});
      socket.on("close", () => onClose(received));
      const raw = await closed;
      expect({
        sentGarbage,
        statusLine: raw.split("\r\n")[0],
        body: raw.slice(raw.indexOf("\r\n\r\n") + 4),
        clientErrors,
      }).toEqual({
        sentGarbage: true,
        statusLine: "HTTP/1.1 200 OK",
        body: "hello",
        clientErrors: ["HPE_INVALID_METHOD"],
      });
    } finally {
      server.close();
    }
  });
});
