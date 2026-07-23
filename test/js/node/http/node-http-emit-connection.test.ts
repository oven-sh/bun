// https://github.com/oven-sh/bun/issues/35281
// http.Server must adopt external sockets fed in via server.emit('connection',
// socket): Node attaches an HTTPParser to any duplex passed through the
// 'connection' event, so user code can terminate TLS elsewhere (or bridge any
// stream) and still get 'request' events.
import { expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

// Accumulates client data and lets tests await the arrival of a substring.
// Terminal socket events reject pending waiters so a regression fails with
// the bytes received so far instead of an opaque test timeout.
function collect(client: net.Socket) {
  let buf = "";
  let failure: Error | undefined;
  const waiters: { needle: string; resolve: (buf: string) => void; reject: (err: Error) => void }[] = [];
  client.on("data", d => {
    buf += d.toString("latin1");
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (buf.includes(waiters[i].needle)) {
        waiters.splice(i, 1)[0].resolve(buf);
      }
    }
  });
  const fail = (why: string) => {
    failure ??= new Error(`${why} before needle arrived; received so far: ${JSON.stringify(buf)}`);
    while (waiters.length) waiters.shift()!.reject(failure);
  };
  client.on("error", err => fail(`socket error (${err.message})`));
  client.on("close", () => fail("socket closed"));
  return {
    get buf() {
      return buf;
    },
    until(needle: string): Promise<string> {
      if (buf.includes(needle)) return Promise.resolve(buf);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => waiters.push({ needle, resolve, reject }));
    },
  };
}

// Raw TCP server that forwards every accepted socket into the http.Server via
// emit('connection'), plus a connected client.
async function setup(handler?: http.RequestListener) {
  const httpServer = http.createServer(handler);
  const raw = net.createServer(sock => httpServer.emit("connection", sock));
  await new Promise<void>((resolve, reject) => {
    raw.once("error", reject);
    raw.listen(0, "127.0.0.1", resolve);
  });
  const port = (raw.address() as net.AddressInfo).port;
  const client = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  return {
    httpServer,
    raw,
    client,
    reader: collect(client),
    [Symbol.dispose]() {
      client.destroy();
      raw.close();
      httpServer.closeAllConnections?.();
    },
  };
}

test.concurrent("dispatches 'request' for sockets emitted via emit('connection')", async () => {
  using ctx = await setup((req, res) => res.end("hello " + req.url));
  ctx.client.write("GET /emit-test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  const buf = await ctx.reader.until("hello /emit-test");
  expect(buf).toContain("HTTP/1.1 200 OK");
});

test.concurrent("keep-alive serves sequential requests on one adopted socket", async () => {
  using ctx = await setup((req, res) => res.end("r:" + req.url));
  ctx.client.write("GET /a HTTP/1.1\r\nHost: x\r\n\r\n");
  const first = await ctx.reader.until("r:/a");
  expect(first).toContain("Connection: keep-alive");
  ctx.client.write("GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  const second = await ctx.reader.until("r:/b");
  expect(second).toContain("Connection: close");
});

test.concurrent("request body flows through the adopted socket", async () => {
  using ctx = await setup(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.end("body=" + body);
  });
  ctx.client.write("POST /p HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello");
  await ctx.reader.until("body=hello");
});

test.concurrent("chunked response when no content-length is known", async () => {
  using ctx = await setup((req, res) => {
    res.writeHead(200, { "X-Test": "1" });
    res.write("part1");
    res.end("part2");
  });
  ctx.client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  const buf = await ctx.reader.until("part2");
  expect(buf).toContain("Transfer-Encoding: chunked");
  expect(buf).toContain("X-Test: 1");
});

test.concurrent("auto 400 on a pipelined request queued behind an in-flight response", async () => {
  // The second request arrives while the first response is still in flight,
  // so its response is queued without a socket; the requireHostHeader 400
  // must still reach the wire once the socket is assigned.
  using ctx = await setup(async (req, res) => {
    await new Promise(r => setImmediate(r));
    res.end("ok:" + req.url);
  });
  ctx.client.write("GET /a HTTP/1.1\r\nHost: x\r\n\r\n" + "GET /b HTTP/1.1\r\n\r\n");
  const buf = await ctx.reader.until("400 Bad Request");
  expect(buf).toContain("ok:/a");
});

test.concurrent("queued pipelined response with Content-Length and write() before end()", async () => {
  // The /b handler runs while its response is still queued behind /a's: with
  // an explicit Content-Length and the body written before end(), 'finish'
  // must wait until the response is assigned the socket and flushed.
  let queuedWritableFinished: boolean | undefined;
  let queuedSocket: unknown = "unset";
  using ctx = await setup(async (req, res) => {
    if (req.url === "/a") await new Promise(r => setImmediate(r));
    // A queued response has no socket until assignSocket(), like Node.
    if (req.url === "/b") queuedSocket = res.socket;
    res.writeHead(200, { "Content-Length": "5" });
    res.write("ok:" + req.url);
    res.end();
    // The queued response still has its bytes in outputData, so it has not
    // finished writing (like Node's OutgoingMessage accounting).
    if (req.url === "/b") queuedWritableFinished = res.writableFinished;
  });
  ctx.client.write("GET /a HTTP/1.1\r\nHost: x\r\n\r\n" + "GET /b HTTP/1.1\r\nHost: x\r\n\r\n");
  const buf = await ctx.reader.until("ok:/b");
  expect(buf.indexOf("ok:/a")).toBeLessThan(buf.indexOf("ok:/b"));
  expect(queuedWritableFinished).toBe(false);
  expect(queuedSocket).toBe(null);
});

test.concurrent("writableNeedDrain and 'drain' track buffered writes on an adopted socket", async () => {
  const big = Buffer.alloc(1 << 20, "x").toString();
  const states: unknown[] = [];
  using ctx = await setup((req, res) => {
    res.writeHead(200, { "Content-Length": String(big.length) });
    const accepted = res.write(big);
    states.push(accepted, res.writableNeedDrain);
    res.on("drain", () => {
      states.push("drain", res.writableNeedDrain);
      res.end();
    });
  });
  ctx.client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  // Connection: close ends the socket once the response has fully flushed.
  await new Promise<void>(resolve => ctx.client.on("close", () => resolve()));
  expect(states).toEqual([false, true, "drain", false]);
  expect(ctx.reader.buf.length).toBeGreaterThanOrEqual(big.length);
});

test.concurrent("malformed request emits 'clientError'", async () => {
  using ctx = await setup();
  const clientError = new Promise<Error>((resolve, reject) => {
    ctx.httpServer.on("clientError", (err, socket) => {
      socket.destroy();
      resolve(err as Error);
    });
    ctx.client.once("close", () => reject(new Error("client closed before 'clientError' fired")));
  });
  ctx.client.write("NOT A VALID REQUEST\r\n\r\n");
  const err = (await clientError) as Error & { code?: string };
  expect(err.code).toStartWith("HPE_");
});

test.concurrent("malformed request gets the default 400 response", async () => {
  using ctx = await setup();
  ctx.client.write("garbage\r\n\r\n");
  const closed = new Promise<void>(resolve => ctx.client.on("close", () => resolve()));
  await ctx.reader.until("400 Bad Request");
  await closed;
});

test.concurrent("'upgrade' hands the adopted socket to the listener", async () => {
  using ctx = await setup();
  ctx.httpServer.on("upgrade", (req, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", d => socket.write("echo:" + d));
  });
  ctx.client.write("GET / HTTP/1.1\r\nHost: x\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n");
  await ctx.reader.until("101 Switching Protocols");
  ctx.client.write("ping");
  await ctx.reader.until("echo:ping");
});

test.concurrent("upgrade request with a body spanning packets hands off at end of headers", async () => {
  using ctx = await setup();
  ctx.httpServer.on("upgrade", async (req, socket, head) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
    // The body is skipped by the parser (like Node before its UpgradeStream):
    // req carries no body and every byte after the headers reaches the
    // listener raw, as bodyHead + 'data' events.
    socket.write("B:" + body + "|H:" + head.toString());
    socket.on("data", d => socket.write("D:" + d));
  });
  ctx.client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: upgrade\r\nUpgrade: tcp\r\nContent-Length: 5\r\n\r\nhel");
  await ctx.reader.until("B:|H:hel");
  // Rest of the request body plus tunnel bytes flow as raw socket data.
  ctx.client.write("loWORLD");
  await ctx.reader.until("D:loWORLD");
  ctx.client.write("ping");
  await ctx.reader.until("D:ping");
});

test.concurrent("upgrade request with a body larger than the high-water mark does not stall", async () => {
  const bodySize = 256 * 1024;
  using ctx = await setup();
  ctx.httpServer.on("upgrade", (req, socket, head) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
    let received = head.length;
    let replied = false;
    const check = () => {
      if (!replied && received >= bodySize + 4) {
        replied = true;
        socket.write("GOT:" + received);
      }
    };
    socket.on("data", d => {
      received += d.length;
      check();
    });
    check();
  });
  ctx.client.write(
    `GET / HTTP/1.1\r\nHost: x\r\nConnection: upgrade\r\nUpgrade: tcp\r\nContent-Length: ${bodySize}\r\n\r\n`,
  );
  await new Promise(r => setImmediate(r));
  ctx.client.write(Buffer.alloc(bodySize, "b").toString());
  ctx.client.write("ping");
  await ctx.reader.until("GOT:" + (bodySize + 4));
});

test.concurrent("CONNECT hands the adopted socket to the 'connect' listener with bodyHead", async () => {
  using ctx = await setup();
  const connectEvent = new Promise<{ method: string | undefined; head: string }>((resolve, reject) => {
    ctx.httpServer.on("connect", (req, socket, head) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.on("data", d => socket.write("tun:" + d));
      resolve({ method: req.method, head: head.toString() });
    });
    ctx.client.once("close", () => reject(new Error("client closed before 'connect' fired")));
  });
  // Tunnel bytes in the same packet as the request head must surface as bodyHead.
  ctx.client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\nearly");
  expect(await connectEvent).toEqual({ method: "CONNECT", head: "early" });
  await ctx.reader.until("200 Connection Established");
  ctx.client.write("ping");
  await ctx.reader.until("tun:ping");
});

test.concurrent("Expect: 100-continue is answered before the body", async () => {
  using ctx = await setup(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.end("got=" + body);
  });
  ctx.client.write(
    "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n",
  );
  await ctx.reader.until("100 Continue");
  ctx.client.write("hi");
  await ctx.reader.until("got=hi");
});

test.concurrent("server sockets accepted natively are unaffected", async () => {
  const httpServer = http.createServer((req, res) => res.end("native:" + req.url));
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  try {
    const port = (httpServer.address() as net.AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/n`);
    expect(await res.text()).toBe("native:/n");
  } finally {
    httpServer.close();
  }
});

test.concurrent("http._connectionListener serves a socket when invoked directly", async () => {
  // The httpolyglot/spdy pattern: call the exported listener with the server
  // as `this` instead of emitting 'connection'.
  const httpServer = http.createServer((req, res) => res.end("direct:" + req.url));
  const raw = net.createServer(sock => (http as any)._connectionListener.call(httpServer, sock));
  await new Promise<void>((resolve, reject) => {
    raw.once("error", reject);
    raw.listen(0, "127.0.0.1", resolve);
  });
  const port = (raw.address() as net.AddressInfo).port;
  const client = net.connect(port, "127.0.0.1");
  try {
    const reader = collect(client);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    client.write("GET /x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    const buf = await reader.until("direct:/x");
    expect(buf).toContain("HTTP/1.1 200 OK");
  } finally {
    client.destroy();
    raw.close();
  }
});
