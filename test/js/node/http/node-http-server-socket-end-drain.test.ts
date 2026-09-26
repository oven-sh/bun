import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { once } from "node:events";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

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

// In Node the response and the raw socket share one net.Socket Writable, so the
// FIN of socket.end() / destroySoon() follows every byte the response wrote.
describe.each(["http", "https"] as const)("%s: the raw socket's FIN follows the bytes the response wrote", protocol => {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  const cases: [string, Handler, string][] = [
    [
      "res.write() then req.socket.destroySoon()",
      (req, res) => {
        res.write("PART1");
        req.socket.destroySoon();
      },
      "5\r\nPART1\r\n",
    ],
    [
      "res.write() then res.socket.end()",
      (req, res) => {
        res.write("PART1");
        res.socket!.end();
      },
      "5\r\nPART1\r\n",
    ],
    [
      "res.write() then res.socket.end() from a microtask",
      (req, res) => {
        res.write("PART1");
        queueMicrotask(() => res.socket!.end());
      },
      "5\r\nPART1\r\n",
    ],
    [
      "res.flushHeaders() then res.socket.end()",
      (req, res) => {
        res.flushHeaders();
        res.socket!.end();
      },
      "",
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, respond, body) => {
    const onRequest: Handler = (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      respond(req, res);
    };
    await using server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as net.AddressInfo;

    const client =
      protocol === "https"
        ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
        : net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    client.on("data", chunk => chunks.push(chunk));
    // The server can close before the client's own FIN lands; only the bytes matter here.
    client.on("error", () => {});
    const closed = new Promise(resolve => client.once("close", resolve));
    client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await closed;

    const received = Buffer.concat(chunks).toString("latin1");
    const headEnd = received.indexOf("\r\n\r\n");
    expect({
      statusLine: received.slice(0, received.indexOf("\r\n")),
      body: headEnd === -1 ? null : received.slice(headEnd + 4),
    }).toEqual({ statusLine: "HTTP/1.1 200 OK", body });
  });
});

// A response that closes the connection and is larger than the loopback socket
// buffers stays partly queued in the server, so the FIN waits for the drain.
// Nothing is answered on the connection in that window: a request pipelined in
// the same read gets no response, and the FIN still comes.
describe.each(["http", "https"] as const)("%s: an 8 MiB response that closes the connection", protocol => {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  const BIG = Buffer.alloc(8 << 20, 0x61);
  const cases: [string, Handler][] = [
    [
      "req.socket.end()",
      (req, res) => {
        res.writeHead(200, { "Content-Length": String(BIG.length) });
        res.end(BIG);
        req.socket.end();
      },
    ],
    [
      "a Connection: close response header",
      (req, res) => {
        res.writeHead(200, { "Content-Length": String(BIG.length), "Connection": "close" });
        res.end(BIG);
      },
    ],
  ];

  test.each(cases)("closed by %s: a request pipelined behind it is not answered", async (_name, respond) => {
    let first = true;
    const onRequest: Handler = (req, res) => {
      if (first) {
        first = false;
        respond(req, res);
      } else {
        // Node.js runs the listener for the pipelined request too. Its socket is
        // no longer writable, so none of this may reach the client.
        res.end("second");
      }
    };
    await using server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as net.AddressInfo;

    const client =
      protocol === "https"
        ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
        : net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    client.on("data", chunk => chunks.push(chunk));
    client.on("error", () => {});
    const closed = new Promise(resolve => client.once("close", resolve));
    // Neither request asks for Connection: close, so the close has to come from the server.
    client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await closed;

    const received = Buffer.concat(chunks);
    const headEnd = received.indexOf("\r\n\r\n");
    expect({
      statusLine: received.subarray(0, received.indexOf("\r\n")).toString("latin1"),
      bodyLength: headEnd === -1 ? null : received.length - (headEnd + 4),
    }).toEqual({ statusLine: "HTTP/1.1 200 OK", bodyLength: BIG.length });
  });
});

describe("req.socket.end() while the response has not ended and is still buffered", () => {
  // Small writes stay in the socket's own buffer. 32 MiB is more than the kernel
  // takes while the client reads nothing, so socket.end() has to wait with its FIN.
  const CHUNK = Buffer.alloc(8 * 1024, 0x61);
  const CHUNKS = 4096;
  // Each write is one chunk on the wire: "2000\r\n", the data, "\r\n".
  const CHUNKED_LENGTH = CHUNKS * (6 + CHUNK.length + 2);
  const BODY = Buffer.alloc(64 * 1024, 0x62);
  const POST_HEAD = `POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${BODY.length}\r\n\r\n`;

  // The FIN that waits stops later requests only. The body of the request in
  // flight keeps arriving, or 'end' never fires and res.end() below never runs.
  test("the rest of the request body still arrives", async () => {
    const handled = Promise.withResolvers<void>();
    let reqBytes = 0;
    let reqEnded = false;
    await using server = http.createServer((req, res) => {
      req.on("data", chunk => (reqBytes += chunk.length));
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
    const { port } = server.address() as net.AddressInfo;

    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    const closed = new Promise(resolve => client.once("close", resolve));
    client.write(POST_HEAD);
    client.write(BODY.subarray(0, BODY.length / 2));
    await handled.promise;
    client.write(BODY.subarray(BODY.length / 2));
    let received = 0;
    client.on("data", chunk => (received += chunk.length));
    await closed;

    expect({ reqBytes, reqEnded }).toEqual({ reqBytes: BODY.length, reqEnded: true });
    expect(received).toBeGreaterThan(CHUNKED_LENGTH);
  });

  // Here the response has drained when the rest of the body arrives, with a
  // pipelined request behind it in the same read. No writable event is left to
  // send the FIN, so the read that completes the response has to.
  test("a request pipelined behind the rest of the body is not answered, and the FIN still comes", async () => {
    const handled = Promise.withResolvers<void>();
    let first = true;
    await using server = http.createServer((req, res) => {
      if (!first) {
        // Node.js runs the listener for the pipelined request too. Its socket is
        // no longer writable, so this may not reach the client.
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
    const { port } = server.address() as net.AddressInfo;

    // Node.js sends the FIN as soon as the writes have flushed. allowHalfOpen
    // keeps the client writable after that.
    const client = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    client.on("error", () => {});
    const ended = new Promise(resolve => client.once("end", resolve));
    const closed = new Promise(resolve => client.once("close", resolve));
    client.write(POST_HEAD);
    client.write(BODY.subarray(0, BODY.length / 2));
    await handled.promise;

    let received = 0;
    let head = Buffer.alloc(0);
    let headLength = -1;
    const drained = Promise.withResolvers<void>();
    client.on("data", chunk => {
      if (headLength === -1) {
        head = Buffer.concat([head, chunk]);
        const headEnd = head.indexOf("\r\n\r\n");
        if (headEnd !== -1) headLength = headEnd + 4;
      }
      received += chunk.length;
      if (headLength !== -1 && received >= headLength + CHUNKED_LENGTH) drained.resolve();
    });
    await drained.promise;
    client.write(Buffer.concat([BODY.subarray(BODY.length / 2), Buffer.from("GET / HTTP/1.1\r\nHost: x\r\n\r\n")]));
    await ended;
    client.end();
    await closed;

    // One response: the head, the chunks, and the terminating chunk when
    // res.end() still reaches the wire (Node.js drops it after socket.end()).
    expect([0, 5]).toContain(received - headLength - CHUNKED_LENGTH);
  });
});
