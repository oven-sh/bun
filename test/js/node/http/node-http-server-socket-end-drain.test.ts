import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import tls from "node:tls";

const transports = {
  http: {
    createServer: (handler: http.RequestListener) => http.createServer(handler),
    connect: (port: number) => net.connect(port, "127.0.0.1"),
    connected: "connect",
  },
  https: {
    createServer: (handler: http.RequestListener) => https.createServer(tlsCert, handler),
    connect: (port: number) => tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }),
    connected: "secureConnect",
  },
};

// Two ways to end the connection after a response that is still buffered.
const closers = {
  "req.socket.end()": (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => {
    res.writeHead(200, { "Content-Length": String(body.length) });
    res.end(body);
    req.socket.end();
  },
  "Connection: close": (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => {
    res.writeHead(200, { "Content-Length": String(body.length), "Connection": "close" });
    res.end(body);
  },
};

// res.end(8 MiB) overflows the send buffer, so the FIN waits for the drain.
// A request pipelined in the same read must not be answered: its dispatch
// reset HTTP_CONNECTION_CLOSE, so both responses went out and the FIN came
// only with the keep-alive timeout.
test.each([
  ["http", "req.socket.end()"],
  ["http", "Connection: close"],
  ["https", "req.socket.end()"],
  ["https", "Connection: close"],
] as const)(
  "%s: a request pipelined behind an 8 MiB response closed by %s is not answered",
  async (transport, closer) => {
    const BIG = Buffer.alloc(8 << 20, 0x61);
    let first = true;
    await using server = transports[transport].createServer((req, res) => {
      if (first) {
        first = false;
        closers[closer](req, res, BIG);
      } else {
        // Node.js dispatches the pipelined request too. The socket is no longer
        // writable there, so none of this may reach the client.
        res.writeHead(200, { "Content-Length": String(BIG.length) });
        res.write(BIG);
        res.end();
      }
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as AddressInfo).port;

    const c = transports[transport].connect(port);
    await once(c, transports[transport].connected);
    let bytes = 0;
    let headLength = -1;
    c.on("data", d => {
      if (headLength === -1) headLength = d.indexOf("\r\n\r\n") + 4;
      bytes += d.length;
    });
    c.on("error", () => {});
    // Two pipelined requests in one write. Neither asks for Connection: close,
    // so the close has to come from the server.
    c.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await new Promise<void>(resolve => c.once("close", () => resolve()));

    // One response on the wire (its head plus the 8 MiB body), then the FIN.
    expect(headLength).toBeGreaterThan(4);
    expect(bytes).toBe(headLength + BIG.length);
  },
);

// Small writes stay in the socket's own buffer. 32 MiB is more than the kernel
// takes while the client reads nothing, so socket.end() must defer its FIN.
const CHUNK = Buffer.alloc(8 * 1024, 0x61);
const CHUNKS = 4096;
// Each write is one chunk on the wire: "2000\r\n", the data, "\r\n".
const CHUNKED_LENGTH = CHUNKS * (6 + CHUNK.length + 2);
const BODY = Buffer.alloc(64 * 1024, 0x62);
const POST_HEAD = "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: " + BODY.length + "\r\n\r\n";

// The deferred FIN must stop later requests only. The body of the request in
// flight keeps arriving, or 'end' never fires and res.end() below never runs.
test("req.socket.end() with a response buffered still delivers the rest of the request body", async () => {
  const handled = Promise.withResolvers<void>();
  let reqBytes = 0;
  let reqEnded = false;
  await using server = http.createServer((req, res) => {
    req.on("data", d => (reqBytes += d.length));
    req.on("end", () => {
      reqEnded = true;
      res.end();
    });
    res.writeHead(200);
    for (let i = 0; i < CHUNKS; i++) res.write(CHUNK);
    req.socket.end();
    handled.resolve();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = (server.address() as AddressInfo).port;

  const c = net.connect(port, "127.0.0.1");
  await once(c, "connect");
  c.on("error", () => {});
  c.write(POST_HEAD);
  c.write(BODY.subarray(0, BODY.length / 2));
  await handled.promise;
  c.write(BODY.subarray(BODY.length / 2));
  let bytes = 0;
  c.on("data", d => (bytes += d.length));
  await new Promise<void>(resolve => c.once("close", () => resolve()));

  expect({ reqBytes, reqEnded }).toEqual({ reqBytes: BODY.length, reqEnded: true });
  expect(bytes).toBeGreaterThan(CHUNKED_LENGTH);
});

// Same deferred FIN, but the response has already drained when the rest of the
// body arrives with a pipelined request behind it in the same read. No writable
// event is left to send the FIN, so the read that ends the response must.
test("req.socket.end(): a request pipelined behind the rest of the body still gets the FIN after the drain", async () => {
  const handled = Promise.withResolvers<void>();
  let first = true;
  await using server = http.createServer((req, res) => {
    if (!first) {
      // Node.js dispatches the pipelined request too. The socket is no longer
      // writable there, so this may not reach the client.
      res.end("second");
      return;
    }
    first = false;
    req.resume();
    req.on("end", () => res.end());
    res.writeHead(200);
    for (let i = 0; i < CHUNKS; i++) res.write(CHUNK);
    req.socket.end();
    handled.resolve();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = (server.address() as AddressInfo).port;

  // Node.js sends the FIN as soon as the writes flush. allowHalfOpen keeps the
  // client writable after that.
  const c = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
  await once(c, "connect");
  c.on("error", () => {});
  const ended = new Promise<void>(resolve => c.once("end", () => resolve()));
  const closed = new Promise<void>(resolve => c.once("close", () => resolve()));
  c.write(POST_HEAD);
  c.write(BODY.subarray(0, BODY.length / 2));
  await handled.promise;

  let bytes = 0;
  let headLength = -1;
  const drained = Promise.withResolvers<void>();
  c.on("data", d => {
    if (headLength === -1) headLength = d.indexOf("\r\n\r\n") + 4;
    bytes += d.length;
    if (bytes >= headLength + CHUNKED_LENGTH) drained.resolve();
  });
  await drained.promise;
  c.write(Buffer.concat([BODY.subarray(BODY.length / 2), Buffer.from("GET / HTTP/1.1\r\nHost: x\r\n\r\n")]));
  await ended;
  c.end();
  await closed;

  // One response: the head, the chunks, and the terminating chunk when
  // res.end() still reaches the wire (Node.js drops it after socket.end()).
  expect(headLength).toBeGreaterThan(4);
  expect([0, 5]).toContain(bytes - headLength - CHUNKED_LENGTH);
});

// res.socket.end() half-closes the connection; the server must still release the
// socket (drain the unconsumed body on epoll, or take kqueue's EVFILT_WRITE
// EV_EOF from its own SHUT_WR) so server.close() resolves. On macOS that early
// close can RST the still-writing client, so the client's EPIPE is expected and
// the close wait must not be once(c, "close"), which would reject on it.
test("server.close() completes after res.socket.end() with a 2 MB upload in flight", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { once } from "node:events";
        import http from "node:http";
        import net from "node:net";
        let sock;
        const handled = Promise.withResolvers();
        const server = http.createServer((req, res) => {
          res.writeHead(200, { Connection: "close" });
          sock = res.socket;
          res.socket.end();
          try { res.write("x"); } catch {}
          handled.resolve();
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        const port = server.address().port;
        const c = net.connect(port, "127.0.0.1");
        await once(c, "connect");
        const body = Buffer.alloc(2 * 1024 * 1024, 0x61);
        c.on("error", () => {});
        c.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: " + body.length + "\\r\\nConnection: close\\r\\n\\r\\n");
        c.write(body);
        c.on("end", () => c.end());
        // Not once(c, "close"): that also registers an 'error' rejector, and on
        // macOS the 2 MB upload can hit EPIPE once the server's SHUT_WR +
        // resume drains the body. The write error is expected (and swallowed
        // above); rejecting socketClosed on it turned it into an uncaught
        // top-level rejection instead of exercising the drain/close path.
        const socketClosed = new Promise(r => c.once("close", r));
        await handled.promise;
        const serverClosed = new Promise(r => server.close(() => r()));
        const watchdog = setTimeout(() => {
          process.stdout.write("timeout destroyed=" + (sock?.destroyed ?? "none") + "\\n");
          process.exit(1);
        }, 10000);
        await Promise.all([socketClosed, serverClosed]);
        clearTimeout(watchdog);
        process.stdout.write("closed destroyed=" + sock.destroyed + "\\n");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "closed destroyed=true\n", stderr: "", exitCode: 0 });
});
