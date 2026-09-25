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

  test("server.setTimeout() fires close to the configured time for a client that never sends", async () => {
    // A client that connects and never writes: 'connection' must fire on TCP
    // accept and the inactivity timer must start then, not after a kernel-side
    // deferred-accept window.
    const server = http.createServer((req, res) => res.end("ok"));
    let connectionAt: number | undefined;
    let timeoutAt: number | undefined;
    server.on("connection", () => {
      connectionAt ??= Date.now() - t0;
    });
    server.setTimeout(500, socket => {
      timeoutAt ??= Date.now() - t0;
      socket.destroy();
    });
    const port = await listen(server);
    let t0 = Date.now();
    try {
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<number>();
      const socket = net.connect(port, "127.0.0.1");
      socket.on("error", () => {});
      socket.resume();
      socket.on("connect", () => {
        t0 = Date.now();
      });
      socket.on("close", () => onClosed(Date.now() - t0));
      const closedAt = await closed;
      // The deferred-accept window is a full second at minimum, so these bounds
      // distinguish "accepted immediately" from "accepted after defer" without
      // being tight enough to flake under ASAN.
      expect({
        connectionSeenPromptly: connectionAt !== undefined && connectionAt < 900,
        timeoutNearConfigured: timeoutAt !== undefined && timeoutAt < 1250,
        closedNearConfigured: closedAt < 1250,
      }).toEqual({
        connectionSeenPromptly: true,
        timeoutNearConfigured: true,
        closedNearConfigured: true,
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
