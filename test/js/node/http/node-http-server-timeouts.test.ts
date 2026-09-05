import { describe, expect, jest, setSystemTime, test } from "bun:test";
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

// The server notes when a connection's last response finished and, when the
// socket timer fires, grants whatever is left of the keep-alive budget from
// that mark. The mark has to be taken on the real monotonic clock: Date.now()
// follows bun:test's setSystemTime() and useFakeTimers(), and the mocked
// monotonic clock that useFakeTimers() installs starts over at zero, so a mark
// taken on either would decide when, or whether, an idle connection is closed.
//
// Each probe mocks the clock at some point, waits for the server to close the
// connection and reports how long after the last response that happened. It
// is timed with performance.now(), which setSystemTime() leaves alone and
// useFakeTimers() freezes, so the end is read only after the mocks are
// undone. Not concurrent: the mocks are process-wide and the tests above time
// themselves with Date.now().
describe("keepAliveTimeout idle expiry ignores mocked clocks", () => {
  const KEEP_ALIVE_MS = 500;
  // How long the server sits on the second request before answering it. The
  // socket timer armed by the first response keeps counting down meanwhile,
  // so it fires KEEP_ALIVE_MS - SLOW_RESPONSE_MS (200ms) into the second
  // response's idle period and the expiry has to be settled from the mark.
  const SLOW_RESPONSE_MS = 300;
  const HOUR_MS = 60 * 60 * 1000;

  async function probeIdleClose(options: {
    requests: 1 | 2;
    beforeRequests?: () => void;
    afterLastResponse?: () => void;
  }) {
    // A probe that fails by timing out never reaches its cleanup; do not let
    // its mocks leak into the next one.
    jest.useRealTimers();
    setSystemTime();
    let requests = 0;
    // Taken right before each res.end(), i.e. just before the server takes its
    // own mark, so the idle time reported below can only be longer than what
    // the server measured, never shorter because the response reached the
    // client late.
    let lastResponseEndedAt = 0;
    const endResponse = (res: http.ServerResponse) => {
      lastResponseEndedAt = performance.now();
      res.end("response-body");
    };
    const server = http.createServer({ keepAliveTimeoutBuffer: 0 }, (req, res) => {
      req.resume();
      if (++requests === 2) {
        setTimeout(endResponse, SLOW_RESPONSE_MS, res);
      } else {
        endResponse(res);
      }
    });
    server.keepAliveTimeout = KEEP_ALIVE_MS;
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.setNoDelay(true);
      // An idle keep-alive close is a clean FIN; a reset or any other error
      // would make this probe fail instead of timing an unrelated close.
      const { promise: closed, resolve: onClosed, reject: onSocketError } = Promise.withResolvers<void>();
      socket.on("error", onSocketError);
      socket.on("close", () => onClosed());

      let received = "";
      let responsesWanted = 0;
      let onResponse = () => {};
      socket.on("data", chunk => {
        received += chunk.toString("latin1");
        if (received.split("response-body").length - 1 >= responsesWanted) onResponse();
      });
      const request = () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        responsesWanted++;
        onResponse = resolve;
        socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
        return promise;
      };

      await once(socket, "connect");
      options.beforeRequests?.();
      await request();
      if (options.requests === 2) await request();
      options.afterLastResponse?.();
      await closed;
    } finally {
      jest.useRealTimers();
      setSystemTime();
      socket.destroy();
      server.closeAllConnections();
      server.close();
    }
    return performance.now() - lastResponseEndedAt;
  }

  test("a clock moved forwards does not close the connection before its idle budget is used up", async () => {
    // Settled against Date.now(), the timer fire 200ms into the second idle
    // period sees an hour of idle time and closes the connection right there.
    const idleMs = await probeIdleClose({
      requests: 2,
      afterLastResponse: () => setSystemTime(new Date(Date.now() + HOUR_MS)),
    });
    expect(idleMs).toBeGreaterThanOrEqual(KEEP_ALIVE_MS - 150);
  });

  test("a pinned clock does not double the idle budget", async () => {
    // Settled against a Date.now() that never advances, the timer fire sees
    // no idle time at all and re-arms for the whole budget once more, so the
    // connection is closed after two budgets. That floor does not depend on
    // machine speed, which is what makes the upper bound safe.
    const idleMs = await probeIdleClose({
      requests: 1,
      beforeRequests: () => setSystemTime(new Date("2020-01-01T00:00:00Z")),
    });
    expect(idleMs).toBeGreaterThanOrEqual(KEEP_ALIVE_MS - 150);
    expect(idleMs).toBeLessThan(2 * KEEP_ALIVE_MS);
  });

  test("a clock moved backwards does not keep the idle connection open", async () => {
    // Settled against Date.now(), the timer fire re-arms the connection for
    // the budget plus the hour the clock went back, and this probe only
    // returns once the test times out.
    const idleMs = await probeIdleClose({
      requests: 1,
      afterLastResponse: () => setSystemTime(new Date(Date.now() - HOUR_MS)),
    });
    expect(idleMs).toBeGreaterThanOrEqual(KEEP_ALIVE_MS - 150);
  });

  test("fake timers enabled after the response do not keep the idle connection open", async () => {
    // The socket timer was armed on real timers, so it still fires on its
    // own; what fake timers change is the clocks. A mark taken on Date.now()
    // (pinned when the fake timers were enabled) or on the mocked monotonic
    // clock (which restarts at zero) makes that fire re-arm the connection,
    // and the new timer lands in the fake heap, where nothing ever fires it.
    const idleMs = await probeIdleClose({
      requests: 1,
      afterLastResponse: () => jest.useFakeTimers(),
    });
    expect(idleMs).toBeGreaterThanOrEqual(KEEP_ALIVE_MS - 150);
  });
});
