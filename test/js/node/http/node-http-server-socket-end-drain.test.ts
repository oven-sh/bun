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

type Protocol = "http" | "https";
type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

async function listen(protocol: Protocol, onRequest: RequestListener) {
  const server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
  await once(server.listen(0, "127.0.0.1"), "listening");
  return server;
}

function connect(protocol: Protocol, server: net.Server, options: { allowHalfOpen?: boolean } = {}) {
  const { port } = server.address() as net.AddressInfo;
  return protocol === "https"
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...options })
    : net.connect({ port, host: "127.0.0.1", ...options });
}

// A response that closes the connection is complete, but the kernel has not
// taken all of it: the rest stays queued in the server and the FIN waits for
// the drain. Nothing is answered on the connection in that window. A request
// pipelined in the same read gets no response, and the FIN still comes. A host
// whose kernel takes the whole response at once has no such window, and the
// result has to be the same there.
describe.each(["http", "https"] as const)("%s: an 8 MiB response that closes the connection", protocol => {
  const BIG = Buffer.alloc(8 << 20, 0x61);
  const cases: [string, RequestListener][] = [
    [
      "res.end(body), then req.socket.end()",
      (req, res) => {
        res.writeHead(200, { "Content-Length": String(BIG.length) });
        res.end(BIG);
        req.socket.end();
      },
    ],
    [
      "res.end(body) with a Connection: close response header",
      (req, res) => {
        res.writeHead(200, { "Content-Length": String(BIG.length), "Connection": "close" });
        res.end(BIG);
      },
    ],
    [
      "res.write(body) and res.end(), then req.socket.end()",
      (req, res) => {
        res.writeHead(200, { "Content-Length": String(BIG.length) });
        res.write(BIG);
        res.end();
        req.socket.end();
      },
    ],
  ];

  test.each(cases)("%s: a request pipelined behind it is not answered", async (_name, respond) => {
    let first = true;
    await using server = await listen(protocol, (req, res) => {
      if (first) {
        first = false;
        respond(req, res);
      } else {
        // Node.js runs the listener for the pipelined request too. Its socket is
        // no longer writable, so none of this may reach the client.
        res.end("second");
      }
    });

    const client = connect(protocol, server);
    const chunks: Buffer[] = [];
    let received = 0;
    let headLength = -1;
    const { promise: outcome, resolve: settle } = Promise.withResolvers<"close" | "a second response">();
    client.on("data", chunk => {
      chunks.push(chunk);
      received += chunk.length;
      if (headLength === -1) {
        const headEnd = Buffer.concat(chunks).indexOf("\r\n\r\n");
        if (headEnd === -1) return;
        headLength = headEnd + 4;
      }
      // More than the head and the body can only be a second response. Do not
      // wait for a FIN that then comes with the keep-alive timeout.
      if (received > headLength + BIG.length) settle("a second response");
    });
    // The server can close before the client's own FIN lands; only the bytes matter here.
    client.on("error", () => {});
    client.once("close", () => settle("close"));
    // Neither request asks for Connection: close, so the close has to come from the server.
    client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n");
    const result = await outcome;
    client.destroy();

    const response = Buffer.concat(chunks);
    const body = response.subarray(Math.max(headLength, 0));
    expect({
      outcome: result,
      statusLine: response.subarray(0, response.indexOf("\r\n")).toString("latin1"),
      bodyLength: body.length,
      bodyIntact: body.equals(BIG),
    }).toEqual({ outcome: "close", statusLine: "HTTP/1.1 200 OK", bodyLength: BIG.length, bodyIntact: true });
  });
});

describe.each(["http", "https"] as const)("%s: req.socket.end() while a 16 MiB response has not ended", protocol => {
  // The client reads nothing until the listener has run, and 16 MiB is more
  // than a kernel takes then (about 2.7 MiB on Linux, 0.1 MiB on Windows). Bun
  // holds the rest, so the FIN of socket.end() waits for the drain. With nothing
  // held Bun shuts down at once and drops the rest of the request body, and
  // these tests fail. Node.js needs no held bytes: it keeps reading after end().
  const CHUNK = Buffer.alloc(8 * 1024, 0x61);
  const CHUNKS = 2048;
  // Each write is one chunk on the wire: "2000\r\n", the data, "\r\n".
  const CHUNKED_LENGTH = CHUNKS * (6 + CHUNK.length + 2);
  const BODY = Buffer.alloc(64 * 1024, 0x62);
  const POST_HEAD = `POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${BODY.length}\r\n\r\n`;

  // What the listener saw of the request body.
  type Seen = { reqBytes: number; reqEnded: boolean };

  // Writes the response and calls req.socket.end(). res.end() follows when the
  // request body has ended. Resolves `handled` when the listener has run and
  // `closed` when the server side of the connection has closed.
  function respondThenEnd(seen: Seen, handled: () => void, closed: () => void): RequestListener {
    return (req, res) => {
      req.socket.once("close", closed);
      req.on("data", chunk => (seen.reqBytes += chunk.length));
      req.on("end", () => {
        seen.reqEnded = true;
        res.end();
      });
      res.writeHead(200);
      for (let i = 0; i < CHUNKS; i++) res.write(CHUNK);
      req.socket.end();
      handled();
    };
  }

  // Counts the response bytes. The head is searched in the bytes received so
  // far, so a delimiter that is split over two reads is still found.
  // afterChunks() is the number of bytes that follow the head and the chunks:
  // 5 for the terminating chunk of res.end(), 0 when Node.js drops it after
  // socket.end(), more for a second response.
  function countResponse(client: net.Socket, onChunks?: () => void) {
    const counted = {
      bytes: 0,
      headLength: -1,
      afterChunks: () => counted.bytes - counted.headLength - CHUNKED_LENGTH,
    };
    let head = Buffer.alloc(0);
    client.on("data", chunk => {
      if (counted.headLength === -1) {
        head = Buffer.concat([head, chunk]);
        const headEnd = head.indexOf("\r\n\r\n");
        if (headEnd !== -1) counted.headLength = headEnd + 4;
      }
      counted.bytes += chunk.length;
      if (counted.headLength !== -1 && counted.afterChunks() >= 0) onChunks?.();
    });
    return counted;
  }

  // The FIN that waits stops later requests only. The body of the request in
  // flight keeps arriving, or 'end' never fires and res.end() never runs.
  test("the rest of the request body still arrives", async () => {
    const seen: Seen = { reqBytes: 0, reqEnded: false };
    const handled = Promise.withResolvers<void>();
    const serverClosed = Promise.withResolvers<void>();
    await using server = await listen(protocol, respondThenEnd(seen, handled.resolve, serverClosed.resolve));

    const client = connect(protocol, server);
    client.on("error", () => {});
    const closed = new Promise(resolve => client.once("close", resolve));
    client.write(POST_HEAD);
    client.write(BODY.subarray(0, BODY.length / 2));
    await handled.promise;
    client.write(BODY.subarray(BODY.length / 2));
    const counted = countResponse(client);
    await Promise.all([closed, serverClosed.promise]);

    expect(seen).toEqual({ reqBytes: BODY.length, reqEnded: true });
    expect([0, 5]).toContain(counted.afterChunks());
  });

  // Here the response has drained when the rest of the body arrives, with a
  // pipelined request behind it in the same read. No writable event is left to
  // send the FIN, so the read that completes the response has to.
  test("a request pipelined behind the rest of the body is not answered, and the FIN still comes", async () => {
    const seen: Seen = { reqBytes: 0, reqEnded: false };
    const handled = Promise.withResolvers<void>();
    const serverClosed = Promise.withResolvers<void>();
    const respond = respondThenEnd(seen, handled.resolve, serverClosed.resolve);
    let first = true;
    await using server = await listen(protocol, (req, res) => {
      if (first) {
        first = false;
        respond(req, res);
      } else {
        // Node.js runs the listener for the pipelined request too. Its socket
        // is no longer writable, so this may not reach the client.
        res.end("second");
      }
    });

    // Node.js sends the FIN as soon as the writes have flushed. allowHalfOpen
    // keeps the client writable after that.
    const client = connect(protocol, server, { allowHalfOpen: true });
    client.on("error", () => {});
    const closed = new Promise(resolve => client.once("close", resolve));
    const { promise: outcome, resolve: settle } = Promise.withResolvers<"FIN" | "a second response">();
    client.once("end", () => settle("FIN"));
    client.write(POST_HEAD);
    client.write(BODY.subarray(0, BODY.length / 2));
    await handled.promise;

    const drained = Promise.withResolvers<void>();
    const counted = countResponse(client, () => {
      drained.resolve();
      // More than the terminating chunk can only be a second response. Do not
      // wait for a FIN that then comes with the keep-alive timeout.
      if (counted.afterChunks() > 5) settle("a second response");
    });
    await drained.promise;
    client.write(Buffer.concat([BODY.subarray(BODY.length / 2), Buffer.from("GET / HTTP/1.1\r\nHost: x\r\n\r\n")]));
    const result = await outcome;
    client.end();
    await Promise.all([closed, serverClosed.promise]);

    expect({ outcome: result, ...seen }).toEqual({ outcome: "FIN", reqBytes: BODY.length, reqEnded: true });
    expect([0, 5]).toContain(counted.afterChunks());
  });
});
