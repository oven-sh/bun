import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { pipeline, Readable, Writable } from "node:stream";

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

  // The listener answers a POST whose body has not arrived yet, and the body
  // then stalls. The response has finished, so the keep-alive timeout is what
  // fires. Like Node's `parser.incoming`, the connection keeps the request
  // until its message is complete, so the request still hears 'timeout'.
  const stalledPost = "POST /b HTTP/1.1\r\nHost: a\r\nContent-Length: 100\r\n\r\n0123456789";
  const restOfPost = Buffer.alloc(90, "a");
  type Listener = (req: http.IncomingMessage, res: http.ServerResponse) => void;
  const pendingGets = new WeakMap<net.Socket, http.ServerResponse>();
  const earlyResponses: [string, string, Listener][] = [
    [
      "the listener reads the body",
      stalledPost,
      (req, res) => {
        req.resume();
        res.end("early");
      },
    ],
    ["the listener leaves the body unread", stalledPost, (req, res) => void res.end("early")],
    [
      "the listener ends the response in a later tick",
      stalledPost,
      (req, res) => {
        req.resume();
        setImmediate(() => res.end("early"));
      },
    ],
    [
      "the request is pipelined behind a response that ends later",
      "GET /a HTTP/1.1\r\nHost: a\r\n\r\n" + stalledPost,
      (req, res) => {
        if (req.url === "/a") return void pendingGets.set(req.socket, res);
        const pendingGet = pendingGets.get(req.socket)!;
        req.resume();
        res.end("early");
        pendingGet.end("a");
      },
    ],
  ];

  test.each(earlyResponses)(
    "a request whose body still arrives gets 'timeout' after its response finished (%s)",
    async (_name, wire, respond) => {
      const events: string[] = [];
      const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        req.on("timeout", () => events.push(`req ${req.url} complete=${req.complete}`));
        res.on("timeout", () => events.push(`res ${req.url}`));
        respond(req, res);
      });
      server.on("timeout", socket => {
        events.push(`server destroyed=${socket.destroyed}`);
        onTimedOut();
      });
      server.keepAliveTimeout = 200;
      server.keepAliveTimeoutBuffer = 0;
      const port = await listen(server);
      const client = net.connect(port, "127.0.0.1");
      try {
        client.on("error", () => {});
        client.on("connect", () => client.write(wire));
        await timedOut;
        expect(events).toEqual(["req /b complete=false", "server destroyed=false"]);
      } finally {
        client.destroy();
        server.closeAllConnections();
        server.close();
      }
    },
  );

  test("req.setTimeout() callback keeps the socket of a request whose response finished first", async () => {
    const events: string[] = [];
    const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      req.setTimeout(30_000, () => events.push(`req 'timeout' complete=${req.complete}`));
      // Runs after the server's own socket 'timeout' listener, which is the
      // one that destroys the socket when nothing handled the timeout.
      req.socket.on("timeout", () => {
        events.push(`socket destroyed=${req.socket.destroyed}`);
        onTimedOut();
      });
      req.resume();
      res.end("early");
    });
    server.keepAliveTimeout = 200;
    server.keepAliveTimeoutBuffer = 0;
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(stalledPost));
      await timedOut;
      expect(events).toEqual(["req 'timeout' complete=false", "socket destroyed=false"]);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("a req.setTimeout() callback that answers runs again while the upload still stalls", async () => {
    // The first 'timeout' is the request's own, and its callback answers 408.
    // The second is the keep-alive timeout behind that response. The message
    // is still incomplete, so the callback runs again, as in Node.
    const events: string[] = [];
    const { promise: settled, resolve: onSettled } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      req.setTimeout(200, () => {
        events.push(`req 'timeout' headersSent=${res.headersSent}`);
        if (res.headersSent) return void onSettled();
        res.writeHead(408);
        res.end();
      });
      req.resume();
    });
    server.keepAliveTimeout = 300;
    server.keepAliveTimeoutBuffer = 0;
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(stalledPost));
      client.on("close", () => {
        events.push("closed by the server");
        onSettled();
      });
      client.resume();
      await settled;
      expect(events).toEqual(["req 'timeout' headersSent=false", "req 'timeout' headersSent=true"]);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("a request that completed after its response finished gets no 'timeout'", async () => {
    // The client sends the rest of the body once it has the response. The
    // request is complete then, so its 'timeout' listener must not keep the
    // socket: the timeout that is armed after 'end' closes it.
    const events: string[] = [];
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      const socket = req.socket;
      req.setTimeout(30_000, () => events.push(`req 'timeout' complete=${req.complete}`));
      req.on("end", () => {
        events.push("req 'end'");
        setImmediate(() => socket.setTimeout(50));
      });
      req.resume();
      res.end("early");
    });
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(stalledPost));
      client.once("data", () => client.write(restOfPost));
      client.on("close", () => {
        events.push("closed by the server");
        onClosed();
      });
      await closed;
      expect(events).toEqual(["req 'end'", "closed by the server"]);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  // A 'timeout' listener keeps the socket at the keep-alive timeout, and the
  // client then sends the rest of the body. That is socket activity: it arms
  // the timeout again, as refresh() of the fired timer does in Node. The
  // message is complete then, so the next timeout is not for the request.
  test("the rest of the body arms the keep-alive timeout again after a request listener kept the socket", async () => {
    const events: string[] = [];
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      req.on("timeout", () => {
        events.push(`req 'timeout' complete=${req.complete}`);
        client.write(restOfPost);
      });
      req.resume();
      res.end("early");
    });
    server.keepAliveTimeout = 200;
    server.keepAliveTimeoutBuffer = 0;
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(stalledPost));
      client.on("close", () => {
        events.push("closed by the server");
        onClosed();
      });
      client.resume();
      await closed;
      expect(events).toEqual(["req 'timeout' complete=false", "closed by the server"]);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("the rest of the body arms the keep-alive timeout again after a server listener kept the socket", async () => {
    const events: string[] = [];
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      req.on("end", () => events.push("req 'end'"));
      req.resume();
      res.end("early");
    });
    server.on("timeout", socket => {
      events.push("server 'timeout'");
      if (events.length === 1) client.write(restOfPost);
      else socket.destroy();
    });
    server.keepAliveTimeout = 200;
    server.keepAliveTimeoutBuffer = 0;
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(stalledPost));
      client.on("close", () => {
        events.push("closed by the server");
        onClosed();
      });
      client.resume();
      await closed;
      expect(events).toEqual(["server 'timeout'", "req 'end'", "server 'timeout'", "closed by the server"]);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("the rest of the body does not arm a timeout that the 'timeout' listener switched off", async () => {
    const { promise: ended, resolve: onEnded } = Promise.withResolvers<number | string | undefined>();
    const server = http.createServer((req, res) => {
      const socket = req.socket;
      req.on("timeout", () => {
        socket.setTimeout(0);
        client.write(restOfPost);
      });
      req.on("end", () => onEnded(socket.timeout));
      req.resume();
      res.end("early");
    });
    server.keepAliveTimeout = 200;
    server.keepAliveTimeoutBuffer = 0;
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(stalledPost));
      client.on("close", () => onEnded("closed by the server"));
      client.resume();
      expect(await ended).toBe(0);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("a 'timeout' listener that arms its own timeout gets the next 'timeout' a full period after the last body byte", async () => {
    const { promise: done, resolve: onDone } = Promise.withResolvers<void>();
    const gaps: number[] = [];
    let timeouts = 0;
    let lastWrite = 0;
    const server = http.createServer((req, res) => {
      const socket = req.socket;
      req.on("timeout", () => {
        timeouts++;
        if (timeouts === 1) socket.setTimeout(200);
        else gaps.push(performance.now() - lastWrite);
        if (timeouts === 3) return void onDone();
        lastWrite = performance.now();
        client.write("z");
      });
      req.resume();
      res.end("early");
    });
    server.keepAliveTimeout = 200;
    server.keepAliveTimeoutBuffer = 0;
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write(stalledPost));
      client.on("close", onDone);
      client.resume();
      await done;
      // A timer never fires early. 1 ms for the rounding of the timer's start.
      expect(gaps.map(gap => gap >= 199)).toEqual([true, true]);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("the next request on a socket that a 'timeout' listener kept has no leftover keep-alive timeout", async () => {
    const { promise: ended, resolve: onEnded } = Promise.withResolvers<number | undefined>();
    const server = http.createServer((req, res) => {
      if (req.url === "/fast") return void res.end("fast");
      req.on("data", () => {});
      req.on("end", () => {
        onEnded(req.socket.timeout);
        res.end("slow");
      });
    });
    server.keepAliveTimeout = 200;
    server.keepAliveTimeoutBuffer = 0;
    // Keeps the idle socket. The client then sends a request with a body on it.
    server.once("timeout", () => client.write("POST /slow HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello"));
    const port = await listen(server);
    const client = net.connect(port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.on("connect", () => client.write("GET /fast HTTP/1.1\r\nHost: a\r\n\r\n"));
      client.resume();
      // server.timeout is 0: the request replaces the keep-alive timeout with no timeout.
      expect(await ended).toBe(0);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("the rest of the body arms the keep-alive timeout again after a request listener threw", async () => {
    // The process survives the throw ('uncaughtException' listener), and
    // nothing destroyed the socket. Node closes it one keep-alive timeout
    // after the rest of the body.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const net = require("node:net");
        const events = [];
        let client;
        process.on("uncaughtException", err => {
          events.push("uncaughtException: " + err.message);
          client.write(Buffer.alloc(90, "a"));
        });
        const server = http.createServer((req, res) => {
          req.on("timeout", () => {
            throw new Error("from the 'timeout' listener");
          });
          req.on("end", () => events.push("req 'end'"));
          req.resume();
          res.end("early");
        });
        server.keepAliveTimeout = 200;
        server.keepAliveTimeoutBuffer = 0;
        server.listen(0, "127.0.0.1", () => {
          client = net.connect(server.address().port, "127.0.0.1", () => {
            client.write("POST /b HTTP/1.1\\r\\nHost: a\\r\\nContent-Length: 100\\r\\n\\r\\n0123456789");
          });
          client.on("error", () => {});
          client.resume();
          client.on("close", () => {
            events.push("closed by the server");
            console.log(JSON.stringify(events));
            server.close();
          });
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify(["uncaughtException: from the 'timeout' listener", "req 'end'", "closed by the server"]),
      stderr: "",
      exitCode: 0,
    });
  });

  function failing() {
    return new Writable({
      write(chunk, encoding, callback) {
        callback(new Error("disk full"));
      },
    });
  }

  // The stream destroyer takes a request off its connection (req.socket is
  // null) and leaves the connection to the response.
  const streamDestroyers: [string, (req: http.IncomingMessage) => Promise<unknown>][] = [
    ["a failed stream.pipeline()", req => new Promise(resolve => pipeline(req, failing(), resolve))],
    [
      "a break out of for await",
      async req => {
        for await (const _chunk of req) break;
      },
    ],
    ["Readable.toWeb(req).cancel()", req => Readable.toWeb(req).cancel()],
  ];

  test.each(streamDestroyers)(
    "a request that %s destroyed gets 'timeout' while its response is pending",
    async (_name, destroy) => {
      const events: string[] = [];
      const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        req.on("error", () => {});
        req.on("timeout", () =>
          events.push(`req complete=${req.complete} destroyed=${req.destroyed} socket=${req.socket}`),
        );
        res.on("timeout", () => events.push("res"));
        void destroy(req);
      });
      server.on("timeout", socket => {
        events.push(`server destroyed=${socket.destroyed}`);
        onTimedOut();
      });
      server.timeout = 200;
      const port = await listen(server);
      const client = net.connect(port, "127.0.0.1");
      try {
        client.on("error", () => {});
        client.on("connect", () => client.write(stalledPost));
        await timedOut;
        expect(events).toEqual(["req complete=false destroyed=true socket=null", "res", "server destroyed=false"]);
      } finally {
        client.destroy();
        server.closeAllConnections();
        server.close();
      }
    },
  );

  // Node's parser keeps such a request until its message ends, so it hears
  // 'timeout' after its response finished too. Here it never turns complete
  // (IncomingMessage#_destroy lets go of the body), and the server cannot
  // tell a body that stalls from one that arrived.
  test.todo.each(streamDestroyers)(
    "a request that %s destroyed gets 'timeout' while its body stalls behind its finished response",
    async (_name, destroy) => {
      const events: string[] = [];
      const { promise: timedOut, resolve: onTimedOut } = Promise.withResolvers<void>();
      const server = http.createServer(async (req, res) => {
        req.on("error", () => {});
        req.on("timeout", () =>
          events.push(`req complete=${req.complete} destroyed=${req.destroyed} socket=${req.socket}`),
        );
        await destroy(req);
        res.end("early");
      });
      server.on("timeout", socket => {
        events.push(`server destroyed=${socket.destroyed}`);
        onTimedOut();
      });
      server.keepAliveTimeout = 200;
      server.keepAliveTimeoutBuffer = 0;
      const port = await listen(server);
      const client = net.connect(port, "127.0.0.1");
      try {
        client.on("error", () => {});
        client.on("connect", () => client.write(stalledPost));
        await timedOut;
        expect(events).toEqual(["req complete=false destroyed=true socket=null", "server destroyed=false"]);
      } finally {
        client.destroy();
        server.closeAllConnections();
        server.close();
      }
    },
  );

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
