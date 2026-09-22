/**
 * This test must also pass in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
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

// A write() callback whose bytes the connection has not taken yet normally
// runs once the connection drains. When the connection dies first it must
// still run, with an error, before 'close': Node's socket fails every write it
// still holds (Writable errorBuffer) with the error the socket was destroyed
// with, otherwise ERR_STREAM_DESTROYED. This applies to res.write() on a
// response and to socket.write() on the raw socket of a CONNECT tunnel.
describe("write callbacks still held back when the connection dies", () => {
  const CHUNK = Buffer.alloc(4 * 1024 * 1024, "x");
  // How many of these a fresh connection to a peer that never reads takes
  // whole differs per platform (Windows takes the first one), so no test
  // below assumes which write is the first held-back one.
  const MAX_CHUNKS = 16;

  type Target = ServerResponse | Socket;
  type Connection = { res?: ServerResponse; socket: Socket; client: Socket };
  type Teardown = (connection: Connection) => void;
  type Script = (target: Target, connection: Connection, events: string[]) => void | Promise<void>;

  const destroyError = new Error("boom");
  function describeCallbackArgument(err: unknown) {
    if (err == null) return "success";
    if (err === destroyError) return "destroyError";
    return (err as NodeJS.ErrnoException).code;
  }

  // The third column is what Bun hands every held-back callback. Node hands
  // the write that was in flight the transport's error instead: ECANCELED for
  // a local destroy, EPIPE or ECONNRESET when the peer went away.
  const socketTeardowns: [string, Teardown, string][] = [
    ["socket.destroy()", ({ socket }) => socket.destroy(), "ERR_STREAM_DESTROYED"],
    ["socket.destroy(err)", ({ socket }) => socket.destroy(destroyError), "destroyError"],
    ["the client destroying the connection", ({ client }) => client.destroy(), "ERR_STREAM_DESTROYED"],
  ];
  const responseTeardowns: [string, Teardown, string][] = [
    ["res.destroy()", ({ res }) => res!.destroy(), "ERR_STREAM_DESTROYED"],
    ["res.destroy(err)", ({ res }) => res!.destroy(destroyError), "destroyError"],
    ...socketTeardowns,
  ];
  const transportErrorCodes = ["ECANCELED", "EPIPE", "ECONNRESET"];

  // Rewrites `cbN:<received>` to `cbN:failed` when a held-back write may fail
  // with what was received, so one toEqual checks the whole sequence and an
  // unexpected value still shows up verbatim.
  function markFailed(events: string[], expected: string) {
    return events.map(event => {
      const [name, received] = event.split(":");
      return received === expected || transportErrorCodes.includes(received) ? `${name}:failed` : event;
    });
  }

  function writeChunk(target: Target, name: string, events: string[], onSettled?: () => void) {
    target.write(CHUNK, err => {
      events.push(`${name}:${describeCallbackArgument(err)}`);
      onSettled?.();
    });
  }

  // Serves one connection from a client that never reads: a GET whose
  // response is the target, or a CONNECT whose raw socket is the target.
  // `script` runs from inside the listener. Resolves with the events recorded
  // up to the target's 'close' and one macrotask beyond it, so a callback that
  // runs a second time after 'close' shows up as well.
  async function serveToNonReadingClient(kind: "response" | "tunnel", script: Script) {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const scriptDone = Promise.withResolvers<void>();
    let client: Socket | undefined;
    function start(target: Target, connection: Connection) {
      target.on("close", () => {
        events.push("close");
        closed.resolve();
      });
      try {
        scriptDone.resolve(script(target, connection, events));
      } catch (err) {
        scriptDone.reject(err);
      }
    }
    const server = createServer((req, res) => start(res, { res, socket: req.socket, client: client! }));
    server.on("connect", (req, socket) => {
      socket.on("error", () => {});
      start(socket, { socket, client: client! });
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      client = connect(port, "127.0.0.1");
      client.on("error", () => {});
      await once(client, "connect");
      client.pause();
      client.write(
        kind === "response" ? "GET / HTTP/1.1\r\nHost: x\r\n\r\n" : "CONNECT x:443 HTTP/1.1\r\nHost: x:443\r\n\r\n",
      );
      await scriptDone.promise;
      await closed.promise;
      await new Promise(resolve => setImmediate(resolve));
      return events;
    } finally {
      client?.destroy();
      server.close();
    }
  }

  // Writes chunks until one is held back: a chunk the connection took whole
  // has reported success by the next macrotask, a held-back one has not. One
  // more write is queued behind the held-back one and the connection is torn
  // down in the same turn, so exactly those two callbacks are outstanding.
  async function teardownOnceHeldBack(kind: "response" | "tunnel", teardown: Teardown, expected: string) {
    let heldBack = 0;
    const events = await serveToNonReadingClient(kind, async (target, connection, events) => {
      for (let n = 1; ; n++) {
        let settled = false;
        writeChunk(target, `cb${n}`, events, () => (settled = true));
        await new Promise(resolve => setImmediate(resolve));
        if (!settled) {
          heldBack = n;
          break;
        }
        if (n === MAX_CHUNKS) throw new Error(`the connection took ${n} chunks without holding one back`);
      }
      writeChunk(target, `cb${heldBack + 1}`, events);
      events.push("teardown");
      teardown(connection);
    });
    const taken = Array.from({ length: heldBack - 1 }, (_, i) => `cb${i + 1}:success`);
    expect(markFailed(events, expected)).toEqual([
      ...taken,
      "teardown",
      `cb${heldBack}:failed`,
      `cb${heldBack + 1}:failed`,
      "close",
    ]);
  }

  // Torn down before either write could settle. A chunk the connection took
  // whole still reports success and a held-back one fails, but both callbacks
  // run either way, once, and before 'close'.
  async function teardownInsideListener(kind: "response" | "tunnel", teardown: Teardown, expected: string) {
    const events = await serveToNonReadingClient(kind, (target, connection, events) => {
      writeChunk(target, "cb1", events);
      writeChunk(target, "cb2", events);
      events.push("teardown");
      teardown(connection);
    });
    const settled = markFailed(events, expected).map(event => event.replace(/:(success|failed)$/, ":settled"));
    expect(settled).toEqual(["teardown", "cb1:settled", "cb2:settled", "close"]);
  }

  describe("res.write() on a response", () => {
    test.concurrent.each(responseTeardowns)("%s once a write is held back", (_name, teardown, expected) =>
      teardownOnceHeldBack("response", teardown, expected),
    );
    test.concurrent.each(responseTeardowns)("%s inside the request listener", (_name, teardown, expected) =>
      teardownInsideListener("response", teardown, expected),
    );
  });

  describe("socket.write() on a CONNECT tunnel", () => {
    test.concurrent.each(socketTeardowns)("%s once a write is held back", (_name, teardown, expected) =>
      teardownOnceHeldBack("tunnel", teardown, expected),
    );
    test.concurrent.each(socketTeardowns)("%s inside the connect listener", (_name, teardown, expected) =>
      teardownInsideListener("tunnel", teardown, expected),
    );
  });
});
