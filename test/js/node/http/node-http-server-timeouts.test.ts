import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir, tls as tlsOptions } from "harness";
import { once } from "node:events";
import { readSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import { pipeline, Writable } from "node:stream";
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

// Closes the server and waits for its connections. A connection frees its response on a later turn
// of the event loop than the one that closes it, and the last test of the file must not end before that.
async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

// For setSocketOptions(). A small kernel buffer keeps most of a large write with the server, whatever the limits of the machine are.
const KERNEL_BUFFER = 64 * 1024;

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

  // The reset of the peer and the request of another connection reach the server together. The handler of
  // that request keeps the event loop past the deadline of the timer, so the timer is due when the connection
  // has closed and its 'close' is not out yet. Node emits no 'timeout' there.
  test.each(["socket.setTimeout()", "keepAliveTimeout"])(
    "no 'timeout' from %s on a connection that its peer has reset",
    async armedBy => {
      const TIMEOUT = 400;
      let deadline = 0;
      let expiriesBehindTheClose = 0;
      let timeoutsBehindTheClose = 0;
      let reset: net.Socket | undefined;
      let other: net.Socket | undefined;
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        if (req.url === "/busy") {
          // No event to wait for: the event loop must not turn before the timer is due.
          while (performance.now() < deadline + 50) {}
          res.end();
          return;
        }
        const socket = req.socket as net.Socket & { _onTimeout(): void };
        // The native connection says when it has closed.
        const handle = (socket as any)[
          Object.getOwnPropertySymbols(socket).find(symbol => symbol.description === "handle")!
        ];
        // Every expiry of the timer comes through here.
        const onTimeout = socket._onTimeout;
        socket._onTimeout = function () {
          if (handle.closed) expiriesBehindTheClose++;
          return onTimeout.call(this);
        };
        socket.on("timeout", () => handle.closed && timeoutsBehindTheClose++);
        socket.on("close", onClosed);
        for (const stream of [socket, req, res]) stream.on("error", () => {});
        const armed = () => {
          deadline = performance.now() + TIMEOUT;
          // On the next turn, when the server has left the read of this connection.
          setImmediate(() => {
            reset!.resetAndDestroy();
            other!.write("GET /busy HTTP/1.1\r\nHost: a\r\n\r\n");
            // Both are at the sockets of the server before the event loop asks the kernel again. The loopback of macOS delivers on another thread.
            Bun.sleepSync(10);
          });
        };
        if (armedBy === "keepAliveTimeout") {
          // The keep-alive timeout starts behind the response.
          res.on("finish", armed);
          res.end();
        } else {
          socket.setTimeout(TIMEOUT);
          armed();
        }
      });
      server.keepAliveTimeout = TIMEOUT;
      server.keepAliveTimeoutBuffer = 0;
      // Keeps a socket that times out, so its 'close' comes from the reset alone.
      server.on("timeout", () => {});
      const port = await listen(server);
      try {
        other = net.connect(port, "127.0.0.1");
        other.on("error", () => {});
        other.resume();
        await once(other, "connect");
        reset = net.connect(port, "127.0.0.1");
        reset.on("error", () => {});
        reset.resume();
        await once(reset, "connect");
        reset.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
        await closed;
        // The timer came due behind the close, once. Without that the absence of a 'timeout' proves nothing.
        expect({ expiriesBehindTheClose, timeoutsBehindTheClose }).toEqual({
          expiriesBehindTheClose: 1,
          timeoutsBehindTheClose: 0,
        });
      } finally {
        reset?.destroy();
        other?.destroy();
        await close(server);
      }
    },
  );
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

// What the server writes is activity on the connection, like what it reads: Node's
// net.Socket restarts its inactivity timer when it hands a write to the handle and
// when a pending write completes. Each probe holds one request open on a raw TCP
// socket. A timing check is one-sided ('timeout' must not come sooner than a full
// period after the activity) or compares against a reference timer. Timers fire in
// deadline order, so a slow machine cannot swap the socket's timer and the reference.
describe("node:http server writes restart the socket inactivity timeout", () => {
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

  test.concurrent.each([
    "server.timeout",
    "server.setTimeout(ms, callback)",
    "res.setTimeout(ms)",
    "res.setTimeout(ms, callback)",
    "req.setTimeout(ms)",
    "socket.setTimeout(ms)",
  ])("%s does not fire while the response keeps writing", async armedBy => {
    let lastWriteAt = 0;
    const { promise: firstTimeout, resolve: onFirstTimeout } = Promise.withResolvers<number>();
    const onTimeout = () => onFirstTimeout(performance.now() - lastWriteAt);
    const server = http.createServer((req, res) => {
      if (armedBy === "res.setTimeout(ms)") res.setTimeout(TIMEOUT);
      if (armedBy === "res.setTimeout(ms, callback)") res.setTimeout(TIMEOUT, onTimeout);
      if (armedBy === "req.setTimeout(ms)") req.setTimeout(TIMEOUT);
      if (armedBy === "socket.setTimeout(ms)") req.socket.setTimeout(TIMEOUT);
      req.socket.on("timeout", onTimeout);
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
    if (armedBy === "server.setTimeout(ms, callback)") server.setTimeout(TIMEOUT, onTimeout);
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
      await close(server);
    }
  });

  // Between two requests the keep-alive timeout takes the place of the socket's timer, and the
  // next request arms the first one again. With the same period the two share one timer.
  test.concurrent.each([
    ["server.timeout", 1.5],
    ["res.setTimeout(ms)", 1.5],
    ["server.timeout", 1],
  ])(
    "%s lets each response on a kept-alive connection stream past it, then a keepAliveTimeout %s times as long closes the connection",
    async (armedBy, factor) => {
      const KEEP_ALIVE = TIMEOUT * factor;
      let lastWriteAt = 0;
      let timedOutAt = 0;
      let responses = 0;
      let reference: ReturnType<typeof setTimeout> | undefined;
      const { promise: settled, resolve: onSettled } = Promise.withResolvers<string>();
      const server = http.createServer((req, res) => {
        if (armedBy === "res.setTimeout(ms)") res.setTimeout(TIMEOUT);
        res.writeHead(200, { "Content-Type": "text/plain" });
        const startedAt = performance.now();
        const interval = setInterval(() => {
          lastWriteAt = performance.now();
          if (lastWriteAt - startedAt < TIMEOUT * 1.25) {
            res.write("chunk\n");
            return;
          }
          clearInterval(interval);
          res.end("done\n");
          // Long after the keep-alive timeout of the idle connection.
          if (++responses === 2) reference = setTimeout(() => onSettled("the reference timer"), KEEP_ALIVE * 3);
        }, TIMEOUT / 8);
        res.on("close", () => clearInterval(interval));
      });
      if (armedBy === "server.timeout") server.timeout = TIMEOUT;
      server.keepAliveTimeout = KEEP_ALIVE;
      server.keepAliveTimeoutBuffer = 0;
      server.on("timeout", socket => {
        timedOutAt = performance.now();
        // A machine that stalls for a whole period between two writes gets a 'timeout' that is due. The listener keeps the socket.
        if (responses < 2 && timedOutAt - lastWriteAt >= TIMEOUT - SLACK) return;
        onSettled(`'timeout' after ${responses} responses`);
        socket.destroy();
      });
      const port = await listen(server);
      let client: net.Socket | undefined;
      try {
        client = await send(port, GET);
        let received = "";
        let requests = 1;
        client.on("data", chunk => {
          received += chunk;
          // The end of the first response: the connection is idle now.
          if (requests === 1 && received.endsWith("done\n\r\n0\r\n\r\n")) {
            requests++;
            client!.write(GET);
          }
        });
        expect(await Promise.race([settled, lost(client)])).toBe("'timeout' after 2 responses");
        expect(timedOutAt - lastWriteAt).toBeGreaterThanOrEqual(KEEP_ALIVE - SLACK);
      } finally {
        clearTimeout(reference);
        client?.destroy();
        await close(server);
      }
    },
  );

  // One case for each way the server puts bytes on the connection, and for each call that puts
  // none there in Node. `before` runs when the request arrives, `act` half a period later.
  type Act = (res: http.ServerResponse) => void;
  const activities: Record<string, { counts: boolean; before?: Act; act: Act }> = {
    "res.write()": { counts: true, act: res => res.write("chunk\n") },
    "res.write('')": { counts: true, before: res => res.write("chunk\n"), act: res => res.write("") },
    "res.end(chunk)": { counts: true, act: res => res.end("done\n") },
    "res.end() that sends the last chunk": { counts: true, before: res => res.write("chunk\n"), act: res => res.end() },
    "res.flushHeaders()": { counts: true, act: res => res.flushHeaders() },
    "res.writeContinue()": { counts: true, act: res => res.writeContinue() },
    "res.writeProcessing()": { counts: true, act: res => res.writeProcessing() },
    "res.writeEarlyHints()": {
      counts: true,
      act: res => res.writeEarlyHints({ link: "</a.css>; rel=preload; as=style" }),
    },
    "res.writeHead()": { counts: false, act: res => res.writeHead(200) },
    "res.end() behind a complete body": {
      counts: false,
      before: res => res.writeHead(200, { "Content-Length": 1 }).write("x"),
      act: res => res.end(),
    },
  };

  test.concurrent.each(Object.keys(activities))("the inactivity period after %s", async name => {
    const { counts, before, act } = activities[name];
    let actedAt = 0;
    let reference: ReturnType<typeof setTimeout> | undefined;
    let referenceFired = false;
    const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<number>();
    const server = http.createServer((req, res) => {
      before?.(res);
      setTimeout(() => {
        // The socket's timer is due one period after the last activity: after `act` when it
        // counts, after the request when it does not. The reference lies between the two.
        reference = setTimeout(() => (referenceFired = true), TIMEOUT * (counts ? 1.25 : 0.75));
        actedAt = performance.now();
        act(res);
      }, TIMEOUT / 2);
    });
    server.timeout = TIMEOUT;
    // No keep-alive timeout: server.timeout stays armed after res.end().
    server.keepAliveTimeout = 0;
    server.on("timeout", socket => {
      // Only on a machine that stalls past the timeout before `act` runs. A counted one
      // then starts the timer again, and the next 'timeout' is the one measured.
      if (actedAt === 0) return;
      onTimedOut(performance.now());
      socket.destroy();
    });
    const port = await listen(server);
    let client: net.Socket | undefined;
    try {
      client = await send(port, GET);
      const quietFor = (await Promise.race([timedOut, lost(client)])) - actedAt;
      if (counts) expect(quietFor).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
      expect(referenceFired).toBe(false);
    } finally {
      clearTimeout(reference);
      client?.destroy();
      await close(server);
    }
  });

  test.concurrent("a write after a 'timeout' that kept the socket open starts the timer again", async () => {
    const events: string[] = [];
    let writeAt = 0;
    let timedOutAgainAt = 0;
    let reference: ReturnType<typeof setTimeout> | undefined;
    const { promise: settled, resolve: onSettled } = Promise.withResolvers<void>();
    let response: http.ServerResponse | undefined;
    const server = http.createServer((req, res) => {
      response = res;
      res.writeHead(200, { "Content-Type": "text/plain" });
    });
    server.timeout = TIMEOUT;
    server.on("timeout", () => {
      events.push("timeout");
      if (writeAt !== 0) {
        timedOutAgainAt = performance.now();
        return onSettled();
      }
      // A listener keeps the socket open. Nothing reads or writes until this write.
      setTimeout(() => {
        events.push("write");
        writeAt = performance.now();
        response!.write("late\n");
        // Long after the second 'timeout'. A server that ignores the write never fires again.
        reference = setTimeout(() => {
          events.push("the reference timer");
          onSettled();
        }, TIMEOUT * 3);
      }, TIMEOUT / 4);
    });
    const port = await listen(server);
    let client: net.Socket | undefined;
    try {
      client = await send(port, GET);
      await Promise.race([settled, lost(client)]);
      expect(events).toEqual(["timeout", "write", "timeout"]);
      expect(timedOutAgainAt - writeAt).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
    } finally {
      clearTimeout(reference);
      client?.destroy();
      await close(server);
    }
  });

  // With the same period the keep-alive timeout uses the timer of server.timeout, which has fired here.
  test.concurrent("keepAliveTimeout closes the idle connection after a 'timeout' that kept the socket", async () => {
    let endedAt = 0;
    let timedOutAgainAt = 0;
    let reference: ReturnType<typeof setTimeout> | undefined;
    const { promise: settled, resolve: onSettled } = Promise.withResolvers<string>();
    let response: http.ServerResponse | undefined;
    const server = http.createServer((req, res) => {
      response = res;
      res.writeHead(200, { "Content-Length": 1 }).write("x");
    });
    server.timeout = TIMEOUT;
    server.keepAliveTimeout = TIMEOUT;
    server.keepAliveTimeoutBuffer = 0;
    server.on("timeout", socket => {
      if (endedAt !== 0) {
        timedOutAgainAt = performance.now();
        onSettled("'timeout' again");
        return socket.destroy();
      }
      // A listener keeps the socket. The body is complete, so this end() sends nothing that could start the timer.
      endedAt = performance.now();
      response!.end();
      // Long after the keep-alive timeout. A server that trusts the timer that fired never closes the connection.
      reference = setTimeout(() => onSettled("the reference timer"), TIMEOUT * 3);
    });
    const port = await listen(server);
    let client: net.Socket | undefined;
    try {
      client = await send(port, GET);
      expect(await Promise.race([settled, lost(client)])).toBe("'timeout' again");
      expect(timedOutAgainAt - endedAt).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
    } finally {
      clearTimeout(reference);
      client?.destroy();
      await close(server);
    }
  });

  // Writes that put nothing on the connection in Node: write_() drops a chunk for a response
  // without a body, and it validates before it sends anything. A server that ignores every
  // write passes these too. They guard against counting such a write, which keeps the
  // connection of a handler that writes forever open.
  const discarded: Record<string, { request: string; setup: Act }> = {
    "a HEAD response": {
      request: "HEAD / HTTP/1.1\r\nHost: a\r\n\r\n",
      setup: res => res.writeHead(200, { "Content-Type": "text/event-stream" }),
    },
    "a 204 response": { request: GET, setup: res => res.writeHead(204) },
    // The implicit header is invalid, so every write throws before it sends anything.
    "a response whose head is invalid": { request: GET, setup: res => (res.statusCode = 1000) },
  };

  test.concurrent.each(Object.keys(discarded))("writes to %s do not restart the timer", async name => {
    let reference: ReturnType<typeof setTimeout> | undefined;
    const { promise: settled, resolve: onSettled } = Promise.withResolvers<string>();
    const server = http.createServer((req, res) => {
      discarded[name].setup(res);
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
      client = await send(port, discarded[name].request);
      expect(await Promise.race([settled, lost(client)])).toBe("'timeout'");
    } finally {
      clearTimeout(reference);
      client?.destroy();
      await close(server);
    }
  });

  test.concurrent("a peer that stops reading is timed out at the second expiry", async () => {
    let pendingSince = 0;
    let reference: ReturnType<typeof setTimeout> | undefined;
    let referenceFired = false;
    const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<number>();
    const server = http.createServer((req, res) => {
      // The kernel takes little of this write, so it stays pending and every later one queues behind it.
      setSocketOptions(req.socket, 1, KERNEL_BUFFER);
      res.write(Buffer.alloc(16 * 1024 * 1024, "a"));
      pendingSince = performance.now();
      const interval = setInterval(() => res.write("data: ping\n\n"), TIMEOUT / 8);
      res.on("close", () => clearInterval(interval));
      // Long after the second expiry. A server that counts the queued writes never times out.
      reference = setTimeout(() => {
        referenceFired = true;
        onTimedOut(performance.now());
      }, TIMEOUT * 6);
    });
    server.timeout = TIMEOUT;
    server.on("timeout", socket => {
      onTimedOut(performance.now());
      socket.destroy();
    });
    const port = await listen(server);
    let client: net.Socket | undefined;
    try {
      client = await send(port, GET, true);
      // Node holds the first 'timeout' back, because the write was pending and the kernel had taken a part of it.
      const quietFor = (await Promise.race([timedOut, lost(client)])) - pendingSince;
      expect(quietFor).toBeGreaterThanOrEqual(2 * TIMEOUT - SLACK);
      expect(referenceFired).toBe(false);
    } finally {
      clearTimeout(reference);
      client?.destroy();
      await close(server);
    }
  });
});

// The progress of a write that is pending is activity too: Node looks at the write queue when the
// timer fires. Not on Windows, where the kernel takes a whole body at once and no write stays pending.
describe.skipIf(isWindows)("node:http: a write that drains slowly holds the socket inactivity timeout back", () => {
  const TIMEOUT = 400;
  const BODY = Buffer.alloc(2 * 1024 * 1024, "a");
  // A server that holds 'timeout' back once, and does not see the bytes leave, fires at the second
  // expiry. For longer than that the reader takes 16 KB every 20 ms, less than half of the body in
  // all. Then it takes the rest.
  const SLOW_FOR = TIMEOUT * 2.75;
  const STEP = 16 * 1024;
  function readSlowly(client: net.Socket) {
    let budget = 0;
    let received = 0;
    let head = -1;
    let beforeBody = "";
    let startedAt = 0;
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    client.on("data", chunk => {
      startedAt ||= performance.now();
      if (head === -1) {
        // The blank line that ends the head can lie across two chunks.
        beforeBody += chunk.toString("latin1");
        const end = beforeBody.indexOf("\r\n\r\n");
        if (end !== -1) head = end + 4;
      }
      received += chunk.length;
      budget -= chunk.length;
      if (budget <= 0) client.pause();
    });
    const pump = setInterval(() => {
      // A chunk that was larger than the step is paid off before the next one.
      if (startedAt === 0 || performance.now() - startedAt < SLOW_FOR) budget = Math.min(budget + STEP, STEP);
      else budget = Infinity;
      if (budget > 0) client.resume();
    }, 20);
    client.on("error", reject);
    // The server closes the connection behind the body.
    client.on("close", () => {
      clearInterval(pump);
      resolve(received - head);
    });
    return promise;
  }
  // `pendingFor` is how long the server had bytes of the write left. Less than two periods proves nothing.
  const drainedWithoutTimeout = { body: BODY.length, timeouts: 0, pendingForTwoPeriods: true };

  // `done` runs when the server has no byte of the body left.
  type Respond = (res: http.ServerResponse, done: () => void) => void;
  // Most of the body in one write that stays pending, then 64 more writes, one per tick, that do not
  // wait for 'drain': each call sends bytes of the writes before it. The send buffer is four times the
  // receive buffer of the reader, so what the reader takes between two writes never frees the third
  // at which the kernel reports a writable socket. No bytes leave the server outside a write() call.
  const keepWriting =
    (size: number): Respond =>
    (res, done) => {
      let offset = BODY.length - 64 * size;
      res.write(BODY.subarray(0, offset));
      const interval = setInterval(() => {
        res.write(BODY.subarray(offset, (offset += size)));
        if (offset < BODY.length) return;
        clearInterval(interval);
        res.end(done);
      }, 20);
      res.on("close", () => clearInterval(interval));
    };
  const responses: Record<string, { secure?: boolean; sendBuffer?: number; respond: Respond }> = {
    "res.end()": { respond: (res, done) => res.end(BODY, done) },
    "res.end() over https": { secure: true, respond: (res, done) => res.end(BODY, done) },
    "res.write()": {
      respond: (res, done) => {
        const drained = () => {
          done();
          res.end();
        };
        if (res.write(BODY)) drained();
        else res.once("drain", drained);
      },
    },
    "res.write() and more res.write() calls that do not wait for 'drain'": {
      sendBuffer: 4 * KERNEL_BUFFER,
      respond: keepWriting(4 * 1024),
    },
    // Over 16 KB the server keeps the rest of a write by reference, not in the buffer of the connection.
    "res.write() and more res.write() calls of over 16 KB that do not wait for 'drain'": {
      sendBuffer: 4 * KERNEL_BUFFER,
      respond: keepWriting(20 * 1024),
    },
    "res.write() and more res.write() calls over https that do not wait for 'drain'": {
      secure: true,
      sendBuffer: 4 * KERNEL_BUFFER,
      respond: keepWriting(4 * 1024),
    },
  };

  test.concurrent.each(Object.keys(responses))("no 'timeout' while a slow reader drains one %s", async name => {
    const { secure, sendBuffer = KERNEL_BUFFER, respond } = responses[name];
    let timeouts = 0;
    let pendingFor = 0;
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      setSocketOptions(req.socket, 1, sendBuffer);
      res.writeHead(200, { "Content-Length": BODY.length, "Connection": "close" });
      const wroteAt = performance.now();
      respond(res, () => (pendingFor = performance.now() - wroteAt));
    };
    const server = secure ? https.createServer(tlsOptions, handler) : http.createServer(handler);
    server.timeout = TIMEOUT;
    server.on("timeout", socket => {
      timeouts++;
      socket.destroy();
    });
    const port = await listen(server);
    const client = secure
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
      : net.connect(port, "127.0.0.1");
    try {
      const body = readSlowly(client);
      await once(client, secure ? "secureConnect" : "connect");
      setSocketOptions(client, 2, KERNEL_BUFFER);
      client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      expect({ body: await body, timeouts, pendingForTwoPeriods: pendingFor > 2 * TIMEOUT }).toEqual(
        drainedWithoutTimeout,
      );
    } finally {
      client.destroy();
      await close(server);
    }
  });

  test.concurrent("no 'timeout' while a slow reader drains one socket.write() on a CONNECT tunnel", async () => {
    let timeouts = 0;
    let pendingFor = 0;
    const server = http.createServer();
    server.on("connect", (req, socket) => {
      setSocketOptions(socket, 1, KERNEL_BUFFER);
      // Node takes its 'timeout' listener off the socket of a tunnel, and the timer stays armed.
      // Behind the last byte the connection is idle until the reader has caught up.
      socket.on("timeout", () => pendingFor !== 0 || timeouts++);
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const wroteAt = performance.now();
      socket.write(BODY, () => {
        pendingFor = performance.now() - wroteAt;
        socket.end();
      });
    });
    server.timeout = TIMEOUT;
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      const body = readSlowly(client);
      await once(client, "connect");
      setSocketOptions(client, 2, KERNEL_BUFFER);
      client.write("CONNECT a:443 HTTP/1.1\r\nHost: a:443\r\n\r\n");
      expect({ body: await body, timeouts, pendingForTwoPeriods: pendingFor > 2 * TIMEOUT }).toEqual(
        drainedWithoutTimeout,
      );
    } finally {
      client.destroy();
      await close(server);
    }
  });

  // The timer clock counts whole milliseconds. A server that does not count the bytes fires TIMEOUT / 2 early or more.
  const SLACK = 50;

  // A TCP relay in front of a server on a Unix socket. Every 20 ms it takes up to allowance() bytes of the server
  // from the kernel and hands them to its client, so it is the relay that says how fast the bytes leave the server.
  async function relay(path: string, allowance: () => number) {
    const listener = net.createServer(client => {
      const server = net.connect({ path });
      // The event loop never reads it.
      server.pause();
      server.on("error", () => client.destroy());
      client.on("error", () => server.destroy());
      client.on("data", chunk => server.write(chunk));
      const into = Buffer.alloc(64 * 1024);
      const pump = setInterval(() => {
        const fd: number | undefined = (server as any)._handle?.fd;
        if (fd === undefined || fd < 0) return;
        try {
          for (let left = allowance(); left > 0;) {
            const length = readSync(fd, into, 0, Math.min(left, into.length), null);
            // The server has closed the connection.
            if (length === 0) return client.end();
            client.write(Buffer.from(into.subarray(0, length)));
            left -= length;
          }
        } catch (error: any) {
          if (error.code !== "EAGAIN") client.destroy(error);
        }
      }, 20);
      client.on("close", () => {
        clearInterval(pump);
        server.destroy();
      });
    });
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    return listener;
  }

  // One write of 128 KB is one batch of TLS records. The TLS layer takes all of it and holds the ciphertext that
  // the kernel does not take, so the server has no byte of the write left. The kernel holds 8 KB of a Unix socket
  // with this send buffer, where a TCP connection starts with a receive window of half the batch. The relay takes
  // 2 KB every 20 ms for longer than two periods, then the rest. Behind that a last write restarts the timer, and
  // what the TLS layer held before it must not hold 'timeout' back again.
  test("the ciphertext that the TLS layer holds of a write counts while it leaves, and not after", async () => {
    // A short name: the path of a Unix socket has about 100 bytes.
    using dir = tempDir("http-tls", {});
    const path = join(String(dir), "s.sock");
    const body = BODY.subarray(0, 128 * 1024);
    let slowSince = 0;
    let expiriesWhileLeaving = 0;
    let timeoutsWhileLeaving = 0;
    let lastWriteAt = 0;
    let timedOutAt = 0;
    let referenceFired = false;
    let reference: ReturnType<typeof setTimeout> | undefined;
    let writeLast = () => {};
    const { promise: settled, resolve: onSettled } = Promise.withResolvers<void>();
    const server = https.createServer(tlsOptions, (req, res) => {
      const socket = req.socket as net.Socket & { _onTimeout(): void };
      setSocketOptions(socket, 1, 4 * 1024);
      // Every expiry of the timer comes through here.
      const onTimeout = socket._onTimeout;
      socket._onTimeout = function () {
        if (lastWriteAt === 0) expiriesWhileLeaving++;
        return onTimeout.call(this);
      };
      res.writeHead(200, { "Content-Length": body.length + 1 });
      slowSince = performance.now();
      res.write(body);
      writeLast = () => {
        lastWriteAt = performance.now();
        res.write("x");
        // Between the first expiry behind this write and the second one.
        reference = setTimeout(() => {
          referenceFired = true;
          onSettled();
        }, TIMEOUT * 1.5);
      };
    });
    server.timeout = TIMEOUT;
    server.on("timeout", socket => {
      if (lastWriteAt === 0) timeoutsWhileLeaving++;
      else timedOutAt = performance.now();
      socket.destroy();
      onSettled();
    });
    server.listen(path);
    await once(server, "listening");
    const slowFor = TIMEOUT * 2.25;
    const inFront = await relay(path, () =>
      slowSince !== 0 && performance.now() - slowSince < slowFor ? 2 * 1024 : Infinity,
    );
    const client = tls.connect({
      port: (inFront.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
    });
    try {
      let received = 0;
      let head = -1;
      let beforeBody = "";
      client.on("error", () => {});
      client.on("data", chunk => {
        if (head === -1) {
          // The blank line that ends the head can lie across two chunks.
          beforeBody += chunk.toString("latin1");
          const end = beforeBody.indexOf("\r\n\r\n");
          if (end !== -1) head = end + 4;
        }
        received += chunk.length;
        // The whole first write is here, so the TLS layer holds nothing.
        if (head !== -1 && received - head === body.length) writeLast();
      });
      await once(client, "secureConnect");
      client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      await settled;
      expect({ timeoutsWhileLeaving, twoExpiriesWhileLeaving: expiriesWhileLeaving >= 2, referenceFired }).toEqual({
        timeoutsWhileLeaving: 0,
        twoExpiriesWhileLeaving: true,
        referenceFired: false,
      });
      expect(timedOutAt - lastWriteAt).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
    } finally {
      clearTimeout(reference);
      client.destroy();
      inFront.close();
      await close(server);
    }
  });

  // What the kernel holds for a paused client, taken from its descriptor at once: all of it, or `limit` bytes. Behind it the send buffer of the server has room again.
  function takeFromKernel(client: net.Socket, into: Buffer, limit = Infinity) {
    const fd: number = (client as any)._handle.fd;
    let taken = 0;
    while (taken < limit) {
      try {
        const length = readSync(fd, into, 0, Math.min(into.length, limit - taken), null);
        if (length === 0) return taken;
        taken += length;
      } catch (error: any) {
        if (error.code !== "EAGAIN") throw error;
        return taken;
      }
    }
    return taken;
  }

  // Makes the server send what it holds of its writes from inside write() calls alone. The client is paused, this
  // takes its bytes from the kernel, and each call then sends what the kernel has room for.
  function sendPendingBytesInWrites(res: http.ServerResponse, client: net.Socket) {
    // The native response says what it still holds of the writes.
    const handle = (res as any)[Object.getOwnPropertySymbols(res).find(symbol => symbol.description === "handle")!];
    if (handle.bufferedAmount === 0) throw new Error("the kernel took the whole megabyte");
    const into = Buffer.alloc(64 * 1024);
    const giveUpAt = performance.now() + 3000;
    while (handle.bufferedAmount > 0) {
      if (takeFromKernel(client, into) === 0) {
        // The last call sent nothing: on macOS the kernel opens the window of the client a moment behind the read.
        if (performance.now() > giveUpAt) throw new Error("the pending bytes do not leave");
        Bun.sleepSync(1);
      }
      res.write("ping");
    }
    // Room for the last ping, which leaves when the caller returns.
    takeFromKernel(client, into);
  }

  // A write() call sends the bytes that are pending before its own. The call that sends the last of them is
  // activity, although nothing is pending when the timer fires next, and the kernel then reports the socket
  // writable once more. The server counts the bytes there, as Node does when a pending write completes: 'timeout'
  // comes one period behind them. No byte leaves the server outside a write() call.
  test.concurrent.each([
    ["many chunks of 8 KB", 8 * 1024],
    // Over 16 KB the server keeps the rest of a write by reference, not in the buffer of the connection.
    ["one chunk of 1 MB", 1024 * 1024],
  ])("a write() that sends the last pending bytes of %s restarts the period", async (_, size) => {
    let client: net.Socket | undefined;
    let emptying: ReturnType<typeof setTimeout> | undefined;
    let reference: ReturnType<typeof setTimeout> | undefined;
    let referenceFired = false;
    let emptiedAt = 0;
    let timedOutAt = 0;
    const { promise: settled, resolve: onSettled, reject: onFailed } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      const socket = req.socket as net.Socket & { _onTimeout(): void };
      setSocketOptions(socket, 1, KERNEL_BUFFER);
      res.writeHead(200);
      for (let written = 0; written < 1024 * 1024; written += size) res.write(Buffer.alloc(size, "a"));
      const empty = () => {
        try {
          sendPendingBytesInWrites(res, client!);
          emptiedAt = performance.now();
          // A server that counts these bytes only when the timer fires is due at the second expiry from here, behind this.
          reference = setTimeout(() => {
            referenceFired = true;
            onSettled();
          }, TIMEOUT * 1.5);
        } catch (error) {
          onFailed(error);
        }
      };
      // The first expiry finds the writes pending. A quarter of a period behind it, when the kernel takes no more by itself, the handler sends the rest.
      const onTimeout = socket._onTimeout;
      let expiries = 0;
      socket._onTimeout = function () {
        if (++expiries === 1) emptying = setTimeout(empty, TIMEOUT / 4);
        return onTimeout.call(this);
      };
    });
    server.timeout = TIMEOUT;
    server.on("timeout", socket => {
      timedOutAt = performance.now();
      socket.destroy();
      onSettled();
    });
    const port = await listen(server);
    try {
      client = net.connect(port, "127.0.0.1");
      client.pause();
      client.on("error", onFailed);
      await once(client, "connect");
      setSocketOptions(client, 2, KERNEL_BUFFER);
      client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      await settled;
      expect({ emptied: emptiedAt !== 0, referenceFired }).toEqual({ emptied: true, referenceFired: false });
      // A server that does not count those bytes fires three quarters of a period behind them.
      expect(timedOutAt - emptiedAt).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
    } finally {
      clearTimeout(emptying);
      clearTimeout(reference);
      client?.destroy();
      await close(server);
    }
  });

  // Node records the size of the write queue at every expiry, so an expiry that finds progress also uses up the
  // one that a pending write gets without progress. Here the client is paused, and the test takes 16 KB of its
  // bytes from the kernel every 20 ms, so bytes leave the server at an even pace. One and a half periods behind
  // the write the test stops, and the handler with it. The second expiry behind that is 'timeout', not the third.
  test.concurrent("a peer that stops reading is timed out at the second expiry behind its last byte", async () => {
    let client: net.Socket | undefined;
    let pump: ReturnType<typeof setInterval> | undefined;
    let stopping: ReturnType<typeof setTimeout> | undefined;
    let stoppedAt = 0;
    let expiriesBehindStop = 0;
    const { promise: timedOut, resolve: onTimedOut, reject: onFailed } = Promise.withResolvers<number>();
    const server = http.createServer((req, res) => {
      const socket = req.socket as net.Socket & { _onTimeout(): void };
      setSocketOptions(socket, 1, 4 * KERNEL_BUFFER);
      res.writeHead(200);
      res.write(BODY);
      // Each call sends bytes of the body, which is pending.
      const interval = setInterval(() => res.write("data: ping\n\n"), 20);
      res.on("close", () => clearInterval(interval));
      const step = Buffer.alloc(STEP);
      pump = setInterval(() => {
        try {
          takeFromKernel(client!, step, STEP);
        } catch (error) {
          onFailed(error);
        }
      }, 20);
      stopping = setTimeout(() => {
        clearInterval(pump);
        clearInterval(interval);
        stoppedAt = performance.now();
      }, TIMEOUT * 1.5);
      // Every expiry of the timer comes through here.
      const onTimeout = socket._onTimeout;
      socket._onTimeout = function () {
        if (stoppedAt !== 0) expiriesBehindStop++;
        return onTimeout.call(this);
      };
    });
    server.timeout = TIMEOUT;
    server.on("timeout", socket => {
      onTimedOut(performance.now());
      socket.destroy();
    });
    const port = await listen(server);
    try {
      client = net.connect(port, "127.0.0.1");
      client.pause();
      client.on("error", onFailed);
      await once(client, "connect");
      setSocketOptions(client, 2, KERNEL_BUFFER);
      client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      const timedOutAt = await timedOut;
      // A server that does not see the bytes leave fires before the test stops, or half a period behind that.
      expect(stoppedAt).not.toBe(0);
      expect(timedOutAt - stoppedAt).toBeGreaterThanOrEqual(TIMEOUT - SLACK);
      expect(expiriesBehindStop).toBeLessThanOrEqual(2);
    } finally {
      clearInterval(pump);
      clearTimeout(stopping);
      client?.destroy();
      await close(server);
    }
  });
});
