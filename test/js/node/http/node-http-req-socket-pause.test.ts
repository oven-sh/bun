/**
 * All tests in this file should also run in Node.js.
 */
import { describe, expect, it } from "bun:test";
import { once, type EventEmitter } from "node:events";
import { Agent, createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { connect } from "node:net";
import type { Duplex } from "node:stream";

it("req.socket emits 'pause' once an unread request body fills the IncomingMessage buffer", async () => {
  // Node's test-http-no-read-no-dump: a handler that never reads the body sees
  // 'pause' on req.connection once the IncomingMessage push() backpressures.
  const { promise: paused, resolve: onPause, reject } = Promise.withResolvers<number>();
  const server = createServer((req, res) => {
    req.connection!.on("pause", () => {
      onPause((req as any).readableLength);
      res.end("ok");
    });
    res.writeHead(200);
    res.flushHeaders();
  });
  try {
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;
    const post = request({ method: "POST", port });
    post.on("error", reject);
    post.flushHeaders();
    // One body chunk at the default highWaterMark: the first parserOnBody push
    // returns false and Node's readStop pauses the socket.
    post.write(Buffer.alloc(64 * 1024, "X"));
    const buffered = await paused;
    expect(buffered).toBeGreaterThan(0);
    post.destroy();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

it("body reading from 'pause' still delivers every byte and 'end'", async () => {
  // A handler that keys its slow-reader flow off the socket's 'pause' event
  // (the pattern from Node's test-http-no-read-no-dump) must still be able to
  // drain the full body once it attaches a 'data' listener.
  const { promise: done, resolve, reject } = Promise.withResolvers<{ pauses: number; received: number }>();
  const server = createServer((req, res) => {
    let pauses = 0;
    let received = 0;
    req.connection!.on("pause", () => {
      pauses++;
      if (pauses > 1) return;
      req.on("data", chunk => (received += chunk.length));
      req.on("end", () => {
        res.end("ok");
        resolve({ pauses, received });
      });
    });
    res.writeHead(200);
    res.flushHeaders();
  });
  try {
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;
    const payload = 256 * 1024;
    const post = request({ method: "POST", port });
    post.on("error", reject);
    post.flushHeaders();
    await once(post, "response");
    post.end(Buffer.alloc(payload, "X"));
    const { pauses, received } = await done;
    expect(received).toBe(payload);
    expect(pauses).toBeGreaterThanOrEqual(1);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

it("req.socket emits 'pause' on every body-bearing keep-alive request, not just the first", async () => {
  const pauses: string[] = [];
  const sockets: unknown[] = [];
  const ended = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    sockets.push(req.socket);
    req.connection!.once("pause", () => {
      pauses.push(req.url!);
      res.end("ok");
      if (req.url === "/b") ended.resolve();
    });
    res.writeHead(200);
    res.flushHeaders();
  });
  try {
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    for (const path of ["/a", "/b"]) {
      await new Promise<void>((resolve, reject) => {
        const post = request({ method: "POST", port, path, agent }, res => {
          res.resume();
          res.on("end", resolve);
        });
        post.on("error", reject);
        post.end(Buffer.alloc(128 * 1024, "X"));
      });
    }
    await ended.promise;
    agent.destroy();
    expect(sockets.length).toBe(2);
    expect(sockets[0]).toBe(sockets[1]);
    expect(pauses).toEqual(["/a", "/b"]);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// A chunked body whose first chunk alone overflows a 1 KiB highWaterMark: the
// first push() pauses the connection while the parser is still inside this
// segment, so the chunk after it and the terminating chunk are received while
// the request is paused. The whole request is written at once so that it is
// parsed in one go.
const BODY_HEAD = Buffer.alloc(2048, "x").toString();
const BODY_TAIL = "tail";
function chunkedPost(path: string, extraHeaders = "", trailers = "") {
  return (
    `POST ${path} HTTP/1.1\r\nHost: a\r\n${extraHeaders}Transfer-Encoding: chunked\r\n\r\n` +
    `${BODY_HEAD.length.toString(16)}\r\n${BODY_HEAD}\r\n` +
    `${BODY_TAIL.length.toString(16)}\r\n${BODY_TAIL}\r\n` +
    `0\r\n${trailers}\r\n`
  );
}

async function connectTo(server: Server) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  const socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
  socket.setNoDelay(true);
  let received = "";
  const waiting: Array<{ marker: string; resolve: () => void }> = [];
  socket.on("data", chunk => {
    received += chunk;
    for (let i = 0; i < waiting.length; ) {
      if (received.includes(waiting[i].marker)) waiting.splice(i, 1)[0].resolve();
      else i++;
    }
  });
  await once(socket, "connect");
  return {
    socket,
    /** Resolves once the response bytes received so far contain `marker`. */
    receive(marker: string) {
      if (received.includes(marker)) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      waiting.push({ marker, resolve });
      return promise;
    },
  };
}

// One whole exchange on a connection of its own. Once its response is here,
// the server has polled its sockets again, so it has seen (or put off) every
// byte and FIN that was written before this call.
async function roundTrip(server: Server) {
  const socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
  socket.on("error", () => {});
  let response = "";
  socket.on("data", chunk => (response += chunk));
  socket.write("GET /ping HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
  await once(socket, "close");
  expect(response.slice(response.indexOf("\r\n\r\n") + 4)).toBe("pong");
}

async function disconnectAndClose(socket: Socket, server: Server) {
  // The server closes the connection itself after a `Connection: close` request.
  if (!socket.closed) {
    socket.destroy();
    await once(socket, "close");
  }
  // The server's 'close' event waits for every request the server still
  // counts as in flight, so a request that is never released keeps it from
  // ever firing.
  server.close();
  await once(server, "close");
}

describe("request whose whole body arrived while it was paused, answered later on a keep-alive connection", () => {
  // In each test the connection goes on to serve a second request before it is
  // closed, so closing it does not tear down the first request as a side
  // effect: the first request has to be released by its own response ending.
  it("is released once the response ends even though the body is never read", async () => {
    const paused: string[] = [];
    const server = createServer({ highWaterMark: 1024 }, (req, res) => {
      req.socket.once("pause", () => paused.push(req.url!));
      if (req.url === "/unread") {
        // Respond once the segment that carried this request has been parsed
        // to the end of its body (setImmediate runs after the read callback
        // that dispatched it), without ever reading the body.
        setImmediate(() => res.end("alpha"));
      } else {
        res.end("bravo");
      }
    });
    try {
      const client = await connectTo(server);
      client.socket.write(chunkedPost("/unread"));
      await client.receive("alpha");
      client.socket.write("GET /next HTTP/1.1\r\nHost: a\r\n\r\n");
      await client.receive("bravo");
      expect(paused).toEqual(["/unread"]);
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  it("still hands the rest of the body to a reader that starts reading as the response ends", async () => {
    const paused: string[] = [];
    const { promise: body, resolve: gotBody } = Promise.withResolvers<string>();
    const server = createServer({ highWaterMark: 1024 }, (req, res) => {
      req.socket.once("pause", () => paused.push(req.url!));
      if (req.url !== "/read") {
        res.end("bravo");
        return;
      }
      let received = "";
      req.on("end", () => gotBody(received));
      setImmediate(() => {
        // The whole body has been received by now, although its first chunk
        // alone filled the request's buffer. Reading starts on the next tick,
        // so the response ends before the body has been handed over.
        req.on("data", chunk => (received += chunk));
        res.end("alpha");
      });
    });
    try {
      const client = await connectTo(server);
      client.socket.write(chunkedPost("/read"));
      await client.receive("alpha");
      expect(await body).toBe(BODY_HEAD + BODY_TAIL);
      client.socket.write("GET /next HTTP/1.1\r\nHost: a\r\n\r\n");
      await client.receive("bravo");
      expect(paused).toEqual(["/read"]);
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  it("is released once the response ends when the next request was pipelined behind it", async () => {
    const paused: string[] = [];
    const { promise: pipelinedBody, resolve: gotPipelinedBody } = Promise.withResolvers<string>();
    const server = createServer({ highWaterMark: 1024 }, (req, res) => {
      req.socket.once("pause", () => paused.push(req.url!));
      if (req.url === "/unread") {
        setImmediate(() => res.end("alpha"));
        return;
      }
      let received = "";
      req.on("data", chunk => (received += chunk));
      req.on("end", () => {
        gotPipelinedBody(received);
        res.end("bravo");
      });
    });
    try {
      const client = await connectTo(server);
      // The second request (and its body) is in the same segment as the first
      // one, so it is dispatched, and its response queued, while the first
      // response is still pending.
      client.socket.write(
        chunkedPost("/unread") + "POST /pipelined HTTP/1.1\r\nHost: a\r\nContent-Length: 3\r\n\r\nabc",
      );
      await client.receive("alpha");
      await client.receive("bravo");
      expect(await pipelinedBody).toBe("abc");
      expect(paused).toEqual(["/unread"]);
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });
});

it("upgrade request whose whole body arrived while it was paused still hands the whole body to a reader attached later", async () => {
  const { promise: body, resolve: gotBody } = Promise.withResolvers<string>();
  const server = createServer({ highWaterMark: 1024 });
  server.on("upgrade", (req, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n");
    let received = "";
    req.on("end", () => {
      gotBody(received);
      socket.destroy();
    });
    // As above: the whole body has been received by the time this runs,
    // although its first chunk alone filled the request's buffer.
    setImmediate(() => req.on("data", chunk => (received += chunk)));
  });
  try {
    const client = await connectTo(server);
    client.socket.write(chunkedPost("/upgrade", "Upgrade: test\r\nConnection: Upgrade\r\n"));
    await client.receive("101 Switching Protocols");
    expect(await body).toBe(BODY_HEAD + BODY_TAIL);
    await once(client.socket, "close");
    server.close();
    await once(server, "close");
  } finally {
    server.closeAllConnections();
    if (server.listening) server.close();
  }
});

describe("request that its handler pause()d, with a body below the highWaterMark", () => {
  // req.pause() does not stop the connection: Node's parser keeps filling the
  // paused IncomingMessage and only stops reading once push() reports the
  // buffer full. A small body is therefore received to its end while paused.
  const POST_HEAD = "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\n";

  function stateOf(req: IncomingMessage) {
    return { complete: req.complete, readableLength: req.readableLength, readableEnded: req.readableEnded };
  }

  /** Resumes the request and answers with its body once it has ended. */
  function echoOnceResumed(req: IncomingMessage, res: ServerResponse) {
    let received = "";
    req.on("data", chunk => (received += chunk));
    req.on("end", () => res.end(`body=${received};`));
    req.resume();
  }

  it("is complete while paused when the body came with the request head", async () => {
    const { promise: whilePaused, resolve: sampled } = Promise.withResolvers<ReturnType<typeof stateOf>>();
    const server = createServer((req, res) => {
      req.pause();
      // setImmediate runs after the read callback that dispatched the request,
      // which has parsed the rest of the segment by then.
      setImmediate(() => {
        sampled(stateOf(req));
        echoOnceResumed(req, res);
      });
    });
    try {
      const client = await connectTo(server);
      client.socket.write(POST_HEAD + "hello");
      expect(await whilePaused).toEqual({ complete: true, readableLength: 5, readableEnded: false });
      await client.receive("body=hello;");
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  it("is complete while paused when the body came after pause()", async () => {
    const { promise: arrived, resolve: onRequest } = Promise.withResolvers<[IncomingMessage, ServerResponse]>();
    const server = createServer((req, res) => {
      if (req.url === "/ping") return void res.end("pong");
      req.pause();
      onRequest([req, res]);
    });
    try {
      const client = await connectTo(server);
      client.socket.write(POST_HEAD);
      const [req, res] = await arrived;
      client.socket.write("hello");
      // A paused request emits nothing when its body arrives. The body was
      // readable before this second connection existed, so the server has
      // read it by the time the second connection has been answered.
      const ping = connect((server.address() as AddressInfo).port, "127.0.0.1");
      ping.write("GET /ping HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
      ping.resume();
      await once(ping, "close");
      expect(stateOf(req)).toEqual({ complete: true, readableLength: 5, readableEnded: false });
      echoOnceResumed(req, res);
      await client.receive("body=hello;");
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  it("learns that the client disconnected while it is still paused", async () => {
    const { promise: arrived, resolve: onRequest } = Promise.withResolvers<void>();
    const { promise: closed, resolve: onClose } = Promise.withResolvers<object>();
    const server = createServer(req => {
      const events: string[] = [];
      req.pause();
      req.on("aborted", () => events.push("aborted"));
      req.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}`));
      req.on("close", () => onClose({ events, ...stateOf(req) }));
      onRequest();
    });
    try {
      const client = await connectTo(server);
      client.socket.write(POST_HEAD + "hello");
      await arrived;
      client.socket.destroy();
      expect(await closed).toEqual({
        events: ["aborted", "error ECONNRESET"],
        complete: true,
        readableLength: 5,
        readableEnded: false,
      });
      server.close();
      await once(server, "close");
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  it("is aborted when the client half-closes before the response, like a request that is not paused", async () => {
    // The server does not allow half-open connections by default: once it has
    // read the client's FIN, a request without a response is aborted. The
    // connection of a paused request keeps reading, so it is no exception.
    const { promise: closed, resolve: onClose } = Promise.withResolvers<object>();
    const server = createServer(req => {
      const events: string[] = [];
      req.pause();
      req.on("aborted", () => events.push("aborted"));
      req.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}`));
      req.on("close", () => onClose({ events, ...stateOf(req) }));
    });
    try {
      const client = await connectTo(server);
      let response = "";
      client.socket.on("data", chunk => (response += chunk));
      client.socket.on("error", () => {});
      const { promise: clientClosed, resolve: onClientClose } = Promise.withResolvers<void>();
      client.socket.on("close", () => onClientClose());
      client.socket.end(POST_HEAD + "hello");
      expect(await closed).toEqual({
        events: ["aborted", "error ECONNRESET"],
        complete: true,
        readableLength: 5,
        readableEnded: false,
      });
      await clientClosed;
      expect(response).toBe("");
      server.close();
      await once(server, "close");
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });
});

it("reading a request body does not reopen the read gate that queued pipelined responses closed", async () => {
  // Node's readStart() is a no-op while socket._paused, so only the drain of
  // the queued response bytes lets the parser reach the next pipelined request.
  const order: string[] = [];
  const handled = new Map<string, () => void>();
  const seen = (url: string) => new Promise<void>(resolve => handled.set(url, resolve));
  const secondHandled = seen("/2");
  const fourthHandled = seen("/4");
  let first!: [IncomingMessage, ServerResponse];
  const server = createServer((req, res) => {
    if (req.url === "/ping") return void res.end("pong");
    order.push(req.url!);
    handled.get(req.url!)?.();
    if (req.url === "/1") {
      req.pause();
      first = [req, res];
    } else if (req.url === "/2") {
      res.end(Buffer.alloc(1024 * 1024, "y"));
    } else {
      res.end("ok");
    }
  });
  async function ping() {
    const socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
    socket.write("GET /ping HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
    socket.resume();
    await once(socket, "close");
  }
  try {
    const client = await connectTo(server);
    client.socket.write("POST /1 HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello");
    client.socket.write("GET /2 HTTP/1.1\r\nHost: a\r\n\r\n");
    await secondHandled;
    // Separate segments: the parser finishes the chunk that closed the gate.
    client.socket.write("GET /3 HTTP/1.1\r\nHost: a\r\n\r\n");
    await ping();
    client.socket.write("GET /4 HTTP/1.1\r\nHost: a\r\n\r\n");
    await ping();
    const whileGateClosed = [...order];

    const [req, res] = first;
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.resume();
    await once(req, "end");
    await ping();
    expect({ body, order }).toEqual({ body: "hello", order: whileGateClosed });
    expect(order).not.toContain("/4");

    res.end("one");
    await fourthHandled;
    expect(order).toEqual(["/1", "/2", "/3", "/4"]);
    await disconnectAndClose(client.socket, server);
  } finally {
    server.closeAllConnections();
    if (server.listening) server.close();
  }
});

describe("upgrade request whose whole body arrived with its head", () => {
  const upgradeHeaders = "Upgrade: test\r\nConnection: Upgrade\r\n";
  const switchingProtocols = `HTTP/1.1 101 Switching Protocols\r\n${upgradeHeaders}\r\n`;
  const body = Buffer.alloc(100, "y").toString();
  const fixedLengthPost = `POST /upgrade HTTP/1.1\r\nHost: a\r\n${upgradeHeaders}Content-Length: ${body.length}\r\n\r\n${body}`;

  /** Collects what the upgrade socket receives. */
  function tunnelReader() {
    let bytes = "";
    let wake: (() => void) | undefined;
    return {
      onData(chunk: Buffer) {
        bytes += chunk;
        wake?.();
      },
      get bytes() {
        return bytes;
      },
      async receives(expected: string) {
        while (bytes.length < expected.length) {
          const { promise, resolve } = Promise.withResolvers<void>();
          wake = resolve;
          await promise;
        }
      },
    };
  }

  /** `orFail(p)` settles like `p`, or rejects when a watched socket errors or closes first. */
  function failureWatcher() {
    const { promise: failed, reject } = Promise.withResolvers<never>();
    failed.catch(() => {}); // the teardown closes the sockets after the last race
    return {
      watch(what: string, socket: EventEmitter) {
        socket.on("error", reject);
        socket.on("close", () => reject(new Error(`${what} closed`)));
      },
      orFail: <T>(promise: Promise<T>) => Promise.race([promise, failed]),
    };
  }

  it.each([
    { when: "in", readInListener: true },
    { when: "after", readInListener: false },
  ])(
    "a paused request keeps its body when the upgrade socket is read $when the listener",
    async ({ readInListener }) => {
      const tunnel = tunnelReader();
      const { watch, orFail } = failureWatcher();
      const { promise: handedOff, resolve: onUpgrade } = Promise.withResolvers<[IncomingMessage, Duplex]>();
      const server = createServer();
      server.on("upgrade", (req, socket) => {
        req.pause();
        watch("the upgrade socket", socket);
        if (readInListener) socket.on("data", tunnel.onData);
        socket.write(switchingProtocols);
        onUpgrade([req, socket]);
      });
      let client: Awaited<ReturnType<typeof connectTo>> | undefined;
      try {
        client = await connectTo(server);
        watch("the client socket", client.socket);
        client.socket.write(fixedLengthPost);
        const [req, socket] = await orFail(handedOff);
        // The 101 is a round trip: the server has parsed the whole first read.
        await orFail(client.receive("101 Switching Protocols"));
        client.socket.write("ping-1;");
        if (!readInListener) socket.on("data", tunnel.onData);
        // The read of the socket does not resume the request, at once or a turn later.
        expect(req.readableFlowing).toBe(false);
        await orFail(tunnel.receives("ping-1;"));
        expect(req.readableFlowing).toBe(false);

        let received = "";
        req.on("data", chunk => (received += chunk));
        req.resume();
        await orFail(once(req, "end"));
        expect(received).toBe(body);

        client.socket.write("ping-2;");
        await orFail(tunnel.receives("ping-1;ping-2;"));
        expect(tunnel.bytes).toBe("ping-1;ping-2;");
      } finally {
        client?.socket.destroy();
        server.closeAllConnections();
        if (server.listening) server.close();
      }
    },
  );

  it("the upgrade socket gets the bytes after a body that paused the connection", async () => {
    // As above, the first chunk fills the request's buffer, and the end of the body is
    // received while the connection is paused. Node.js v26.3.0 delivers the body, but
    // never reads the socket again.
    const tunnel = tunnelReader();
    const { watch, orFail } = failureWatcher();
    const { promise: handedOff, resolve: onUpgrade } = Promise.withResolvers<[IncomingMessage, Duplex]>();
    const server = createServer({ highWaterMark: 1024 });
    server.on("upgrade", (req, socket) => {
      watch("the upgrade socket", socket);
      socket.write(switchingProtocols);
      onUpgrade([req, socket]);
    });
    let client: Awaited<ReturnType<typeof connectTo>> | undefined;
    try {
      client = await connectTo(server);
      watch("the client socket", client.socket);
      client.socket.write(chunkedPost("/upgrade", upgradeHeaders));
      const [req, socket] = await orFail(handedOff);
      await orFail(client.receive("101 Switching Protocols"));

      let received = "";
      req.on("data", chunk => (received += chunk));
      await orFail(once(req, "end"));
      expect(received).toBe(BODY_HEAD + BODY_TAIL);

      client.socket.write("ping;");
      socket.on("data", tunnel.onData);
      await orFail(tunnel.receives("ping;"));
      expect(tunnel.bytes).toBe("ping;");
    } finally {
      client?.socket.destroy();
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  it("a read of the upgrade socket still resumes a paused request whose body is incomplete", async () => {
    // Like Node.js's UpgradeStream._read: the listener never resumes the request, and the part
    // of the body that came with the head fills its buffer. The socket still gets its bytes.
    const tunnel = tunnelReader();
    const { watch, orFail } = failureWatcher();
    const server = createServer({ highWaterMark: 1024 });
    server.on("upgrade", (req, socket) => {
      req.pause();
      watch("the upgrade socket", socket);
      socket.on("data", tunnel.onData);
      socket.write(switchingProtocols);
    });
    const request = chunkedPost("/upgrade", upgradeHeaders);
    const cut = request.lastIndexOf(`${BODY_TAIL.length.toString(16)}\r\n${BODY_TAIL}`);
    let client: Awaited<ReturnType<typeof connectTo>> | undefined;
    try {
      client = await connectTo(server);
      watch("the client socket", client.socket);
      client.socket.write(request.slice(0, cut));
      await orFail(client.receive("101 Switching Protocols"));
      client.socket.write(request.slice(cut) + "ping;");
      await orFail(tunnel.receives("ping;"));
      expect(tunnel.bytes).toBe("ping;");
    } finally {
      client?.socket.destroy();
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  it("a read of the upgrade socket still resumes a request that is not paused", async () => {
    // Inside the listener req.complete is still false here (Node.js has true), so a listener
    // that waits for the end of the message depends on this resume.
    const { watch, orFail } = failureWatcher();
    const { promise: completeWhenAccepted, resolve: onAccept } = Promise.withResolvers<boolean>();
    const server = createServer();
    server.on("upgrade", (req, socket) => {
      watch("the upgrade socket", socket);
      socket.on("data", () => {});
      const accept = () => {
        socket.write(switchingProtocols);
        onAccept(req.complete);
      };
      if (req.complete) accept();
      else req.once("end", accept);
    });
    let client: Awaited<ReturnType<typeof connectTo>> | undefined;
    try {
      client = await connectTo(server);
      watch("the client socket", client.socket);
      client.socket.write(fixedLengthPost);
      expect(await orFail(completeWhenAccepted)).toBe(true);
      await orFail(client.receive("101 Switching Protocols"));
    } finally {
      client?.socket.destroy();
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });
});

// Node's parserOnBody only stops the socket reads when push() returns false (or
// when user code pauses): the parser still runs to the end of the segment it
// was given. So the rest of the body, and its end, reach the request in the
// same pass, before anything reads it.
describe("request whose whole body is in the segment that paused the connection", () => {
  type Sample = { complete: boolean; readableLength: number; rawTrailers: string[]; body: string };

  // Samples the request once the segment that carried it has been parsed to
  // the end (setImmediate runs after the read callback that dispatched it),
  // then reads the body.
  function sampleThenRead(req: IncomingMessage, done: (sample: Sample) => void) {
    setImmediate(() => {
      const { complete, readableLength, rawTrailers } = req;
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => done({ complete, readableLength, rawTrailers, body }));
      // A 'data' listener alone does not restart a stream that was pause()d.
      req.resume();
    });
  }

  const TRAILERS = "X-Checksum: abc\r\n";
  const whole: Sample = {
    complete: true,
    readableLength: BODY_HEAD.length + BODY_TAIL.length,
    rawTrailers: ["X-Checksum", "abc"],
    body: BODY_HEAD + BODY_TAIL,
  };

  it.each([
    ["an unread body above the highWaterMark", (_req: IncomingMessage) => {}],
    ["req.pause()", (req: IncomingMessage) => void req.pause()],
    ["req.socket.pause()", (req: IncomingMessage) => void req.socket.pause()],
  ])("is complete and fully buffered before it is read, paused by %s", async (_name, pause) => {
    const paused: string[] = [];
    const { promise: sampled, resolve: gotSample } = Promise.withResolvers<Sample>();
    const server = createServer({ highWaterMark: 1024 }, (req, res) => {
      req.socket.on("pause", () => paused.push(req.url!));
      pause(req);
      sampleThenRead(req, sample => {
        gotSample(sample);
        res.end("alpha");
      });
    });
    try {
      const client = await connectTo(server);
      client.socket.write(chunkedPost("/unread", "", TRAILERS));
      expect(await sampled).toEqual(whole);
      expect(paused).toEqual(["/unread"]);
      await client.receive("alpha");
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  it("is complete and fully buffered before it is read, on an upgrade request", async () => {
    const { promise: sampled, resolve: gotSample } = Promise.withResolvers<Sample>();
    const server = createServer({ highWaterMark: 1024 });
    server.on("upgrade", (req, socket) => {
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n");
      sampleThenRead(req, sample => {
        gotSample(sample);
        socket.destroy();
      });
    });
    try {
      const client = await connectTo(server);
      client.socket.write(chunkedPost("/upgrade", "Upgrade: test\r\nConnection: Upgrade\r\n", TRAILERS));
      expect(await sampled).toEqual(whole);
      await once(client.socket, "close");
      server.close();
      await once(server, "close");
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  // The body is already in the request's buffer, so the end of the response
  // cannot take a part of it away from a reader that comes late.
  it.each([
    ["right after the response ends", "", false],
    ["just before the response ends, on a connection the response closes", "Connection: close\r\n", true],
    ["right after the response ends, on a connection the response closes", "Connection: close\r\n", false],
  ])("hands the whole body to a reader attached %s", async (_name, headers, readerFirst) => {
    const { promise: body, resolve: gotBody } = Promise.withResolvers<string>();
    const server = createServer({ highWaterMark: 1024 }, (req, res) => {
      setImmediate(() => {
        let received = "";
        const read = () => {
          req.on("data", chunk => (received += chunk));
          req.on("end", () => gotBody(received));
        };
        if (readerFirst) read();
        res.end("alpha");
        if (!readerFirst) read();
      });
    });
    try {
      const client = await connectTo(server);
      client.socket.write(chunkedPost("/read", headers));
      await client.receive("alpha");
      expect(await body).toBe(BODY_HEAD + BODY_TAIL);
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  // The connection stays paused until the request is read, although the
  // request is complete. What the peer sends next has to wait for the reader.
  function serveWhenReleased(released: Promise<void>, onHeld = () => {}) {
    return createServer({ highWaterMark: 1024 }, (req, res) => {
      if (req.url === "/ping") return void res.end("pong");
      const read = () => {
        let length = 0;
        req.on("data", chunk => (length += chunk.length));
        req.on("end", () => res.end(`${req.url}:${length};`));
      };
      if (req.url !== "/held") return read();
      released.then(read);
      onHeld();
    });
  }

  it("serves a request that streams its body behind it on the same connection", async () => {
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    const { promise: held, resolve: onHeld } = Promise.withResolvers<void>();
    const server = serveWhenReleased(released, onHeld);
    try {
      const client = await connectTo(server);
      client.socket.write(chunkedPost("/held"));
      // The next request must come in a later read than the end of this body.
      await held;
      const half = Buffer.alloc(50_000, "y").toString();
      client.socket.write(`POST /streamed HTTP/1.1\r\nHost: a\r\nContent-Length: ${2 * half.length}\r\n\r\n${half}`);
      await roundTrip(server);
      release();
      await client.receive(`/held:${BODY_HEAD.length + BODY_TAIL.length};`);
      client.socket.write(half);
      await client.receive(`/streamed:${2 * half.length};`);
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  // Node's parserOnMessageComplete: readStart() undoes the readStop() that the
  // last chunk itself caused, so the next request is read while this one is
  // still unread and unanswered.
  it("resumes the connection at once when the last chunk is the one that filled the buffer", async () => {
    const { promise: first, resolve: gotFirst } = Promise.withResolvers<ServerResponse>();
    const { promise: second, resolve: gotSecond } = Promise.withResolvers<void>();
    const paused: string[] = [];
    const server = createServer({ highWaterMark: 1024 }, (req, res) => {
      if (req.url === "/first") {
        req.socket.on("pause", () => paused.push(req.url!));
        return gotFirst(res);
      }
      gotSecond();
      res.end("bravo");
    });
    try {
      const client = await connectTo(server);
      client.socket.write(`POST /first HTTP/1.1\r\nHost: a\r\nContent-Length: ${BODY_HEAD.length}\r\n\r\n${BODY_HEAD}`);
      const res = await first;
      client.socket.write("GET /second HTTP/1.1\r\nHost: a\r\n\r\n");
      await second;
      expect(paused).toEqual(["/first"]);
      res.end("alpha");
      await client.receive("alpha");
      await client.receive("bravo");
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  // A reader in paused mode emits no 'resume' on the request. The connection
  // must still come back once that reader has the whole body.
  it("reads the connection again after a late `for await` reader has consumed the request", async () => {
    const { promise: consumed, resolve: gotBody } = Promise.withResolvers<{ res: ServerResponse; length: number }>();
    const { promise: second, resolve: gotSecond } = Promise.withResolvers<void>();
    const paused: string[] = [];
    let current = "";
    const server = createServer({ highWaterMark: 1024 }, (req, res) => {
      if (current === "") req.socket.on("pause", () => paused.push(current));
      current = req.url!;
      if (req.url === "/first") {
        setImmediate(async () => {
          let length = 0;
          for await (const chunk of req) length += chunk.length;
          gotBody({ res, length });
        });
      } else if (req.url === "/second") {
        gotSecond();
        res.end("bravo");
      } else {
        setImmediate(() => res.end("charlie"));
      }
    });
    try {
      const client = await connectTo(server);
      client.socket.write(chunkedPost("/first"));
      const { res, length } = await consumed;
      expect(length).toBe(BODY_HEAD.length + BODY_TAIL.length);
      // The first request is read but not answered: the next one must be dispatched now.
      client.socket.write("GET /second HTTP/1.1\r\nHost: a\r\n\r\n");
      await second;
      res.end("alpha");
      await client.receive("alpha");
      await client.receive("bravo");
      // The socket's own flow state is back too, so the next body can announce its pause.
      client.socket.write(chunkedPost("/third"));
      await client.receive("charlie");
      expect(paused).toEqual(["/first", "/third"]);
      await disconnectAndClose(client.socket, server);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });
});
