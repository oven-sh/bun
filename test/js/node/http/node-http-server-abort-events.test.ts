/**
 * This test must also pass in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { execFile, spawn } from "node:child_process";
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
import { Worker } from "node:worker_threads";

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

  // The request was complete and its listener ended the connection, so the FIN of the client
  // ends no message. Over TLS the connection is still open when that FIN arrives.
  async function finAfterTheListenerEndedTheSocket(reads: 1 | 2) {
    const clientErrors: string[] = [];
    const socketClosed = Promise.withResolvers<void>();
    const server = createHttpsServer(tlsOptions, (req, res) => {
      if (req.url === "/barrier") return void res.end();
      req.socket.on("close", () => socketClosed.resolve());
      req.socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
    });
    server.on("clientError", (e: NodeJS.ErrnoException, socket: Socket) => {
      clientErrors.push(String(e.code));
      socket.destroy();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const open = (options = {}) => tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...options });

    const client = open({ allowHalfOpen: true });
    try {
      client.on("error", () => {});
      await once(client, "secureConnect");
      let response = "";
      client.on("data", chunk => (response += chunk));
      const serverEnded = once(client, "end");
      const head = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
      if (reads === 2) {
        client.write(head.slice(0, 20));
        // A whole request on another connection: the server has read the first part by then.
        const barrier = open();
        barrier.on("error", () => {});
        barrier.resume();
        barrier.end("GET /barrier HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        await once(barrier, "close");
        client.write(head.slice(20));
      } else {
        client.write(head);
      }
      await serverEnded;
      client.end();
      await socketClosed.promise;
      return { response: response.slice(-2), clientErrors };
    } finally {
      client.destroy();
      server.close();
    }
  }

  for (const reads of [1, 2] as const) {
    test.concurrent(
      `https: FIN after the listener ended the socket is no parse error, request head in ${reads} read(s)`,
      async () => {
        expect(await finAfterTheListenerEndedTheSocket(reads)).toEqual({ response: "ok", clientErrors: [] });
      },
    );
  }
});

// Node writes a 1xx response to the socket inside the call that produces it: _writeRaw() calls socket.write().
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L400-L425
// So the client has it whatever the handler does next: close the connection, or block the event loop.
describe("a 1xx response is sent by the call that writes it", () => {
  type Transport = "http" | "https";
  type Callback = (...args: unknown[]) => void;
  type Handler = (req: IncomingMessage, res: ServerResponse, server: Server) => void;
  interface Writer {
    name: string;
    /** The bytes of the 1xx. */
    wire: string;
    request: string;
    event: "request" | "checkContinue";
    /** Absent when the server writes the 1xx itself. */
    write?: (res: ServerResponse, callback?: Callback) => unknown;
  }

  const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
  const keyPath = path.join(keys, "agent1-key.pem");
  const certPath = path.join(keys, "agent1-cert.pem");
  const tlsOptions = { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  // A child process needs more than the default on a debug build.
  const childTimeout = 30_000;

  const hints = { link: "</style.css>; rel=preload; as=style" };
  const plainRequest = "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
  // The body is never sent: the server has read every byte when it closes, so the close is a FIN and not a reset.
  const expectContinueRequest =
    "POST / HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Length: 5\r\nConnection: close\r\n\r\n";
  const continueWire = "HTTP/1.1 100 Continue\r\n\r\n";
  const processingWire = "HTTP/1.1 102 Processing\r\n\r\n";
  const earlyHintsWire = `HTTP/1.1 103 Early Hints\r\nLink: ${hints.link}\r\n\r\n`;

  const writers: Writer[] = [
    {
      name: "writeContinue()",
      wire: continueWire,
      request: plainRequest,
      event: "request",
      write: (res, callback) => res.writeContinue(callback),
    },
    {
      name: "writeProcessing()",
      wire: processingWire,
      request: plainRequest,
      event: "request",
      write: (res, callback) => res.writeProcessing(callback),
    },
    {
      name: "writeEarlyHints()",
      wire: earlyHintsWire,
      request: plainRequest,
      event: "request",
      write: (res, callback) => res.writeEarlyHints(hints, callback),
    },
    {
      name: "writeInformation()",
      wire: "HTTP/1.1 110 unknown\r\nx-a: b\r\n\r\n",
      request: plainRequest,
      event: "request",
      write: (res, callback) => (res as any).writeInformation(110, { "x-a": "b" }, callback),
    },
    {
      name: "_writeRaw()",
      wire: processingWire,
      request: plainRequest,
      event: "request",
      write: (res, callback) => (res as any)._writeRaw(processingWire, "ascii", callback),
    },
    { name: "the automatic 100 Continue", wire: continueWire, request: expectContinueRequest, event: "request" },
    {
      name: "writeContinue() in 'checkContinue'",
      wire: continueWire,
      request: expectContinueRequest,
      event: "checkContinue",
      write: (res, callback) => res.writeContinue(callback),
    },
  ];
  const writersWithCallback = writers.filter(writer => writer.write !== undefined && writer.event === "request");

  // resetAndDestroy() is not here: what a client reads ahead of a reset depends on the OS.
  const closes: [name: string, close: Handler][] = [
    ["req.socket.destroy()", req => void req.socket.destroy()],
    ["res.destroy()", (_req, res) => void res.destroy()],
    ["req.destroy()", req => void req.destroy()],
    ["req.socket.destroy() in a nextTick", req => process.nextTick(() => req.socket.destroy())],
    ["req.socket.destroy() in a microtask", req => queueMicrotask(() => req.socket.destroy())],
    ["server.closeAllConnections()", (_req, _res, server) => server.closeAllConnections()],
  ];

  async function listening(transport: Transport, event: Writer["event"], handler: Handler) {
    const server: Server = transport === "https" ? createHttpsServer(tlsOptions) : createServer();
    server.on(event, (req, res) => handler(req, res, server));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
  }

  /** Sends `request` and resolves with every byte the server sent before the connection closed. */
  async function exchange(transport: Transport, port: number, request: string) {
    const socket =
      transport === "https"
        ? tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false })
        : connect(port, "127.0.0.1");
    const closed = Promise.withResolvers<void>();
    let wire = "";
    socket.setEncoding("latin1");
    socket.on("data", chunk => (wire += chunk));
    // A close without a TLS close_notify reaches the client as an error. The bytes ahead of it are what counts.
    socket.on("error", () => {});
    socket.on("close", () => closed.resolve());
    socket.once(transport === "https" ? "secureConnect" : "connect", () => socket.write(request));
    await closed.promise;
    return wire;
  }

  async function wireOf(transport: Transport, writer: Pick<Writer, "request" | "event">, handler: Handler) {
    const server = await listening(transport, writer.event, handler);
    try {
      return await exchange(transport, (server.address() as AddressInfo).port, writer.request);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  describe.each(["http", "https"] as const)("%s", transport => {
    for (const writer of writers) {
      for (const [name, close] of closes) {
        test.concurrent(`${writer.name}, then ${name}`, async () => {
          const wire = await wireOf(transport, writer, (req, res, server) => {
            writer.write?.(res);
            close(req, res, server);
          });
          expect(wire).toBe(writer.wire);
        });
      }
      const { write } = writer;
      if (write === undefined) continue;
      test.concurrent(`${writer.name}, then req.socket.destroy() in its callback`, async () => {
        const wire = await wireOf(transport, writer, (req, res) => void write(res, () => req.socket.destroy()));
        expect(wire).toBe(writer.wire);
      });
    }

    // On Windows the exit resets the connection, and the reset can discard what the client has not read yet.
    test.skipIf(process.platform === "win32").concurrent(
      "writeEarlyHints(), then process.exit()",
      async () => {
        const fixture = `
          const listener = (req, res) => {
            res.writeEarlyHints(${JSON.stringify(hints)});
            process.exit(0);
          };
          const { readFileSync } = require("node:fs");
          const tlsOptions = { key: readFileSync(${JSON.stringify(keyPath)}), cert: readFileSync(${JSON.stringify(certPath)}) };
          const server = ${JSON.stringify(transport)} === "https"
            ? require("node:https").createServer(tlsOptions, listener)
            : require("node:http").createServer(listener);
          server.listen(0, "127.0.0.1", () => console.log(server.address().port));
        `;
        const child = spawn(process.execPath, ["-e", fixture], {
          env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
          stdio: ["ignore", "pipe", "inherit"],
        });
        try {
          const exited = once(child, "exit");
          let stdout = "";
          child.stdout.setEncoding("utf8");
          for await (const chunk of child.stdout) {
            stdout += chunk;
            if (stdout.includes("\n")) break;
          }
          expect(await exchange(transport, Number(stdout), plainRequest)).toBe(earlyHintsWire);
          expect((await exited)[0]).toBe(0);
        } finally {
          child.kill();
        }
      },
      childTimeout,
    );
  });

  test.concurrent("calls back with null after the call returns, and returns what Node returns", async () => {
    const events: unknown[][] = [];
    const wire = await wireOf("http", { request: plainRequest, event: "request" }, (_req, res) => {
      for (const { name, write } of writersWithCallback) {
        events.push([name, "returned", write!(res, (...args) => events.push([name, "called back", args]))]);
      }
      // _writeRaw() takes the callback in the place of the encoding too.
      const withoutEncoding = "_writeRaw(chunk, callback)";
      const called = (...args: unknown[]) => events.push([withoutEncoding, "called back", args]);
      events.push([withoutEncoding, "returned", (res as any)._writeRaw(processingWire, called)]);
      setImmediate(() => res.end("done"));
    });
    expect(events).toEqual([
      ["writeContinue()", "returned", undefined],
      ["writeProcessing()", "returned", undefined],
      ["writeEarlyHints()", "returned", undefined],
      ["writeInformation()", "returned", true],
      ["_writeRaw()", "returned", true],
      ["_writeRaw(chunk, callback)", "returned", true],
      ["writeContinue()", "called back", [null]],
      ["writeProcessing()", "called back", [null]],
      ["writeEarlyHints()", "called back", [null]],
      ["writeInformation()", "called back", [null]],
      ["_writeRaw()", "called back", [null]],
      ["_writeRaw(chunk, callback)", "called back", [null]],
    ]);
    const all1xx = writersWithCallback.map(writer => writer.wire).join("") + processingWire;
    expect(wire).toStartWith(all1xx + "HTTP/1.1 200 OK\r\n");
    expect(wire).toEndWith("\r\n\r\ndone");
  });

  // Node's _writeRaw() returns false for a destroyed socket. For an ended one it keeps the 1xx in outputData for good.
  test.concurrent.each([
    ["destroyed", (req: IncomingMessage) => void req.socket.destroy(), false],
    ["ended", (req: IncomingMessage) => void req.socket.end(), true],
  ] as const)("a socket that is %s gets no 1xx and no callback", async (_state, close, accepted) => {
    const returned: unknown[] = [];
    let callbacks = 0;
    const wire = await wireOf("http", { request: plainRequest, event: "request" }, (req, res) => {
      close(req);
      for (const { write } of writersWithCallback) returned.push(write!(res, () => void callbacks++));
    });
    expect({ wire, returned, callbacks }).toEqual({
      wire: "",
      returned: [undefined, undefined, undefined, accepted, accepted],
      callbacks: 0,
    });
  });

  test.concurrent("is not held back by a cork that is released before the close", async () => {
    const wire = await wireOf("http", { request: plainRequest, event: "request" }, (req, res) => {
      res.cork();
      res.writeProcessing();
      res.uncork();
      req.socket.destroy();
    });
    expect(wire).toBe(processingWire);
  });

  test.concurrent("writeContinue() of a response that lost the connection writes nothing", async () => {
    let displaced: ServerResponse;
    const firstSeen = Promise.withResolvers<void>();
    const server = await listening("http", "request", (req, res) => {
      if (req.url === "/first") {
        // The socket has no response now, so the next request of this connection gets it.
        (req.socket as any)._httpMessage = null;
        displaced = res;
        firstSeen.resolve();
        return;
      }
      // A turn later the second response has the connection.
      setImmediate(() => {
        displaced.writeContinue();
        res.writeProcessing();
        req.socket.destroy();
      });
    });
    const socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
    try {
      const closed = Promise.withResolvers<void>();
      let wire = "";
      socket.setEncoding("latin1");
      socket.on("data", chunk => (wire += chunk));
      socket.on("error", () => {});
      socket.on("close", () => closed.resolve());
      socket.write("GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await firstSeen.promise;
      socket.write("GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await closed.promise;
      expect(wire).toBe(processingWire);
    } finally {
      socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  // The handler keeps its thread after the 103, as a synchronous render does, until the client has bytes.
  // The client runs on another thread. The wait only times out when the 103 did not leave.
  test("reaches the client before synchronous work that follows it", async () => {
    const clientHasBytes = new Int32Array(new SharedArrayBuffer(4));
    const server = await listening("http", "request", (_req, res) => {
      res.writeEarlyHints(hints);
      res.end(Atomics.wait(clientHasBytes, 0, 0, 10_000) === "timed-out" ? "late" : "early");
    });
    const worker = new Worker(
      `
        const { parentPort, workerData } = require("node:worker_threads");
        const socket = require("node:net").connect(workerData.port, "127.0.0.1", () => socket.write(workerData.request));
        let wire = "";
        socket.setEncoding("latin1");
        socket.on("data", chunk => {
          wire += chunk;
          Atomics.store(workerData.clientHasBytes, 0, 1);
          Atomics.notify(workerData.clientHasBytes, 0);
        });
        socket.on("error", () => {});
        socket.on("close", () => parentPort.postMessage(wire));
      `,
      {
        eval: true,
        workerData: { port: (server.address() as AddressInfo).port, request: plainRequest, clientHasBytes },
      },
    );
    try {
      const [wire] = await once(worker, "message");
      expect(wire).toStartWith(earlyHintsWire + "HTTP/1.1 200 OK\r\n");
      expect(wire).toEndWith("\r\n\r\nearly");
    } finally {
      await worker.terminate();
      server.closeAllConnections();
      server.close();
    }
  }, 30_000);

  // Each send() is one TCP segment on loopback (TCP_NODELAY), and TCP_INFO counts the segments the client got.
  // The 1xx is one send, as in Node. What the handler writes after it in the same turn still shares one send.
  // The client needs bun:ffi for getsockopt().
  test.skipIf(process.platform !== "linux" || !process.versions.bun)(
    "costs one send, and the response after it still goes out in one",
    async () => {
      const fixture = `
        const { dlopen, ptr } = require("bun:ffi");
        const http = require("node:http");
        let libc;
        for (const name of ["libc.so.6", "/usr/lib/libc.so"]) {
          try {
            libc = dlopen(name, { getsockopt: { args: ["int", "int", "int", "ptr", "ptr"], returns: "int" } });
            break;
          } catch {}
        }
        // struct tcp_info: tcpi_data_segs_in is a u32 at byte 152 (linux/tcp.h, since 4.6).
        function dataSegmentsIn(fd) {
          const info = new Uint8Array(280);
          const len = new Uint32Array([info.length]);
          if (libc.symbols.getsockopt(fd, 6 /* IPPROTO_TCP */, 11 /* TCP_INFO */, ptr(info), ptr(len)) !== 0) {
            throw new Error("getsockopt(TCP_INFO) failed");
          }
          if (len[0] < 156) throw new Error("tcp_info has no tcpi_data_segs_in: " + len[0] + " bytes");
          return new DataView(info.buffer).getUint32(152, true);
        }
        const handlers = {
          "/end": res => res.end("done"),
          "/102-end": res => {
            res.writeProcessing();
            res.end("done");
          },
          "/102-writes-end": res => {
            res.writeProcessing();
            res.write("a");
            res.write("b");
            res.write("c");
            res.end("done");
          },
        };
        const server = http.createServer((req, res) => handlers[req.url](res));
        server.listen(0, "127.0.0.1", async () => {
          const segments = {};
          for (const path of Object.keys(handlers)) {
            const done = Promise.withResolvers();
            let reply = "";
            const socket = await Bun.connect({
              hostname: "127.0.0.1",
              port: server.address().port,
              socket: {
                open(socket) {
                  socket.write("GET " + path + " HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n");
                },
                data(socket, chunk) {
                  reply += chunk.toString("latin1");
                  // The end of a body with a Content-Length, or of a chunked one.
                  if (reply.endsWith("\\r\\n\\r\\ndone") || reply.endsWith("\\r\\n0\\r\\n\\r\\n")) done.resolve();
                },
                error(socket, error) {
                  done.reject(error);
                },
                close() {
                  done.resolve();
                },
              },
            });
            await done.promise;
            segments[path] = dataSegmentsIn(socket.fd);
            socket.end();
          }
          server.close();
          console.log(JSON.stringify(segments));
        });
      `;
      const { stdout } = await promisify(execFile)(process.execPath, ["-e", fixture], {
        env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
      });
      expect(JSON.parse(stdout)).toEqual({ "/end": 1, "/102-end": 2, "/102-writes-end": 2 });
    },
    childTimeout,
  );
});
