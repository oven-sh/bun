/**
 * All tests in this file should also run in Node.js.
 */
import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { Agent, createServer, request, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { connect } from "node:net";

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
function chunkedPost(path: string, extraHeaders = "") {
  return (
    `POST ${path} HTTP/1.1\r\nHost: a\r\n${extraHeaders}Transfer-Encoding: chunked\r\n\r\n` +
    `${BODY_HEAD.length.toString(16)}\r\n${BODY_HEAD}\r\n` +
    `${BODY_TAIL.length.toString(16)}\r\n${BODY_TAIL}\r\n` +
    "0\r\n\r\n"
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

async function disconnectAndClose(socket: Socket, server: Server) {
  socket.destroy();
  await once(socket, "close");
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
        // The whole body has been received by now, but only its first chunk
        // fit into the request's buffer. Reading starts on the next tick, so
        // the response ends before the rest of the body has been handed over.
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
    // As above: the whole body has been received by the time this runs, but
    // only its first chunk fit into the request's buffer.
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
