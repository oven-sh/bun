/**
 * This test must also pass in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { duplexPair } from "node:stream";

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

// res.destroy() tears the connection down while the request is being read. The
// request emits 'end' only if its whole body reaches it.
describe("res.destroy() while the request is being read", () => {
  // `wire` is what the client sends. Of a pair, the second part is sent once
  // the 'request' listener has run.
  async function recordRequest(
    wire: string | [string, string],
    listener: (req: IncomingMessage, res: ServerResponse) => void,
    options: { highWaterMark?: number } = {},
  ) {
    const [first, second] = typeof wire === "string" ? [wire] : wire;
    const events: string[] = [];
    const listenerRan = Promise.withResolvers<void>();
    const reqClosed = Promise.withResolvers<void>();
    const resClosed = Promise.withResolvers<void>();
    const server = createServer(options, (req, res) => {
      req.on("aborted", () => events.push("req.aborted"));
      req.on("error", e => events.push("req.error:" + (e as NodeJS.ErrnoException).code));
      req.on("end", () => events.push("req.end"));
      req.on("close", () => {
        events.push(`req.close (complete: ${req.complete})`);
        reqClosed.resolve();
      });
      res.on("close", () => {
        events.push("res.close");
        resClosed.resolve();
      });
      listener(req, res);
      listenerRan.resolve();
    });
    let client: ReturnType<typeof connect> | undefined;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      client = connect(port, "127.0.0.1");
      client.on("error", () => {});
      client.write(first);
      if (second !== undefined) {
        await listenerRan.promise;
        client.write(second);
      }
      await Promise.all([reqClosed.promise, resClosed.promise]);
      return events;
    } finally {
      client?.destroy();
      server.close();
    }
  }

  // Only 3 of the 10 body bytes ever arrive, and the listener destroys the
  // response before the request's first _read() has run. The request is aborted
  // like any other truncated body, not ended as if its body were complete (and
  // empty).
  const truncatedPost = "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc";
  const aborted = ["req.aborted", "res.close", "req.error:ECONNRESET", "req.close (complete: false)"];

  const consumers: Record<string, (req: IncomingMessage) => void> = {
    "a 'data' listener": req => req.on("data", () => {}),
    "resume()": req => req.resume(),
    "a 'readable' listener": req =>
      req.on("readable", () => {
        while (req.read() !== null);
      }),
  };

  test.concurrent.each(Object.keys(consumers))("truncated body read with %s: aborted, no 'end'", async consumer => {
    const events = await recordRequest(truncatedPost, (req, res) => {
      consumers[consumer](req);
      res.destroy();
    });
    expect(events).toEqual(aborted);
  });

  test.concurrent("truncated body: for await rejects instead of finishing with an empty body", async () => {
    const iteration = Promise.withResolvers<string>();
    const events = await recordRequest(truncatedPost, (req, res) => {
      res.destroy();
      (async () => {
        let received = 0;
        for await (const chunk of req) received += chunk.length;
        return `finished with ${received} bytes`;
      })().then(iteration.resolve, e => iteration.resolve("rejected: " + e.code));
    });
    expect({ events, iteration: await iteration.promise }).toEqual({
      events: aborted,
      iteration: "rejected: ECONNRESET",
    });
  });

  // An upload that the listener rejects part way: the first body bytes arrive in
  // a later read than the headers, and a 'data' listener destroys the response.
  test.concurrent.each([
    ["Content-Length", "Content-Length: 100\r\n\r\n", "0123456789"],
    ["chunked", "Transfer-Encoding: chunked\r\n\r\n", "a\r\n0123456789\r\n"],
  ])("upload (%s) cut short from inside a 'data' listener: aborted, no 'end'", async (_, framing, bodyStart) => {
    const events = await recordRequest(["POST / HTTP/1.1\r\nHost: x\r\n" + framing, bodyStart], (req, res) => {
      req.on("data", () => res.destroy());
    });
    expect(events).toEqual(aborted);
  });

  // The first chunk alone overflows the 1 KiB highWaterMark, so the connection
  // is paused while the rest of the segment (the second chunk and the
  // terminating chunk) is still being parsed. By the time setImmediate runs the
  // whole body has been received, but only its first chunk has reached the
  // request's buffer.
  test.concurrent("complete body whose tail was received while paused: delivered in full, then 'end'", async () => {
    const head = Buffer.alloc(2048, "x").toString();
    const chunkedPost =
      "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n" +
      `${head.length.toString(16)}\r\n${head}\r\n4\r\ntail\r\n0\r\n\r\n`;
    let received = "";
    const events = await recordRequest(
      chunkedPost,
      (req, res) => {
        setImmediate(() => {
          req.on("data", chunk => (received += chunk));
          res.destroy();
        });
      },
      { highWaterMark: 1024 },
    );
    expect({ events, received }).toEqual({
      events: ["req.end", "req.close (complete: true)", "res.close"],
      received: head + "tail",
    });
  });
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
