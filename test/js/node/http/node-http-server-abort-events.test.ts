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

// Node.js's end() looks at `finished` before it looks at the socket, so a
// finished response answers a late end(cb) with ERR_STREAM_ALREADY_FINISHED even
// after the connection is gone. Once the response is destroyed, only write()
// reports a write error to its callback: end() hands write_() no callback, and
// its onError() returns early.
describe("a late end() or write() answers its callback like Node.js", () => {
  type Callback = (err?: NodeJS.ErrnoException | null) => void;
  type Observed = { callbacks: string[]; errorEvents: (string | undefined)[]; returned: unknown };

  const lateCalls = {
    "end(cb)": (res: ServerResponse, cb: Callback) => res.end(cb),
    "end(chunk, cb)": (res: ServerResponse, cb: Callback) => res.end("late", cb),
    "write(chunk, cb)": (res: ServerResponse, cb: Callback) => res.write("late", cb),
  };
  type LateCall = keyof typeof lateCalls;

  // Makes the late call and resolves with what it saw. A deferred callback is
  // queued with process.nextTick(), so it has run by the next immediate.
  function observe(res: ServerResponse, call: LateCall) {
    return new Promise<Observed>(resolve => {
      const callbacks: string[] = [];
      const errorEvents: (string | undefined)[] = [];
      res.on("error", err => errorEvents.push((err as NodeJS.ErrnoException).code));
      let sync = true;
      const returned = lateCalls[call](res, err => callbacks.push(`${sync ? "sync" : "async"} ${err?.code}`));
      sync = false;
      setImmediate(resolve, { callbacks, errorEvents, returned: returned === res ? "res" : returned });
    });
  }

  // Serves one GET over a real connection. `respond` answers it and calls `run`
  // once the response is in the state under test.
  function overConnection(
    clientCloses: boolean,
    respond: (req: IncomingMessage, res: ServerResponse, run: () => void) => void,
  ) {
    return async (call: LateCall) => {
      const observed = Promise.withResolvers<Observed>();
      const server = createServer((req, res) => respond(req, res, () => observed.resolve(observe(res, call))));
      let client: ReturnType<typeof connect> | undefined;
      try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const { port } = server.address() as AddressInfo;
        client = connect(port, "127.0.0.1");
        client.on("error", () => {});
        if (clientCloses) client.once("data", () => client!.destroy());
        client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        return await observed.promise;
      } finally {
        client?.destroy();
        server.close();
      }
    };
  }

  // Calls `run` once the response and the server side of the connection have
  // both emitted 'close'.
  function whenConnectionClosed(req: IncomingMessage, res: ServerResponse, run: () => void) {
    let open = 2;
    const closed = () => {
      if (--open === 0) run();
    };
    res.once("close", closed);
    req.socket.once("close", closed);
  }

  const alreadyFinished = { callbacks: ["sync ERR_STREAM_ALREADY_FINISHED"], errorEvents: [], returned: "res" };
  const dropped = { callbacks: [], errorEvents: [], returned: "res" };
  const writeAfterEnd = { callbacks: ["async ERR_STREAM_WRITE_AFTER_END"], errorEvents: [], returned: false };
  const destroyed = { callbacks: ["async ERR_STREAM_DESTROYED"], errorEvents: [], returned: false };

  const states: Record<string, { reach(call: LateCall): Promise<Observed>; expected: Record<LateCall, Observed> }> = {
    "finished, the client closed the connection": {
      reach: overConnection(true, (req, res, run) => {
        whenConnectionClosed(req, res, run);
        res.end("ok");
      }),
      expected: { "end(cb)": alreadyFinished, "end(chunk, cb)": dropped, "write(chunk, cb)": writeAfterEnd },
    },
    "finished, the connection is still open": {
      reach: overConnection(false, (req, res, run) => {
        res.once("close", run);
        res.end("ok");
      }),
      expected: { "end(cb)": alreadyFinished, "end(chunk, cb)": dropped, "write(chunk, cb)": writeAfterEnd },
    },
    // The response has not emitted 'close' yet, so it is not destroyed and a
    // write after end also reaches 'error'.
    "finished, the handler destroyed the socket in the same tick": {
      reach: overConnection(false, (req, res, run) => {
        res.end("ok");
        req.socket.destroy();
        run();
      }),
      expected: {
        "end(cb)": alreadyFinished,
        "end(chunk, cb)": { ...writeAfterEnd, errorEvents: ["ERR_STREAM_WRITE_AFTER_END"], returned: "res" },
        "write(chunk, cb)": { ...writeAfterEnd, errorEvents: ["ERR_STREAM_WRITE_AFTER_END"] },
      },
    },
    "unfinished, the client closed the connection": {
      reach: overConnection(true, (req, res, run) => {
        whenConnectionClosed(req, res, run);
        res.write("ok");
      }),
      expected: { "end(cb)": dropped, "end(chunk, cb)": dropped, "write(chunk, cb)": destroyed },
    },
    "unfinished, destroyed before it got a socket": {
      async reach(call) {
        const res = new ServerResponse(new IncomingMessage(null as any));
        const closed = once(res, "close");
        res.destroy();
        await closed;
        return observe(res, call);
      },
      expected: { "end(cb)": dropped, "end(chunk, cb)": dropped, "write(chunk, cb)": destroyed },
    },
  };

  const rows = Object.entries(states).flatMap(([name, state]) =>
    (Object.keys(lateCalls) as LateCall[]).map(call => [name, call, state] as const),
  );

  test.concurrent.each(rows)("%s: %s", async (_name, call, state) => {
    expect(await state.reach(call)).toEqual(state.expected[call]);
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
