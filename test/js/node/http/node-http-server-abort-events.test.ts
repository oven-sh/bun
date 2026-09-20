/**
 * This test must also pass in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import path from "node:path";
import { duplexPair } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { promisify } from "node:util";

test("aborted request body emits 'error' ECONNRESET and res 'close' before req 'close'", async () => {
  // Like Node.js's socketOnClose → abortIncoming: the aborted request is
  // destroyed with ConnResetException after res 'close' has been scheduled.
  const events: string[] = [];
  const { promise: gotRequest, resolve: resolveRequest } = Promise.withResolvers<void>();
  const { promise: reqClosed, resolve: resolveReqClosed } = Promise.withResolvers<void>();
  const { promise: resClosed, resolve: resolveResClosed } = Promise.withResolvers<void>();

  const server = createServer((req, res) => {
    req.on("aborted", () => events.push("req.aborted"));
    req.on("error", e => events.push("req.error:" + (e as NodeJS.ErrnoException).code));
    req.on("close", () => {
      events.push("req.close");
      resolveReqClosed();
    });
    res.on("close", () => {
      events.push("res.close");
      resolveResClosed();
    });
    req.on("data", () => {});
    resolveRequest();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect(port, "127.0.0.1");
    client.on("error", () => {});
    await once(client, "connect");
    client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial");
    await gotRequest;
    client.destroy();
    await Promise.all([reqClosed, resClosed]);

    expect(events).toEqual(["req.aborted", "res.close", "req.error:ECONNRESET", "req.close"]);
  } finally {
    server.close();
  }
});

// Like Node.js's OutgoingMessage#destroy, res.destroy() does not emit 'close'
// itself. A response that still has its socket gets 'close' from the socket
// teardown (so an ended response still emits 'finish' first); a response
// without one (already finished, still queued, standalone) gets it a tick
// later. Either way 'close' is observed after destroy() has returned, with
// res.closed false in between.
describe("res.destroy() defers 'close'", () => {
  function destroyRecording(res: ServerResponse, events: string[], err?: Error) {
    events.push("destroy()");
    res.destroy(err);
    events.push(`destroy() returned (closed: ${res.closed})`);
  }

  function recordResponse(res: ServerResponse, events: string[], onClose: () => void) {
    res.on("finish", () => events.push("res.finish"));
    res.on("close", () => {
      events.push(`res.close (closed: ${res.closed})`);
      onClose();
    });
  }

  // Serves one GET over a real connection and returns the recorded events once
  // both the request and the response have emitted 'close'. With
  // connectionClosedByServer it also waits for the server to close the
  // connection, which destroy() does whenever the response still has its socket.
  async function serveAndRecord(
    listener: (req: IncomingMessage, res: ServerResponse, events: string[]) => void,
    { connectionClosedByServer = true } = {},
  ) {
    const events: string[] = [];
    const reqClosed = Promise.withResolvers<void>();
    const resClosed = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      req.on("aborted", () => events.push("req.aborted"));
      req.on("close", () => {
        events.push("req.close");
        reqClosed.resolve();
      });
      recordResponse(res, events, resClosed.resolve);
      listener(req, res, events);
      events.push("listener returned");
    });
    let client: ReturnType<typeof connect> | undefined;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      client = connect(port, "127.0.0.1");
      client.on("error", () => {});
      const clientClosed = Promise.withResolvers<void>();
      client.on("close", () => clientClosed.resolve());
      let received = "";
      client.on("data", chunk => (received += chunk.toString("latin1")));
      client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      await Promise.all([reqClosed.promise, resClosed.promise]);
      if (connectionClosedByServer) await clientClosed.promise;
      return { events, received };
    } finally {
      client?.destroy();
      server.close();
    }
  }

  test.concurrent("after end(): 'close' follows 'finish' and the response still reaches the client", async () => {
    const { events, received } = await serveAndRecord((req, res, events) => {
      res.end("hello");
      destroyRecording(res, events);
    });
    expect(events).toEqual([
      "destroy()",
      "destroy() returned (closed: false)",
      "listener returned",
      "res.finish",
      "res.close (closed: true)",
      "req.close",
    ]);
    expect(received).toStartWith("HTTP/1.1 200 ");
    expect(received).toEndWith("\r\n\r\nhello");
  });

  // Once the response has finished it no longer has a socket, so (like Node)
  // destroy() leaves the kept-alive connection alone and only defers 'close'.
  test.concurrent("inside a 'finish' listener", async () => {
    const { events } = await serveAndRecord(
      (req, res, events) => {
        res.on("finish", () => destroyRecording(res, events));
        res.end("hello");
      },
      { connectionClosedByServer: false },
    );
    expect(events).toEqual([
      "listener returned",
      "res.finish",
      "destroy()",
      "destroy() returned (closed: false)",
      "res.close (closed: true)",
      "req.close",
    ]);
  });

  test.concurrent("inside the end() callback", async () => {
    const { events } = await serveAndRecord(
      (req, res, events) => {
        res.end("hello", () => {
          events.push("end callback");
          destroyRecording(res, events);
        });
      },
      { connectionClosedByServer: false },
    );
    expect(events).toEqual([
      "listener returned",
      "res.finish",
      "end callback",
      "destroy()",
      "destroy() returned (closed: false)",
      "res.close (closed: true)",
      "req.close",
    ]);
  });

  const destroyedBeforeFinishing = [
    "destroy()",
    "destroy() returned (closed: false)",
    "listener returned",
    "req.aborted",
    "res.close (closed: true)",
    "req.close",
  ];

  test.concurrent("before anything was written: 'close' comes from the connection teardown", async () => {
    const { events } = await serveAndRecord((req, res, events) => {
      destroyRecording(res, events);
    });
    expect(events).toEqual(destroyedBeforeFinishing);
  });

  test.concurrent("after a partial body", async () => {
    const { events } = await serveAndRecord((req, res, events) => {
      res.write("partial");
      destroyRecording(res, events);
    });
    expect(events).toEqual(destroyedBeforeFinishing);
  });

  test.concurrent("destroy(err) reports the error as res.errored inside 'close'", async () => {
    const err = new Error("boom");
    let erroredInClose: unknown;
    const { events } = await serveAndRecord((req, res, events) => {
      res.on("close", () => (erroredInClose = res.errored));
      destroyRecording(res, events, err);
    });
    expect(events).toEqual(destroyedBeforeFinishing);
    expect(erroredInClose).toBe(err);
  });

  test.concurrent("after the request listener has returned", async () => {
    const { events } = await serveAndRecord((req, res, events) => {
      setImmediate(() => destroyRecording(res, events));
    });
    expect(events).toEqual([
      "listener returned",
      "destroy()",
      "destroy() returned (closed: false)",
      "req.aborted",
      "res.close (closed: true)",
      "req.close",
    ]);
  });

  // server.emit("connection", duplex) serves the connection with the JS
  // HTTP/1 parser: here 'close' comes from the assigned socket's own 'close'.
  test.concurrent.each([false, true])(
    "on a response served over server.emit('connection') (ended first: %p)",
    async endFirst => {
      const events: string[] = [];
      const resClosed = Promise.withResolvers<void>();
      const server = createServer((req, res) => {
        recordResponse(res, events, resClosed.resolve);
        if (endFirst) res.end("hello");
        destroyRecording(res, events);
        events.push("listener returned");
      });
      const [clientSide, serverSide] = duplexPair();
      try {
        serverSide.on("close", () => events.push("socket.close"));
        server.emit("connection", serverSide);
        clientSide.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        await resClosed.promise;
        expect(events).toEqual([
          "destroy()",
          "destroy() returned (closed: false)",
          "listener returned",
          ...(endFirst ? ["res.finish"] : []),
          "socket.close",
          "res.close (closed: true)",
        ]);
      } finally {
        clientSide.destroy();
        serverSide.destroy();
      }
    },
  );

  // A response queued behind an unfinished pipelined response has no socket
  // yet (res.socket === null), so this takes the same deferred path as a
  // standalone response.
  test.concurrent("on a response still queued behind a pipelined response", async () => {
    const events: string[] = [];
    const secondClosed = Promise.withResolvers<void>();
    const responses: ServerResponse[] = [];
    const server = createServer((req, res) => {
      responses.push(res);
      if (req.url === "/first") return;
      events.push(`second dispatched (socket: ${res.socket})`);
      recordResponse(res, events, secondClosed.resolve);
      destroyRecording(res, events);
    });
    let client: ReturnType<typeof connect> | undefined;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      client = connect(port, "127.0.0.1");
      client.on("error", () => {});
      client.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\n\r\n");
      await secondClosed.promise;
      expect(events).toEqual([
        "second dispatched (socket: null)",
        "destroy()",
        "destroy() returned (closed: false)",
        "res.close (closed: true)",
      ]);
    } finally {
      for (const res of responses) res.destroy();
      client?.destroy();
      server.close();
    }
  });

  test("on a standalone response that was never given a socket", async () => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const res = new ServerResponse(new IncomingMessage(null as any));
    recordResponse(res, events, closed.resolve);
    destroyRecording(res, events);
    await closed.promise;
    expect(events).toEqual(["destroy()", "destroy() returned (closed: false)", "res.close (closed: true)"]);
  });
});

// Like Node.js, whose parser runs to the end of the read before the destroyed
// handle closes: the body bytes that arrived in the same read as the head still
// reach the request after the 'request' listener destroyed the connection.
describe.concurrent.each([
  ["http", "req.socket.destroy()"],
  ["http", "res.destroy()"],
  ["https", "req.socket.destroy()"],
  ["https", "res.destroy()"],
])("%s: %s inside the 'request' listener", (protocol, destroyCall) => {
  const keysDir = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
  const tlsOptions = {
    cert: readFileSync(path.join(keysDir, "agent1-cert.pem")),
    key: readFileSync(path.join(keysDir, "agent1-key.pem")),
  };

  // Serves one POST whose head and body arrive in one write, destroys the
  // connection from the 'request' listener (or from the first 'data' event),
  // and returns the events once the request and the connection have closed.
  async function destroyAndRecord(body: string, destroyFrom: "request" | "data", { respondOnEnd = false } = {}) {
    const events: string[] = [];
    const reqClosed = Promise.withResolvers<void>();
    const listener = (req: IncomingMessage, res: ServerResponse) => {
      const destroy = () => {
        if (req.socket.destroyed) return;
        if (destroyCall === "res.destroy()") res.destroy();
        else req.socket.destroy();
      };
      req.on("data", chunk => {
        events.push("req.data:" + chunk.length);
        if (destroyFrom === "data") destroy();
      });
      req.on("aborted", () => events.push("req.aborted"));
      req.on("error", e => events.push("req.error:" + (e as NodeJS.ErrnoException).code));
      req.on("end", () => {
        events.push("req.end");
        if (respondOnEnd) res.end("x");
      });
      req.on("close", () => {
        events.push(`req.close (complete: ${req.complete})`);
        reqClosed.resolve();
      });
      res.on("finish", () => events.push("res.finish"));
      if (destroyFrom === "request") destroy();
    };
    const server = protocol === "https" ? createHttpsServer(tlsOptions, listener) : createServer(listener);
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;

      const client =
        protocol === "https"
          ? tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false })
          : connect(port, "127.0.0.1");
      client.on("error", () => {});
      client.on("data", chunk => events.push("client.data:" + chunk.length));
      await once(client, protocol === "https" ? "secureConnect" : "connect");
      client.write(body);
      await Promise.all([reqClosed.promise, once(client, "close")]);
      return events;
    } finally {
      server.close();
    }
  }

  const head = "POST / HTTP/1.1\r\nHost: x\r\n";

  test("the body that arrived with the head still reaches the request", async () => {
    const events = await destroyAndRecord(head + "Content-Length: 10\r\n\r\naaaaaaaaaa", "request");
    expect(events).toEqual(["req.data:10", "req.end", "req.close (complete: true)"]);
  });

  test("a partial body is delivered before the request is aborted", async () => {
    const events = await destroyAndRecord(head + "Content-Length: 10\r\n\r\naaa", "request");
    expect(events).toEqual(["req.data:3", "req.aborted", "req.error:ECONNRESET", "req.close (complete: false)"]);
  });

  test("destroyed from 'data': the chunks that follow in the same read still complete the request", async () => {
    const events = await destroyAndRecord(
      head + "Transfer-Encoding: chunked\r\n\r\n5\r\naaaaa\r\n5\r\nbbbbb\r\n0\r\n\r\n",
      "data",
    );
    expect(events).toEqual(["req.data:5", "req.data:5", "req.end", "req.close (complete: true)"]);
  });

  test("a response written after destroy() does not reach the client and does not finish", async () => {
    const events = await destroyAndRecord(head + "Content-Length: 2\r\n\r\nab", "request", { respondOnEnd: true });
    expect(events).toEqual(["req.data:2", "req.end", "req.close (complete: true)"]);
  });
});

// The listener destroys the connection and then throws. The runtime's error
// response for a throwing listener must not reach a destroyed connection.
// Runs in a subprocess because the throw is an uncaught exception.
test.concurrent("a listener that destroys the connection and then throws sends nothing", async () => {
  const fixture = /* js */ `
    const http = require("node:http");
    const net = require("node:net");
    const events = [];
    process.on("uncaughtException", e => events.push("uncaught:" + e.message));
    const server = http.createServer((req, res) => {
      req.on("data", chunk => events.push("req.data:" + chunk.length));
      req.on("end", () => events.push("req.end"));
      req.on("close", () => events.push("req.close (complete=" + req.complete + ")"));
      req.socket.destroy();
      throw new Error("boom");
    });
    server.listen(0, "127.0.0.1", () => {
      const c = net.connect(server.address().port, "127.0.0.1", () =>
        c.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: 2\\r\\n\\r\\nab"));
      let received = 0;
      c.on("data", d => (received += d.length));
      c.on("error", () => {});
      c.on("close", () => {
        console.log(JSON.stringify({ received, events }));
        server.close();
      });
    });
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["-e", fixture], {
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
  });
  // Node's parser stops at the throw, so the request events differ there: only
  // the bytes on the wire are compared.
  const { received, events } = JSON.parse(stdout);
  expect({ received, uncaught: events[0], stderr }).toEqual({ received: 0, uncaught: "uncaught:boom", stderr: "" });
});
