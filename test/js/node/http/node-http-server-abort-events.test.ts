/**
 * This test must also pass in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import type { Server } from "node:http";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
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

// A handler that answers before the request body has been received (the usual
// shape of an early 413/401/redirect). Node keeps parsing the rest of the body
// in the background: the IncomingMessage is only complete ('end', then 'close',
// req.complete === true) once the body has actually arrived, a consumer
// attached before or in the same tick as res.end() still gets every byte, and
// a connection that drops mid-body leaves the request as it was.
describe("request body arriving after the response was ended", () => {
  function reqState(req: IncomingMessage) {
    return { complete: req.complete, readableEnded: req.readableEnded, destroyed: req.destroyed, aborted: req.aborted };
  }

  async function listen(server: Server) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return (server.address() as AddressInfo).port;
  }

  // A raw client so the request body can be sent in pieces.
  async function rawClient(port: number) {
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let received = "";
    let onData: (() => void) | undefined;
    socket.on("data", chunk => {
      received += chunk;
      onData?.();
    });
    await once(socket, "connect");
    return {
      socket,
      write: (data: string) => new Promise<void>(resolve => socket.write(data, () => resolve())),
      // Resolves once the response body `marker` has been received; the
      // response is on the wire before the server-side request can complete.
      async response(marker: string) {
        while (!received.includes(marker)) {
          await new Promise<void>(resolve => (onData = resolve));
        }
        const out = received;
        received = "";
        return out;
      },
    };
  }

  function closeServer(server: Server) {
    // Resolves only once every request has been released by the server; a
    // request that is never accounted as finished hangs this (and the test).
    return new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  }

  test("req completes with 'end' then 'close' once the rest of the body arrives, not at res.end()", async () => {
    const events: string[] = [];
    const { promise: request, resolve: gotRequest } = Promise.withResolvers<IncomingMessage>();
    const { promise: reqClosed, resolve: resolveReqClosed } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      req.on("aborted", () => events.push("aborted"));
      req.on("end", () => events.push("end"));
      req.on("close", () => {
        events.push("close");
        resolveReqClosed();
      });
      res.end("first");
      gotRequest(req);
    });
    try {
      const client = await rawClient(await listen(server));
      await client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 6\r\n\r\nabc");
      const req = await request;
      await client.response("first");

      // Half of the body is still outstanding: the message is not complete.
      expect({ ...reqState(req), events: [...events] }).toEqual({
        complete: false,
        readableEnded: false,
        destroyed: false,
        aborted: false,
        events: [],
      });

      await client.write("def");
      await reqClosed;
      expect({ ...reqState(req), events }).toEqual({
        complete: true,
        readableEnded: true,
        destroyed: true,
        aborted: false,
        events: ["end", "close"],
      });

      // The trailing body bytes were consumed as body, so the kept-alive
      // connection is still in sync for the next request.
      await client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      expect(await client.response("first")).toStartWith("HTTP/1.1 200 OK");

      client.socket.destroy();
      await closeServer(server);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("a connection dropped mid-body after the response leaves req incomplete and emits nothing", async () => {
    const events: string[] = [];
    const { promise: request, resolve: gotRequest } = Promise.withResolvers<IncomingMessage>();
    const { promise: serverSocketClosed, resolve: resolveServerSocketClosed } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      for (const name of ["aborted", "end", "close", "error"]) req.on(name, () => events.push(name));
      (req.socket as Socket).on("close", () => resolveServerSocketClosed());
      res.end("first");
      gotRequest(req);
    });
    // The half-sent body makes the peer's close a parse error on the
    // connection ('clientError', like Node); the connection is already gone.
    server.on("clientError", (_err, socket) => socket.destroy());
    try {
      const client = await rawClient(await listen(server));
      await client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 6\r\n\r\nabc");
      const req = await request;
      await client.response("first");

      client.socket.destroy();
      await serverSocketClosed;
      // Like Node's socketOnClose, only requests whose response has not
      // finished are aborted; this one is simply left incomplete.
      await closeServer(server);
      expect({ ...reqState(req), events, socketDestroyed: req.socket.destroyed }).toEqual({
        complete: false,
        readableEnded: false,
        destroyed: false,
        aborted: false,
        events: [],
        socketDestroyed: true,
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  // Issues #4733 and #18613: the body is lost when res.end() runs
  // synchronously in the handler, whether it was in the same packet as the
  // headers (curl -d) or is still in flight.
  test.each([
    ["in the same packet as the headers", "hello", ""],
    ["still in flight", "he", "llo"],
  ])("a 'data' listener attached before a synchronous res.end() receives a body %s", async (_, first, rest) => {
    const { promise: body, resolve: resolveBody } = Promise.withResolvers<object>();
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => resolveBody({ body: Buffer.concat(chunks).toString(), ...reqState(req) }));
      res.end("first");
    });
    try {
      const client = await rawClient(await listen(server));
      await client.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\n${first}`);
      await client.response("first");
      if (rest) await client.write(rest);
      expect(await body).toEqual({
        body: "hello",
        complete: true,
        readableEnded: true,
        destroyed: false,
        aborted: false,
      });
      client.socket.destroy();
      await closeServer(server);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("a consumer attached in the same tick after res.end() still receives the body", async () => {
    // Node decides whether to dump an unread body on the response's 'finish'
    // (resOnFinish), so a listener attached right after res.end() counts.
    const { promise: body, resolve: resolveBody } = Promise.withResolvers<object>();
    const server = createServer((req, res) => {
      res.end("first");
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => resolveBody({ body: Buffer.concat(chunks).toString(), complete: req.complete }));
    });
    try {
      const client = await rawClient(await listen(server));
      await client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhe");
      await client.response("first");
      await client.write("llo");
      expect(await body).toEqual({ body: "hello", complete: true });
      client.socket.destroy();
      await closeServer(server);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("req.pause()/resume() keep working for a body arriving after the response", async () => {
    const { promise: request, resolve: gotRequest } = Promise.withResolvers<IncomingMessage>();
    const { promise: firstChunk, resolve: gotFirstChunk } = Promise.withResolvers<void>();
    const { promise: body, resolve: resolveBody } = Promise.withResolvers<object>();
    const server = createServer((req, res) => {
      res.end("first");
      const chunks: Buffer[] = [];
      req.on("data", chunk => {
        chunks.push(chunk);
        if (chunks.length === 1) {
          req.pause();
          gotFirstChunk();
        }
      });
      req.on("end", () => resolveBody({ body: Buffer.concat(chunks).toString(), complete: req.complete }));
      gotRequest(req);
    });
    try {
      const client = await rawClient(await listen(server));
      await client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 9\r\n\r\n");
      const req = await request;
      await client.response("first");
      await client.write("abc");
      await firstChunk;
      expect(req.isPaused()).toBe(true);
      await client.write("defghi");
      req.resume();
      expect(await body).toEqual({ body: "abcdefghi", complete: true });
      client.socket.destroy();
      await closeServer(server);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  // A request that forbids connection reuse makes the server close the
  // connection right after the response. Node still parses everything it has
  // already read first: a body that came in with the headers is delivered (or
  // dumped) and completes the request before the socket is closed.
  describe("on a connection the response closes", () => {
    const requestHeads = [
      ["Connection: close", "POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n"],
      ["HTTP/1.0", "POST / HTTP/1.0\r\nHost: x\r\n"],
    ] as const;

    // Resolves with the request's state as observed when the server-side socket
    // closed; the closing is what the early response triggers, so by then the
    // request must already be in its final state.
    function observeUntilSocketClose(server: Server, onRequest: (req: IncomingMessage) => object) {
      const { promise, resolve } = Promise.withResolvers<object>();
      server.on("request", req => {
        (req.socket as Socket).once("close", () => resolve(onRequest(req)));
      });
      return promise;
    }

    // Sends the request in one packet and waits for the server to close the
    // connection; resolves with what the client received. The close listener is
    // registered before writing: client and server share this event loop, so
    // the client's 'close' may fire before the server-side one is observed.
    async function requestUntilClosed(server: Server, request: string) {
      const client = await rawClient(await listen(server));
      const clientClosed = once(client.socket, "close");
      await client.write(request);
      await clientClosed;
      return client.response("first");
    }

    test.each(requestHeads)(
      "a consumer attached before the synchronous res.end() receives a body sent with the headers (%s)",
      async (_, head) => {
        const events: string[] = [];
        const chunks: Buffer[] = [];
        const server = createServer((req, res) => {
          req.on("data", chunk => chunks.push(chunk));
          req.on("end", () => events.push("end"));
          req.on("close", () => events.push("close"));
          req.on("error", err => events.push(`error:${(err as NodeJS.ErrnoException).code}`));
          req.on("aborted", () => events.push("aborted"));
          res.end("first");
        });
        const observed = observeUntilSocketClose(server, req => ({
          body: Buffer.concat(chunks).toString(),
          events: [...events],
          ...reqState(req),
        }));
        try {
          const response = await requestUntilClosed(server, `${head}Content-Length: 5\r\n\r\nhello`);
          expect(await observed).toEqual({
            body: "hello",
            events: ["end", "close"],
            complete: true,
            readableEnded: true,
            destroyed: true,
            aborted: false,
          });
          // The response made it out before the connection was closed.
          expect(response).toStartWith("HTTP/1.1 200 OK");
          await closeServer(server);
        } finally {
          server.closeAllConnections();
          server.close();
        }
      },
    );

    test("an unread body sent with the headers is dumped and still completes the request", async () => {
      const events: string[] = [];
      const server = createServer((req, res) => {
        req.on("end", () => events.push("end"));
        req.on("close", () => events.push("close"));
        res.end("first");
      });
      const observed = observeUntilSocketClose(server, req => ({ events: [...events], ...reqState(req) }));
      try {
        await requestUntilClosed(
          server,
          "POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 5\r\n\r\nhello",
        );
        expect(await observed).toEqual({
          events: ["end", "close"],
          complete: true,
          readableEnded: true,
          destroyed: true,
          aborted: false,
        });
        await closeServer(server);
      } finally {
        server.closeAllConnections();
        server.close();
      }
    });

    test("the part of the body that had arrived is delivered and the request is left incomplete", async () => {
      const events: string[] = [];
      const server = createServer((req, res) => {
        req.on("data", chunk => events.push(`data:${chunk}`));
        for (const name of ["end", "close", "aborted", "error"]) req.on(name, () => events.push(name));
        res.end("first");
      });
      const observed = observeUntilSocketClose(server, req => ({ events: [...events], ...reqState(req) }));
      try {
        // The rest of the body never comes; the server closes the connection
        // after the response regardless, like Node's destroySoon().
        const response = await requestUntilClosed(
          server,
          "POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 100\r\n\r\nabc",
        );
        expect(await observed).toEqual({
          events: ["data:abc"],
          complete: false,
          readableEnded: false,
          destroyed: false,
          aborted: false,
        });
        expect(response).toStartWith("HTTP/1.1 200 OK");
        // The request was released even though its body never completed.
        await closeServer(server);
      } finally {
        server.closeAllConnections();
        server.close();
      }
    });

    // A second request pipelined behind the one that closes the connection, in
    // the same packet as its body: the body is still delivered, and the
    // connection closes after the first response without answering the second
    // request, whether the request or the response asked for the close, and
    // whether or not a 'clientError' listener (which sees the rejected second
    // request) takes care of destroying the connection itself.
    const pipelined = "GET /second HTTP/1.1\r\nHost: x\r\n\r\n";
    test.each([
      ["the request asked to close", "Connection: close\r\n", false, false],
      ["the response asked to close", "", true, false],
      [
        "the request asked to close and a 'clientError' listener ignores the rest",
        "Connection: close\r\n",
        false,
        true,
      ],
    ])(
      "a request pipelined behind it is not answered (%s)",
      async (_, closeHeader, closeFromResponse, ignoreClientErrors) => {
        const { promise: body, resolve: resolveBody } = Promise.withResolvers<string>();
        const server = createServer((req, res) => {
          if (req.url === "/first") {
            const chunks: Buffer[] = [];
            req.on("data", chunk => chunks.push(chunk));
            req.on("end", () => resolveBody(Buffer.concat(chunks).toString()));
            if (closeFromResponse) res.setHeader("Connection", "close");
          }
          res.end("first");
        });
        if (ignoreClientErrors) server.on("clientError", () => {});
        try {
          const response = await requestUntilClosed(
            server,
            `POST /first HTTP/1.1\r\nHost: x\r\n${closeHeader}Content-Length: 5\r\n\r\nhello${pipelined}`,
          );
          expect(await body).toBe("hello");
          expect(response.match(/HTTP\/1\.1 200 OK/g)).toHaveLength(1);
          await closeServer(server);
        } finally {
          server.closeAllConnections();
          server.close();
        }
      },
    );
  });
});
