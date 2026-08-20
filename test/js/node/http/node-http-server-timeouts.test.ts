import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

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
