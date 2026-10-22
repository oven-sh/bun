import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { createServer } from "node:http";
import { Agent as HttpsAgent, createServer as createHttpsServer, get as httpsGet } from "node:https";
import type { AddressInfo } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";

// Node's net.Server#close callback (and the 'close' event) only fires once
// every accepted connection has ended. A connection that was mid-request
// when close() ran stays open after the response is delivered, so the
// callback must be withheld until that connection closes.
test("server.close(cb) does not fire while a keep-alive connection is still open", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url as string);
    if (paths.length === 1) {
      inHandler.resolve();
      releaseResponse = () => res.end("resp:" + req.url);
    } else {
      res.end("resp:" + req.url);
    }
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});

    socket.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\n");
    await inHandler.promise;

    let closeEventFired = false;
    server.once("close", () => (closeEventFired = true));
    const closed = Promise.withResolvers<void>();
    let closeCbFired = false;
    server.close(() => {
      closeCbFired = true;
      closed.resolve();
    });

    // Yield a few event-loop turns after the bytes arrive so the server's
    // "all requests done" task chain has run before the callback is checked.
    releaseResponse();
    while (!body.includes("resp:/first")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);
    expect(closeEventFired).toBe(false);

    socket.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
    while (!body.includes("resp:/second")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);
    expect(closeEventFired).toBe(false);
    expect(paths).toEqual(["/first", "/second"]);

    socket.destroy();
    await closed.promise;
    expect(closeCbFired).toBe(true);
    expect(closeEventFired).toBe(true);
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// https.createServer goes through the same Server class, so the same gate must
// hold for a TLS keep-alive connection driven by a real client agent (the shape
// a browser produces: one connection, a slow response, then another request).
test("https server.close(cb) does not fire while a keep-alive TLS connection is still open", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  const paths: string[] = [];
  const clientPorts: (number | undefined)[] = [];
  const server = createHttpsServer({ key: tlsCert.key, cert: tlsCert.cert }, (req, res) => {
    paths.push(req.url as string);
    clientPorts.push(req.socket.remotePort);
    if (paths.length === 1) {
      inHandler.resolve();
      releaseResponse = () => res.end("first");
    } else {
      res.end("second");
    }
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const agent = new HttpsAgent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false });
  const get = (path: string) =>
    new Promise<number>((resolve, reject) => {
      const req = httpsGet({ port, host: "127.0.0.1", path, agent, rejectUnauthorized: false }, res => {
        res.resume();
        res.on("end", () => resolve(res.statusCode as number));
      });
      req.on("error", reject);
    });

  try {
    const first = get("/first");
    await inHandler.promise;

    let closeCbFired = false;
    const closed = Promise.withResolvers<void>();
    server.close(() => {
      closeCbFired = true;
      closed.resolve();
    });

    releaseResponse();
    expect(await first).toBe(200);
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);

    expect(await get("/second")).toBe(200);
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(paths).toEqual(["/first", "/second"]);
    expect(clientPorts[1]).toBe(clientPorts[0]);
    expect(closeCbFired).toBe(false);

    agent.destroy();
    await closed.promise;
    expect(closeCbFired).toBe(true);
  } finally {
    agent.destroy();
    server.closeAllConnections();
  }
});

// Sanity: an idle keep-alive connection at close() time is reaped by
// closeIdleConnections(), so the callback fires promptly like before.
test("server.close(cb) fires once an idle keep-alive connection is reaped", async () => {
  const server = createServer((req, res) => res.end("ok"));
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    while (!body.includes("ok")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));

    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// nodejs/node 417aacbc365: a connection that has received nothing is idle.
test.each(["http", "https"] as const)(
  "%s server.close(cb) reaps a connection that has sent no request",
  async protocol => {
    const server = protocol === "https" ? createHttpsServer(tlsCert) : createServer();
    server.on("request", () => expect.unreachable());
    const accepted = once(server, protocol === "https" ? "secureConnection" : "connection");
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket =
      protocol === "https"
        ? tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false })
        : connect(port, "127.0.0.1");
    socket.on("error", () => {});
    try {
      const socketClosed = once(socket, "close");
      await accepted;
      const closed = Promise.withResolvers<Error | undefined>();
      server.close(closed.resolve);
      expect(await closed.promise).toBeUndefined();
      await socketClosed;
    } finally {
      socket.destroy();
      server.closeAllConnections();
    }
  },
);

test("closeIdleConnections() leaves a connection that has sent part of a request head", async () => {
  const server = createServer((req, res) => res.end("ok"));
  let accepted = 0;
  const allAccepted = Promise.withResolvers<void>();
  server.on("connection", () => ++accepted === 3 && allAccepted.resolve());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const fresh = connect(port, "127.0.0.1");
  const partial = connect(port, "127.0.0.1");
  const barrier = connect(port, "127.0.0.1");
  for (const socket of [fresh, partial, barrier]) socket.on("error", () => {});
  try {
    const freshClosed = once(fresh, "close");
    // An empty line starts no message. With it, TCP_DEFER_ACCEPT on Linux does not hold the accept back for 1 s.
    fresh.write("\r\n");
    partial.write("GET / HTTP/1.1\r\nHost: x\r\n");
    // The partial head was written first, so the server has read it when it answers this.
    barrier.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    barrier.resume();
    await Promise.all([once(barrier, "close"), allAccepted.promise]);

    server.closeIdleConnections();
    await freshClosed;
    let received = "";
    partial.on("data", chunk => (received += chunk));
    partial.write("Connection: close\r\n\r\n");
    await once(partial, "close");
    expect(received).toEndWith("ok");
  } finally {
    for (const socket of [fresh, partial, barrier]) socket.destroy();
    server.close();
    server.closeAllConnections();
  }
});

test("closeIdleConnections() with emit('connection'): closes a fresh and an idle connection, leaves a partial head", async () => {
  const server = createServer((req, res) => res.end("ok"));
  let accepted = 0;
  const allAccepted = Promise.withResolvers<void>();
  const front = createNetServer(socket => {
    server.emit("connection", socket);
    if (++accepted === 5) allAccepted.resolve();
  });
  // Node tracks connections only from the 'listening' event of the http.Server.
  server.listen(0, "127.0.0.1");
  front.listen(0, "127.0.0.1");
  await Promise.all([once(server, "listening"), once(front, "listening")]);
  const { port } = front.address() as AddressInfo;

  const open = () => {
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let received = "";
    socket.on("data", chunk => (received += chunk));
    return {
      socket,
      closed: once(socket, "close"),
      async responses(count: number) {
        while (received.split("ok").length <= count) await once(socket, "data");
      },
    };
  };
  const request = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
  const [fresh, firstHead, idle, secondHead, barrier] = [open(), open(), open(), open(), open()];
  try {
    await allAccepted.promise;
    idle.socket.write(request);
    secondHead.socket.write(request);
    await Promise.all([idle.responses(1), secondHead.responses(1)]);
    firstHead.socket.write("GET / HTTP/1.1\r\nHo");
    secondHead.socket.write("GET / HTTP/1.1\r\nHo");
    // One round trip on another connection: the server has read both partial heads by then.
    barrier.socket.write(request);
    await barrier.responses(1);

    server.closeIdleConnections();
    await Promise.all([fresh.closed, idle.closed, barrier.closed]);
    firstHead.socket.write("st: x\r\n\r\n");
    secondHead.socket.write("st: x\r\n\r\n");
    await Promise.all([firstHead.responses(1), secondHead.responses(2)]);
  } finally {
    for (const { socket } of [fresh, firstHead, idle, secondHead, barrier]) socket.destroy();
    front.close();
    server.close();
    server.closeAllConnections();
  }
});

test.each([
  ["listen(port)", (server: ReturnType<typeof createServer>, cb: () => void) => server.listen(0, cb)],
  ["listen(options)", (server: ReturnType<typeof createServer>, cb: () => void) => server.listen({ port: 0 }, cb)],
  [
    "listen(path)",
    (server: ReturnType<typeof createServer>, cb: () => void) => server.listen("/nonexistent/x.sock", cb),
  ],
])("%s on a listening server throws ERR_SERVER_ALREADY_LISTEN and changes nothing", async (_name, listenAgain) => {
  const server = createServer((req, res) => res.end("ok"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    let called = false;
    expect(() => listenAgain(server, () => (called = true))).toThrow(
      expect.objectContaining({ code: "ERR_SERVER_ALREADY_LISTEN" }),
    );
    expect({ address: server.address(), listeners: server.listenerCount("listening") }).toEqual({
      address,
      // setupConnectionsTracking, from the constructor.
      listeners: 1,
    });

    const closed = Promise.withResolvers<Error | undefined>();
    server.close(closed.resolve);
    expect(await closed.promise).toBeUndefined();
    expect(called).toBe(false);
    // The port is free again: no second listener is left behind.
    const refused = connect((address as AddressInfo).port, "127.0.0.1");
    expect((await once(refused, "error"))[0].code).toBe("ECONNREFUSED");
  } finally {
    server.close();
  }
});

// Empty lines before a request line start no message (RFC 9112 2.2), so the connection is still idle.
test("server.close(cb) reaps an idle keep-alive connection that sent an empty line", async () => {
  const server = createServer((req, res) => res.end("ok"));
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  async function request(socket: ReturnType<typeof connect>, extra: string) {
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n" + extra + "\r\n");
    while (!body.includes("ok")) await once(socket, "data");
  }

  const socket = connect(port, "127.0.0.1");
  const barrier = connect(port, "127.0.0.1");
  try {
    await request(socket, "");
    socket.write("\r\n");
    // The empty line was written first, so the server has read it when it answers this.
    await request(barrier, "Connection: close\r\n");

    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
  } finally {
    socket.destroy();
    barrier.destroy();
    server.closeAllConnections();
  }
});

// The response ended before the body did (an early 401 or 413). Once the body
// is complete the connection is idle, like in Node.js, and close() reaps it.
test.each(["from the request's 'end' listener", "a turn of the loop later"])(
  "server.close(cb) reaps a keep-alive connection whose request body ended after its response, called %s",
  async when => {
    const bodyEnded = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      req.on("end", () => {
        if (when.startsWith("from")) server.close(() => closed.resolve());
        bodyEnded.resolve();
      });
      req.resume();
      res.end("early");
    });
    // The callback must come from the reap, not from this timer.
    server.keepAliveTimeout = 60000;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      let body = "";
      socket.on("data", chunk => (body += chunk));
      socket.on("error", () => {});
      const socketClosed = once(socket, "close");
      socket.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\n01234");
      while (!body.includes("early")) await once(socket, "data");
      socket.write("56789");
      await bodyEnded.promise;
      if (!when.startsWith("from")) {
        await new Promise<void>(r => setImmediate(r));
        server.close(() => closed.resolve());
      }
      await Promise.all([closed.promise, socketClosed]);
    } finally {
      socket.destroy();
      server.closeAllConnections();
    }
  },
);

// The other half: while the body of such a request still arrives, the
// connection is not idle. Node.js leaves it alone, and the request ends.
test.each([
  ["Content-Length", "in the handler"],
  ["Content-Length", "after the client has the early response"],
  ["chunked", "in the handler"],
  ["chunked", "after the client has the early response"],
])(
  "server.close() does not reap a connection that still receives a %s request body, called %s",
  async (framing, where) => {
    const events: string[] = [];
    let received = 0;
    const settled = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      req.on("data", chunk => (received += chunk.length));
      req.on("end", () => {
        events.push("end");
        settled.resolve();
      });
      req.on("aborted", () => events.push("aborted"));
      req.on("error", (error: NodeJS.ErrnoException) => {
        events.push(`error ${error.code}`);
        settled.resolve();
      });
      res.statusCode = 401;
      res.end("early");
      if (where === "in the handler") server.close(() => closed.resolve());
    });
    server.keepAliveTimeout = 60000;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      let response = "";
      socket.on("data", chunk => (response += chunk));
      socket.on("error", () => {});
      const chunked = framing === "chunked";
      socket.write(
        chunked
          ? "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n01234\r\n"
          : "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\n01234",
      );
      while (!response.includes("early")) await once(socket, "data");
      if (where !== "in the handler") server.close(() => closed.resolve());
      socket.write(chunked ? "5\r\n56789\r\n0\r\n\r\n" : "56789");
      await settled.promise;
      expect({ events, received }).toEqual({ events: ["end"], received: 10 });
      socket.destroy();
      await closed.promise;
    } finally {
      socket.destroy();
      server.closeAllConnections();
    }
  },
);

// The head of the next request has started to arrive. Node.js counts that
// connection as busy, and the request gets its response.
test.each([
  "the body of the first request ends in the read that starts the second head",
  "the first response ends after the second head started",
])("server.close() does not reap a connection that holds a partial request head: %s", async route => {
  const bodyFirst = route.startsWith("the body");
  const firstDispatched = Promise.withResolvers<void>();
  const firstBodyEnded = Promise.withResolvers<void>();
  let endFirst = () => {};
  const server = createServer((req, res) => {
    if (req.url === "/first") {
      req.on("end", () => firstBodyEnded.resolve());
      req.resume();
      if (bodyFirst) res.end("early");
      else endFirst = () => res.end("early");
      firstDispatched.resolve();
      return;
    }
    res.end("second response");
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    let response = "";
    socket.on("data", chunk => (response += chunk));
    socket.on("error", () => {});
    const socketClosed = once(socket, "close");
    const partialHead = "GET /second HTTP/1.1\r\nHo";
    if (bodyFirst) {
      socket.write("POST /first HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\n01234");
      while (!response.includes("early")) await once(socket, "data");
      socket.write("56789" + partialHead);
      await firstBodyEnded.promise;
    } else {
      socket.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\n" + partialHead);
      await firstDispatched.promise;
      await new Promise<void>(r => setImmediate(r));
      endFirst();
      while (!response.includes("early")) await once(socket, "data");
    }
    await new Promise<void>(r => setImmediate(r));
    server.close();
    socket.write("st: x\r\nConnection: close\r\n\r\n");
    await socketClosed;
    expect(response.slice(-"second response".length)).toBe("second response");
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// The handler still runs when it calls close(), so Node.js counts its
// connection as busy. A response that the socket did not take whole must not
// be cut off.
test("server.close() in the handler of a response that still drains does not cut the response off", async () => {
  // More than a loopback socket takes in one write.
  const size = 64 * 1024 * 1024;
  const closed = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    res.end(Buffer.alloc(size, "a"));
    server.close(() => closed.resolve());
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    let received = 0;
    const done = Promise.withResolvers<void>();
    socket.on("data", chunk => {
      received += chunk.length;
      if (received > size) done.resolve();
    });
    socket.on("error", () => {});
    socket.on("close", () => done.resolve());
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await done.promise;
    expect(received).toBeGreaterThan(size);
    socket.destroy();
    await closed.promise;
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// After close() the server has no native handle, and closeIdleConnections()
// asks each connection. A busy one stays, and one that became idle goes.
test("closeIdleConnections() after close() reaps an idle connection, not one that receives a request head", async () => {
  const releases: (() => void)[] = [];
  const server = createServer((req, res) => {
    if (req.url === "/hold") releases.push(() => res.end("held"));
    else res.end("second response");
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const open = async () => {
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let response = "";
    socket.on("data", chunk => (response += chunk));
    await once(socket, "connect");
    return {
      socket,
      closed: once(socket, "close"),
      response: () => response,
      async until(text: string) {
        while (!response.includes(text)) await once(socket, "data");
      },
    };
  };
  const idle = await open();
  const busy = await open();
  try {
    // Both are busy during close(), so both survive it.
    idle.socket.write("GET /hold HTTP/1.1\r\nHost: x\r\n\r\n");
    busy.socket.write("GET /hold HTTP/1.1\r\nHost: x\r\n\r\n");
    while (releases.length < 2) await new Promise<void>(r => setImmediate(r));
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    for (const release of releases) release();
    await Promise.all([idle.until("held"), busy.until("held")]);

    busy.socket.write("GET /second HTTP/1.1\r\nHo");
    // One round trip on the other connection: the server has read the partial head by then.
    idle.socket.write("GET /hold HTTP/1.1\r\nHost: x\r\n\r\n");
    while (releases.length < 3) await new Promise<void>(r => setImmediate(r));
    releases[2]();
    while (idle.response().split("held").length < 3) await once(idle.socket, "data");

    server.closeIdleConnections();
    await idle.closed;
    busy.socket.write("st: x\r\nConnection: close\r\n\r\n");
    await busy.closed;
    expect(busy.response().slice(-"second response".length)).toBe("second response");
    await closed.promise;
  } finally {
    idle.socket.destroy();
    busy.socket.destroy();
    server.closeAllConnections();
  }
});

// A connection whose response has ended is idle while its handler is still on
// the stack. How many reads its request head took makes no difference.
test.each([
  ["one read", "GET /sweep HTTP/1.1\r\nHost: x\r\n\r\n", ""],
  ["two reads", "GET /sweep HTTP/1.1\r\nHo", "st: x\r\n\r\n"],
])(
  "closeIdleConnections() from process.nextTick in the handler closes a connection whose request head took %s",
  async (_name, first, rest) => {
    const server = createServer((req, res) => {
      res.end(req.url);
      if (req.url === "/sweep") process.nextTick(() => server.closeIdleConnections());
    });
    server.keepAliveTimeout = 60000;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.on("error", () => {});
      let response = "";
      const swept = Promise.withResolvers<void>();
      const outcome = Promise.withResolvers<string>();
      socket.on("data", chunk => {
        response += chunk;
        if (response.endsWith("/sweep")) swept.resolve();
        if (response.endsWith("/second")) outcome.resolve("kept");
      });
      // Also after an 'error': a request to a connection that the server closed can get a reset.
      socket.on("close", () => outcome.resolve("closed"));

      socket.write(first);
      if (rest) {
        // One round trip on another connection: the server has read the partial head by then.
        const barrier = connect(port, "127.0.0.1");
        barrier.resume();
        barrier.end("GET /barrier HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        await once(barrier, "close");
        socket.write(rest);
      }
      await swept.promise;
      // A connection that is still open answers this.
      socket.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
      expect(await outcome.promise).toBe("closed");
    } finally {
      socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  },
);

// The bytes of the first response still drain when one read brings the next
// request. That request waits behind the unsent bytes, so the connection is
// not idle, also when the same read completed the body of the first request.
test.each([
  ["whose request body ended after it", "POST /first HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\n01234", "56789"],
  ["that its handler ended in the same read", "", "GET /first HTTP/1.1\r\nHost: x\r\n\r\n"],
])(
  "server.close() from a request queued behind a draining response %s reaps neither",
  async (_name, firstWrite, restOfFirst) => {
    // More than a loopback socket takes in one write.
    const size = 64 * 1024 * 1024;
    const firstDispatched = Promise.withResolvers<void>();
    const secondDispatched = Promise.withResolvers<boolean>();
    const closed = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      if (req.url === "/first") {
        req.resume();
        res.end(Buffer.alloc(size, "a"));
        firstDispatched.resolve();
        return;
      }
      // A queued response has no socket yet.
      const queued = res.socket === null;
      server.close(() => closed.resolve());
      res.end("second response");
      secondDispatched.resolve(queued);
    });
    server.keepAliveTimeout = 60000;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.pause();
      socket.on("error", () => {});
      if (firstWrite) {
        socket.write(firstWrite);
        await firstDispatched.promise;
      }
      socket.write(restOfFirst + "GET /second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      // Winsock can take the whole first response in one send(). Nothing drains then, and the second request is not queued.
      const queued = await secondDispatched.promise;
      if (!isWindows) expect(queued).toBe(true);

      let received = 0;
      let tail = "";
      socket.on("data", chunk => {
        received += chunk.length;
        tail = (tail + chunk.toString("latin1")).slice(-"second response".length);
      });
      const socketClosed = once(socket, "close");
      socket.resume();
      await Promise.all([closed.promise, socketClosed]);
      expect({ all: received > size, tail }).toEqual({ all: true, tail: "second response" });
    } finally {
      socket.destroy();
      server.closeAllConnections();
    }
  },
);

// The graceful-drain-with-deadline pattern: close(), then force via
// closeAllConnections() once the caller has waited long enough. The force
// step must work even though close() already dropped the native handle.
test("closeAllConnections() after close() force-drains the withheld callback", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  const server = createServer((req, res) => {
    inHandler.resolve();
    releaseResponse = () => res.end("ok");
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await inHandler.promise;

    const closed = Promise.withResolvers<void>();
    let closeCbFired = false;
    server.close(() => {
      closeCbFired = true;
      closed.resolve();
    });
    releaseResponse();
    while (!body.includes("ok")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);

    server.closeAllConnections();
    await closed.promise;
    expect(closeCbFired).toBe(true);
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// The request waits for a body that cannot come any more. Like in Node, that and the half-open socket do not hold the process.
test("an upgraded socket whose request body never ended does not hold the process after the client's FIN", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const http = require("node:http"), net = require("node:net");
       const server = http.createServer();
       server.on("upgrade", (req, socket) => {
         socket.on("error", () => {});
         socket.on("end", () => {
           console.log("end");
           server.closeAllConnections();
           server.close();
         });
         client.end();
       });
       let client;
       server.listen(0, "127.0.0.1", () => {
         client = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true });
         client.unref();
         client.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nConnection: Upgrade\\r\\nUpgrade: x\\r\\nContent-Length: 100\\r\\n\\r\\n0123456789");
       });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "end\n", stderr: "" });
  expect(exitCode).toBe(0);
});

test("closeAllConnections() on a listening server destroys the connections and keeps the listener", async () => {
  const events: string[] = [];
  const server = createServer((req, res) => res.end("ok"));
  server.on("close", () => events.push("server close"));
  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
    socket.on("data", chunk => socket.write("echo " + chunk));
    socket.on("end", () => socket.end());
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  // Rejects when the server closes the connection first, so that a wrong close is not a timeout.
  async function nextData(socket: ReturnType<typeof connect>) {
    const closed = Promise.withResolvers<never>();
    const onClose = () => closed.reject(new Error("the server closed the connection"));
    socket.once("close", onClose);
    try {
      return String((await Promise.race([once(socket, "data"), closed.promise]))[0]);
    } finally {
      socket.off("close", onClose);
    }
  }
  async function open(head: string, until: string) {
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    socket.write(head);
    for (let received = ""; !received.includes(until);) received += await nextData(socket);
    return socket;
  }

  const get = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
  const keepAlive = await open(get, "ok");
  const upgraded = await open("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n", "\r\n\r\n");
  try {
    const keepAliveClosed = once(keepAlive, "close");
    server.closeAllConnections();
    await keepAliveClosed;
    expect({ listening: server.listening, port: (server.address() as AddressInfo | null)?.port }).toEqual({
      listening: true,
      port,
    });

    upgraded.write("ping");
    expect(await nextData(upgraded)).toBe("echo ping");
    (await open(get, "ok")).destroy();
    expect(events).toEqual([]);

    upgraded.destroy();
    const closed = Promise.withResolvers<Error | undefined>();
    server.close(closed.resolve);
    expect(await closed.promise).toBeUndefined();
    expect(events).toEqual(["server close"]);
  } finally {
    keepAlive.destroy();
    upgraded.destroy();
    server.closeAllConnections();
    if (server.listening) server.close();
  }
});

// Node frees the parser when it hands a socket to 'upgrade'/'connect', which
// takes it off the list closeIdleConnections()/closeAllConnections() walk. After
// close() those two must reap a plain keep-alive socket but leave an upgraded
// one alone, while 'close' itself still waits for the upgraded socket to end.
test("closeIdleConnections()/closeAllConnections() after close() leave an upgraded socket open", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  let upgradedServerSocket!: import("node:net").Socket;
  const server = createServer((req, res) => {
    inHandler.resolve();
    releaseResponse = () => res.end("ok");
  });
  server.on("upgrade", (req, socket) => {
    upgradedServerSocket = socket as import("node:net").Socket;
    socket.on("error", () => {});
    socket.on("data", chunk => socket.write(chunk));
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const upgraded = connect(port, "127.0.0.1");
  const plain = connect(port, "127.0.0.1");
  try {
    await Promise.all([once(upgraded, "connect"), once(plain, "connect")]);
    upgraded.on("error", () => {});
    plain.on("error", () => {});
    let upgradedData = "";
    upgraded.on("data", chunk => (upgradedData += chunk));
    const upgradedClosed = Promise.withResolvers<void>();
    upgraded.on("close", () => upgradedClosed.resolve());
    let plainData = "";
    plain.on("data", chunk => (plainData += chunk));
    const plainClosed = Promise.withResolvers<void>();
    plain.on("close", () => plainClosed.resolve());
    // Round-trips a token through the upgraded connection; false if it closed instead.
    const echo = async (token: string) => {
      upgraded.write(token);
      while (!upgradedData.includes(token) && !upgraded.destroyed) {
        await Promise.race([once(upgraded, "data"), upgradedClosed.promise]);
      }
      return upgradedData.includes(token);
    };

    upgraded.write("GET /up HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
    while (!upgradedData.includes("101 Switching Protocols")) await once(upgraded, "data");
    plain.write("GET /slow HTTP/1.1\r\nHost: x\r\n\r\n");
    await inHandler.promise;

    let closeCbFired = false;
    const closed = Promise.withResolvers<void>();
    server.close(() => {
      closeCbFired = true;
      closed.resolve();
    });
    releaseResponse();
    while (!plainData.includes("ok")) await once(plain, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);

    server.closeIdleConnections();
    expect(upgradedServerSocket.destroyed).toBe(false);
    await plainClosed.promise;
    expect(await echo("ping1")).toBe(true);
    expect(closeCbFired).toBe(false);

    server.closeAllConnections();
    expect(upgradedServerSocket.destroyed).toBe(false);
    expect(await echo("ping2")).toBe(true);
    expect(closeCbFired).toBe(false);

    upgradedServerSocket.destroy();
    await closed.promise;
    expect(closeCbFired).toBe(true);
  } finally {
    upgraded.destroy();
    plain.destroy();
    server.closeAllConnections();
  }
});

// Re-listening after close() while a keep-alive connection from the previous
// cycle is still open must not fire 'close' on the new (listening) server
// when that old connection finally ends.
test("no 'close' is emitted on a re-listened server when an earlier connection ends", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  let requests = 0;
  const server = createServer((req, res) => {
    if (++requests === 1) {
      inHandler.resolve();
      releaseResponse = () => res.end("ok");
    } else {
      res.end("ok");
    }
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port1 = (server.address() as AddressInfo).port;

  const socket = connect(port1, "127.0.0.1");
  try {
    await once(socket, "connect");
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await inHandler.promise;

    let cb1Fired = false;
    server.close(() => (cb1Fired = true));
    releaseResponse();
    while (!body.includes("ok")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    let closeEmitted = 0;
    server.on("close", () => closeEmitted++);

    socket.destroy();
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeEmitted).toBe(0);
    expect(cb1Fired).toBe(false);
    expect(server.listening).toBe(true);

    // Like Node, the first cycle's callback is a once('close') listener: it
    // fires here too, and passing a second callback does not throw.
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
    expect(closeEmitted).toBe(1);
    expect(cb1Fired).toBe(true);
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// A reload under --hot keeps the native listener of an address, and so its kind.
test("closeAllConnections() on a server that took the listener of a Bun.serve server under --hot", async () => {
  using dir = tempDir("hot-bun-serve-to-node-http", {
    "server.mjs": `
      import { createServer } from "node:http";
      import { once } from "node:events";
      import { connect } from "node:net";
      import { writeFileSync, readFileSync } from "node:fs";

      globalThis.__reloads ??= 0;
      if (globalThis.__reloads++ === 0) {
        Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("Bun.serve") });
        const self = new URL(import.meta.url);
        writeFileSync(self, readFileSync(self, "utf8"));
      } else {
        let connections = 0;
        const server = createServer((req, res) => res.end("node:http"));
        server.on("connection", () => connections++);
        await once(server.listen(0, "127.0.0.1"), "listening");
        const socket = connect(server.address().port, "127.0.0.1");
        socket.on("error", () => {});
        socket.resume();
        await once(socket, "connect");
        socket.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
        await once(socket, "close");
        server.closeAllConnections();
        console.log(connections);
        process.exit(0);
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "server.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("0\n");
  expect(exitCode).toBe(0);
});

// close() registers the reaction that emits 'close'. The event keeps the async context of listen(), whoever calls
// close(). Node runs 'close' in the context of close(), and net.Server does so here too. That difference is older than
// this test: https://github.com/oven-sh/bun/pull/33719
test("'close' and the close() callback see the AsyncLocalStorage store of listen()", async () => {
  const storage = new AsyncLocalStorage<string>();
  const server = createServer();
  const seen: unknown[] = [];
  server.on("close", () => seen.push(storage.getStore()));
  storage.run("listen", () => server.listen(0, "127.0.0.1"));
  await once(server, "listening");
  await new Promise<void>(resolve =>
    storage.run("close", () =>
      server.close(() => {
        seen.push(storage.getStore());
        resolve();
      }),
    ),
  );
  expect(seen).toEqual(["listen", "listen"]);
});

describe("the server of a Bun.ModuleGraph that the host closes", () => {
  async function listenInGraph() {
    const dir = tempDir("node-http-graph", {
      "listens.mjs": `
        import { createServer } from "node:http";
        export const closedIn = [];
        export function listen() {
          const server = createServer().on("close", () => closedIn.push(Bun.ModuleGraph.current));
          return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
        }
      `,
    });
    const graph = new Bun.ModuleGraph();
    const app = await graph.import(join(String(dir), "listens.mjs"));
    const server = await graph.run(() => app.listen());
    return {
      graph,
      app,
      server,
      [Symbol.dispose]() {
        graph.dispose();
        dir[Symbol.dispose]();
      },
    };
  }

  test("tells the 'close' listener of the graph in the context of the graph", async () => {
    using listening = await listenInGraph();
    const { graph, app, server } = listening;
    server.close();
    await once(server, "close");
    expect(app.closedIn.map(current => current === graph)).toEqual([true]);
  });

  test("emits no 'close' once the graph is disposed", async () => {
    using listening = await listenInGraph();
    const { graph, app, server } = listening;
    graph.dispose();
    let calledBack = false;
    server.close(() => (calledBack = true));
    // A server of the host, closed after it, has emitted 'close': the server of the graph would have too.
    const hostServer = createServer().listen(0, "127.0.0.1");
    await once(hostServer, "listening");
    hostServer.close();
    await once(hostServer, "close");
    expect({ calledBack, inTheGraph: app.closedIn.length }).toEqual({ calledBack: false, inTheGraph: 0 });
  });
});

// `bun --hot` evaluates the entry point again, and Bun.serve() answers a listen() on an address that a native server
// already serves with that server. The native server then calls the new http.Server only. The earlier one keeps its
// handle and its connections, so its close() still stops the listener. Nothing else keeps it alive: not a
// connections-checking interval with no connection to check, not a reaction for its 'close' event.
// A second listen() on the address in the same load gets the native server too, so only the first test needs a reload.
// One at a time: a debug build needs two seconds to start one fixture, and twice that next to three others.
describe("bun --hot gives the native server of an http.Server to the next one", () => {
  // The fixture ends the process itself.
  async function runHot(fixture: string, env = bunEnv) {
    using dir = tempDir("node-http-hot", { "server.mjs": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "server.mjs"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout: stdout
        .trim()
        .split("\n")
        .map(line => JSON.parse(line)),
      stderr: stderr.replaceAll(/^DEBUG:.*\n/gm, ""),
      exitCode,
    };
  }

  // For a WeakRef whose target nothing else holds.
  const collected = `
    async function collected(ref) {
      const deadline = performance.now() + 1000;
      while (ref.deref() !== undefined && performance.now() < deadline) {
        await new Promise(resolve => setImmediate(resolve));
        Bun.gc(true);
      }
      return ref.deref() === undefined;
    }
  `;
  test.each([
    ["http", bunEnv, "{}"],
    // NODE_ENV=production: the native server class without the development mode.
    ["https", { ...bunEnv, NODE_ENV: "production" }, JSON.stringify({ key: tlsCert.key, cert: tlsCert.cert })],
  ] as const)("each earlier %s server is collected, and emits no 'close'", async (protocol, env, options) => {
    const fixture = `
      import { AsyncLocalStorage } from "node:async_hooks";
      import { once } from "node:events";
      import { readFileSync, writeFileSync } from "node:fs";
      import { createServer } from "node:${protocol}";

      const load = (globalThis.loads = (globalThis.loads ?? 0) + 1);
      const state = (globalThis.state ??= { plain: [], store: [], closes: 0 });
      // It outlives every load.
      const storage = (globalThis.storage ??= new AsyncLocalStorage());

      function serve(kind, listen) {
        const server = createServer(${options}, (req, res) => res.end("ok"));
        server.on("close", () => state.closes++);
        state[kind].push(new WeakRef(server));
        listen(server);
        return once(server, "listening");
      }
      await Promise.all([
        serve("plain", server => server.listen(0, "127.0.0.1")),
        serve("store", server => storage.run({ server }, () => server.listen(0))),
      ]);

      if (load < 3) {
        // The write starts the next load.
        const self = new URL(import.meta.url);
        writeFileSync(self, readFileSync(self, "utf8"));
      } else {
        // Only the servers of this load are in use.
        const alive = {};
        for (let i = 0; i < 10; i++) {
          Bun.gc(true);
          for (const kind of ["plain", "store"]) {
            alive[kind] = state[kind].filter(ref => ref.deref() !== undefined).length;
          }
          if (alive.plain === 1 && alive.store === 1) break;
          await new Promise(resolve => setImmediate(resolve));
        }
        console.log(JSON.stringify({ alive, closes: state.closes }));
        process.exit(0);
      }
    `;
    const { stdout, stderr, exitCode } = await runHot(fixture, env);
    expect({ stdout, stderr }).toEqual({ stdout: [{ alive: { plain: 1, store: 1 }, closes: 0 }], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // One load can ask for one address twice, with port 0 for example. Both servers get the same native server.
  test("two servers of one load on one address: both get 'listening', the first one is collected", async () => {
    const fixture = `
      import { once } from "node:events";
      import { createServer } from "node:http";
      ${collected}

      // A function, so that no variable of this module holds the first server.
      async function listenTwice() {
        const heard = [];
        const first = createServer().once("listening", () => heard.push("first"));
        const second = createServer().once("listening", () => heard.push("second"));
        first.listen(0, "127.0.0.1");
        second.listen(0, "127.0.0.1");
        await once(second, "listening");
        return { heard, first: new WeakRef(first) };
      }
      const { heard, first } = await listenTwice();
      console.log(JSON.stringify({ listening: heard, firstCollected: await collected(first) }));
      process.exit(0);
    `;
    const { stdout, stderr, exitCode } = await runHot(fixture);
    expect({ stdout, stderr }).toEqual({
      stdout: [{ listening: ["first", "second"], firstCollected: true }],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // What the fixtures below share: a server that answers with its name and leaves the response of "/slow" in flight,
  // and raw clients.
  const connections = `
    let slow;
    function serve(name, options = {}) {
      return createServer(options, (req, res) => {
        if (req.url === "/slow") (slow = res).write("partial");
        else res.end(name);
      });
    }
    function open(port) {
      const client = { socket: connect(port, "127.0.0.1").setEncoding("latin1"), received: "", closed: false };
      client.socket.on("data", chunk => (client.received += chunk));
      client.socket.on("close", () => (client.closed = true));
      client.socket.on("error", () => {});
      return client;
    }
    // Whether the client has received \`text\`. Waits for it until the connection closes.
    async function received(client, text) {
      while (!client.received.includes(text) && !client.closed) {
        await Promise.race([once(client.socket, "data"), once(client.socket, "close")]);
      }
      return client.received.includes(text);
    }
    const get = path => "GET " + path + " HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n";
    const count = server => new Promise(resolve => server.getConnections((error, count) => resolve(count)));
    // The error code of a connection to a port that nothing listens on.
    const refused = port =>
      new Promise(resolve => {
        const socket = connect(port, "127.0.0.1");
        socket.on("error", error => resolve(error.code));
        socket.on("connect", () => resolve("connected"));
      });
    // Whether the interval that checks the connections of the server is cleared, with a wait for that until a deadline.
    // A WeakRef of the server cannot show it: the last call of the interval leaves its \`this\`, the server, in a stack word.
    async function checkStopped(server) {
      const deadline = performance.now() + 1000;
      while (!server[kConnectionsCheckingInterval]._destroyed && performance.now() < deadline) {
        await new Promise(resolve => setImmediate(resolve));
      }
      return server[kConnectionsCheckingInterval]._destroyed;
    }
  `;

  test("a connection of the first server stays with it, and the first server checks it until it closes", async () => {
    const fixture = `
      import { kConnectionsCheckingInterval } from "node:_http_server";
      import { once } from "node:events";
      import { createServer } from "node:http";
      import { connect } from "node:net";
      ${connections}

      const first = serve("first", { connectionsCheckingInterval: 5, headersTimeout: 50 });
      await once(first.listen(0, "127.0.0.1"), "listening");
      // The response is in flight when the second server listens.
      const client = open(first.address().port);
      client.socket.write(get("/slow"));
      await received(client, "partial");
      const second = serve("second");
      await once(second.listen(0, "127.0.0.1"), "listening");

      const result = { connections: [await count(first), await count(second)] };
      slow.end();
      // The native server calls the second server for the next request on the connection.
      client.socket.write(get("/"));
      result.nextRequest = (await received(client, "second")) && "second";
      // The first server still checks its connection: a request head that does not end gets the timeout.
      client.socket.write("GET /partial HTTP/1.1\\r\\nHost: localhost\\r\\n");
      result.timeout = (await received(client, "HTTP/1.1 408")) && "408";
      if (!client.closed) await once(client.socket, "close");
      result.checkStopped = await checkStopped(first);
      console.log(JSON.stringify(result));
      process.exit(0);
    `;
    const { stdout, stderr, exitCode } = await runHot(fixture);
    expect({ stdout, stderr }).toEqual({
      stdout: [{ connections: [1, 0], nextRequest: "second", timeout: "408", checkStopped: true }],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // The first server keeps its handle, as a shutdown hook of an earlier load does.
  test("close() of the first server still stops the listener, and the second server stops its check", async () => {
    const fixture = `
      import { kConnectionsCheckingInterval } from "node:_http_server";
      import { once } from "node:events";
      import { createServer } from "node:http";
      import { connect } from "node:net";
      ${connections}

      const first = serve("first");
      await once(first.listen(0, "127.0.0.1"), "listening");
      const { port } = first.address();
      const second = serve("second", { connectionsCheckingInterval: 5 });
      await once(second.listen(0, "127.0.0.1"), "listening");

      const result = { listening: first.listening };
      result.firstClose = await new Promise(resolve => first.close(error => resolve(error?.code ?? "closed")));
      result.connect = await refused(port);
      // The second server has no listener now. It learns that at its next check of the connections.
      result.checkStopped = await checkStopped(second);
      console.log(JSON.stringify(result));
      process.exit(0);
    `;
    const { stdout, stderr, exitCode } = await runHot(fixture);
    expect({ stdout, stderr }).toEqual({
      stdout: [{ listening: true, firstClose: "closed", connect: "ECONNREFUSED", checkStopped: true }],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});
