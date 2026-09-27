/**
 * This test must also pass in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo, Socket } from "node:net";
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

// The expected values are what Node.js v26.3.0 does (end(), onError() and write_() in lib/_http_outgoing.js).
describe("a late end() or write() answers its callback like Node.js", () => {
  type Callback = (err?: NodeJS.ErrnoException | null) => void;
  type Observed = { callbacks: string[]; errorEvents: (string | undefined)[]; returned: unknown };

  const lateCalls = {
    "end(cb)": (res: ServerResponse, cb: Callback) => res.end(cb),
    'end("", cb)': (res: ServerResponse, cb: Callback) => res.end("", cb),
    "end(chunk, cb)": (res: ServerResponse, cb: Callback) => res.end("late", cb),
    "write(chunk, cb)": (res: ServerResponse, cb: Callback) => res.write("late", cb),
    'write("", cb)': (res: ServerResponse, cb: Callback) => res.write("", cb),
  };
  type LateCall = keyof typeof lateCalls;

  function observe(res: ServerResponse, call: LateCall) {
    return new Promise<Observed>(resolve => {
      const callbacks: string[] = [];
      const errorEvents: (string | undefined)[] = [];
      res.on("error", err => errorEvents.push((err as NodeJS.ErrnoException).code));
      let sync = true;
      const returned = lateCalls[call](res, err => callbacks.push(`${sync ? "sync" : "async"} ${err?.code}`));
      sync = false;
      // A deferred callback is queued with process.nextTick(), so it has run by the next immediate.
      setImmediate(resolve, { callbacks, errorEvents, returned: returned === res ? "res" : returned });
    });
  }

  // `respond` answers one GET and calls `run` once the response is in the state under test.
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
      expected: {
        "end(cb)": alreadyFinished,
        'end("", cb)': alreadyFinished,
        "end(chunk, cb)": dropped,
        "write(chunk, cb)": writeAfterEnd,
        'write("", cb)': writeAfterEnd,
      },
    },
    "finished, the connection is still open": {
      reach: overConnection(false, (req, res, run) => {
        res.once("close", run);
        res.end("ok");
      }),
      expected: {
        "end(cb)": alreadyFinished,
        'end("", cb)': alreadyFinished,
        "end(chunk, cb)": dropped,
        "write(chunk, cb)": writeAfterEnd,
        'write("", cb)': writeAfterEnd,
      },
    },
    // Not destroyed yet (no 'close'), so a write after end also reaches 'error'.
    "finished, the handler destroyed the socket in the same tick": {
      reach: overConnection(false, (req, res, run) => {
        res.end("ok");
        req.socket.destroy();
        run();
      }),
      expected: {
        "end(cb)": alreadyFinished,
        'end("", cb)': alreadyFinished,
        "end(chunk, cb)": { ...writeAfterEnd, errorEvents: ["ERR_STREAM_WRITE_AFTER_END"], returned: "res" },
        "write(chunk, cb)": { ...writeAfterEnd, errorEvents: ["ERR_STREAM_WRITE_AFTER_END"] },
        'write("", cb)': { ...writeAfterEnd, errorEvents: ["ERR_STREAM_WRITE_AFTER_END"] },
      },
    },
    // 'close' is queued before the 'finish' listeners run, so the response is destroyed before 'error' can be emitted.
    "finished, inside a 'finish' listener": {
      reach: overConnection(false, (req, res, run) => {
        res.once("finish", run);
        res.end("ok");
      }),
      expected: {
        "end(cb)": alreadyFinished,
        'end("", cb)': alreadyFinished,
        "end(chunk, cb)": { ...writeAfterEnd, returned: "res" },
        "write(chunk, cb)": writeAfterEnd,
        'write("", cb)': writeAfterEnd,
      },
    },
    "finished, inside the end() callback": {
      reach: overConnection(false, (req, res, run) => {
        res.end("ok", run);
      }),
      expected: {
        "end(cb)": alreadyFinished,
        'end("", cb)': alreadyFinished,
        "end(chunk, cb)": { ...writeAfterEnd, returned: "res" },
        "write(chunk, cb)": writeAfterEnd,
        'write("", cb)': writeAfterEnd,
      },
    },
    "unfinished, the client closed the connection": {
      reach: overConnection(true, (req, res, run) => {
        whenConnectionClosed(req, res, run);
        res.write("ok");
      }),
      expected: {
        "end(cb)": dropped,
        'end("", cb)': dropped,
        "end(chunk, cb)": dropped,
        "write(chunk, cb)": destroyed,
        'write("", cb)': destroyed,
      },
    },
    "unfinished, destroyed before it got a socket": {
      async reach(call) {
        const res = new ServerResponse(new IncomingMessage(null as any));
        const closed = once(res, "close");
        res.destroy();
        await closed;
        return observe(res, call);
      },
      expected: {
        "end(cb)": dropped,
        'end("", cb)': dropped,
        "end(chunk, cb)": dropped,
        "write(chunk, cb)": destroyed,
        'write("", cb)': destroyed,
      },
    },
  };

  const rows = Object.entries(states).flatMap(([name, state]) =>
    (Object.keys(lateCalls) as LateCall[]).map(call => [name, call, state] as const),
  );

  test.concurrent.each(rows)("%s: %s", async (_name, call, state) => {
    expect(await state.reach(call)).toEqual(state.expected[call]);
  });

  test("the error of a write() to a destroyed response names write()", async () => {
    const res = new ServerResponse(new IncomingMessage(null as any));
    res.destroy();
    const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException | null | undefined>();
    res.write("late", resolve);
    const err = await promise;
    expect({ code: err?.code, message: err?.message }).toEqual({
      code: "ERR_STREAM_DESTROYED",
      message: "Cannot call write after a stream was destroyed",
    });
  });

  // Only the empty string is a chunk that write() accepts and end() ignores.
  test("write() of a chunk that is not a string still throws on a destroyed response without a socket", () => {
    const res = new ServerResponse(new IncomingMessage(null as any));
    res.destroy();
    const codes = [null, undefined].map(chunk => {
      try {
        res.write(chunk as any);
        return "no throw";
      } catch (err) {
        return (err as NodeJS.ErrnoException).code;
      }
    });
    expect(codes).toEqual(["ERR_STREAM_NULL_VALUES", "ERR_INVALID_ARG_TYPE"]);
  });
});

test("res close cannot remove a socket listener from the current close emission", async () => {
  const events: string[] = [];
  const gotRequest = Promise.withResolvers<void>();
  const responseClosed = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    const onSocketClose = () => events.push("socket.close");
    req.socket.on("close", onSocketClose);
    res.on("close", () => {
      events.push("res.close");
      req.socket.off("close", onSocketClose);
      responseClosed.resolve();
    });
    req.on("data", () => {});
    gotRequest.resolve();
  });
  let client: ReturnType<typeof connect> | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    client = connect(port, "127.0.0.1");
    client.on("error", () => {});
    await once(client, "connect");
    client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial");
    await gotRequest.promise;
    const clientClosed = once(client, "close");
    client.destroy();
    await Promise.all([responseClosed.promise, clientClosed]);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(events).toEqual(["res.close", "socket.close"]);
  } finally {
    client?.destroy();
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
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", fixture], {
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
  });
  // Node's parser stops at the throw, so the request events differ there: only
  // the bytes on the wire are compared.
  const { received, events } = JSON.parse(stdout);
  expect({ received, uncaught: events[0] }).toEqual({ received: 0, uncaught: "uncaught:boom" });
});

test("res.write()/end() after req.socket.destroy() inside the handler", async () => {
  // The request handler destroys its own socket before writing: write() must
  // report false (Node.js's OutgoingMessage._writeRaw returns false for a
  // destroyed socket) and end() must still transition to `finished` /
  // `writableEnded` and emit 'prefinish', without emitting 'finish'.
  const events: string[] = [];
  const { promise: resClosed, resolve: resolveResClosed } = Promise.withResolvers<void>();
  let writeResult: boolean | undefined;
  let endReturnedSelf: boolean | undefined;
  let finishedAfterEnd: boolean | undefined;
  let writableEndedAfterEnd: boolean | undefined;
  let writeCbCalled = false;
  let endCbCalled = false;

  const server = createServer((req, res) => {
    res.on("prefinish", () => events.push("res.prefinish"));
    res.on("finish", () => events.push("res.finish"));
    res.on("close", () => {
      events.push("res.close");
      resolveResClosed();
    });

    req.socket.destroy();
    writeResult = res.write("body", () => (writeCbCalled = true));
    endReturnedSelf = res.end("done", () => (endCbCalled = true)) === res;
    finishedAfterEnd = res.finished;
    writableEndedAfterEnd = res.writableEnded;
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect(port, "127.0.0.1");
    client.on("error", () => {});
    await once(client, "connect");
    client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await resClosed;

    expect({
      writeResult,
      endReturnedSelf,
      finishedAfterEnd,
      writableEndedAfterEnd,
      writeCbCalled,
      endCbCalled,
      events,
    }).toEqual({
      writeResult: false,
      endReturnedSelf: true,
      finishedAfterEnd: true,
      writableEndedAfterEnd: true,
      writeCbCalled: false,
      endCbCalled: false,
      events: ["res.prefinish", "res.close"],
    });
  } finally {
    server.close();
  }
});

// Like Node.js's net.Socket: the connection socket (req.socket) emits 'end' for
// the peer's FIN and 'error' (read ECONNRESET, routed to 'clientError') for the
// peer's RST, each before 'close'. A close the server starts emits only 'close'.
describe("req.socket reports how the client closed the connection", () => {
  const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
  const tlsOptions = {
    key: readFileSync(path.join(keys, "agent1-key.pem")),
    cert: readFileSync(path.join(keys, "agent1-cert.pem")),
  };

  // idle: after a finished keep-alive response. pending: a complete request the
  // listener has not answered. midbody: half of the request body has arrived.
  type When = "idle" | "pending" | "midbody";
  type How = "FIN" | "RST" | "closeIdleConnections";

  async function closeConnection(secure: boolean, when: When, how: How, withClientErrorListener = true) {
    const socketEvents: string[] = [];
    const clientErrors: string[] = [];
    const gotRequest = Promise.withResolvers<void>();
    const socketClosed = Promise.withResolvers<void>();

    const listener = (req: IncomingMessage, res: ServerResponse) => {
      const socket = req.socket;
      socket.on("end", () => socketEvents.push("end"));
      socket.on("error", (e: NodeJS.ErrnoException) =>
        socketEvents.push(`error "${e.message}" code=${e.code} syscall=${e.syscall}`),
      );
      socket.on("close", () => {
        socketEvents.push("close");
        socketClosed.resolve();
      });
      req.resume();
      if (when === "idle") res.end("ok");
      gotRequest.resolve();
    };
    const server = secure ? createHttpsServer(tlsOptions, listener) : createServer(listener);
    if (withClientErrorListener) {
      server.on("clientError", (e: NodeJS.ErrnoException, socket: Socket) => {
        clientErrors.push(String(e.code));
        socket.destroy();
      });
    }

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const tcp = connect((server.address() as AddressInfo).port, "127.0.0.1");
    try {
      tcp.on("error", () => {});
      const client = secure ? tlsConnect({ socket: tcp, rejectUnauthorized: false }) : tcp;
      client.on("error", () => {});
      await once(client, secure ? "secureConnect" : "connect");

      if (when === "midbody") {
        client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nhello");
      } else {
        client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      }
      if (when === "idle") await once(client, "data");
      else await gotRequest.promise;

      if (how === "RST") tcp.resetAndDestroy();
      else if (how === "FIN") client.end();
      else server.closeIdleConnections();
      await socketClosed.promise;
      return { socketEvents, clientErrors };
    } finally {
      tcp.destroy();
      server.close();
    }
  }

  for (const secure of [false, true]) {
    for (const when of ["idle", "pending", "midbody"] as const) {
      test.concurrent(`${secure ? "https" : "http"}: FIN while ${when} emits 'end' then 'close'`, async () => {
        expect(await closeConnection(secure, when, "FIN")).toEqual({
          socketEvents: ["end", "close"],
          // Node's socketOnEnd: an EOF inside a message is a parse error.
          clientErrors: when === "midbody" ? ["HPE_INVALID_EOF_STATE"] : [],
        });
      });

      test.concurrent(`${secure ? "https" : "http"}: RST while ${when} emits 'error' then 'close'`, async () => {
        expect(await closeConnection(secure, when, "RST")).toEqual({
          socketEvents: ['error "read ECONNRESET" code=ECONNRESET syscall=read', "close"],
          clientErrors: ["ECONNRESET"],
        });
      });
    }

    // Over TLS the peer answers the server's close_notify. That answer is not a
    // half-close by the client.
    test.concurrent(`${secure ? "https" : "http"}: closeIdleConnections() emits only 'close'`, async () => {
      expect(await closeConnection(secure, "idle", "closeIdleConnections")).toEqual({
        socketEvents: ["close"],
        clientErrors: [],
      });
    });
  }

  test.concurrent("RST with no 'clientError' listener still emits 'error' then 'close'", async () => {
    expect(await closeConnection(false, "idle", "RST", false)).toEqual({
      socketEvents: ['error "read ECONNRESET" code=ECONNRESET syscall=read', "close"],
      clientErrors: [],
    });
  });
});
