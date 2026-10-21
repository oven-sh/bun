import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls as tlsCert } from "harness";
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
    client.on("data", (chunk: Buffer) => chunks.push(chunk));
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

// A read pause leaves the bytes of the client in the kernel, and the kernel turns a close over
// unread input into a reset that throws away the output it has not sent yet. usockets drops
// those bytes where it closes a socket behind its own FIN, so what the server wrote arrives.

// A client that takes one chunk for each turn of the event loop, so that a reset cuts short
// what the server wrote.
async function pacedClient(protocol: "http" | "https", port: number) {
  const client =
    protocol === "https"
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
      : net.connect(port, "127.0.0.1");
  client.pause();
  const chunks: Buffer[] = [];
  let end = "none";
  const closed = Promise.withResolvers<void>();
  client.on("error", (err: NodeJS.ErrnoException) => (end = err.code!));
  client.on("end", () => (end = "end"));
  client.on("close", () => closed.resolve());
  client.on("data", (chunk: Buffer) => {
    client.pause();
    setImmediate(() => client.resume());
    chunks.push(chunk);
  });
  await once(client, protocol === "https" ? "secureConnect" : "connect");
  return {
    client,
    // Writes to a connection whose reads the server has stopped. The loopback delivers in order:
    // the kernel of the server has these bytes before it accepts the second connection.
    async writeUnread(data: string) {
      await new Promise(resolve => client.write(data, resolve));
      const barrier = net.connect(port, "127.0.0.1");
      await once(barrier, "connect");
      barrier.destroy();
    },
    // What the client received, and how the connection ended for it: "end", or the code of its error.
    async result() {
      client.resume();
      await closed.promise;
      return { received: Buffer.concat(chunks), end };
    },
  };
}

// A connection whose request has a 5-byte body still to come, with the reads of `socket`
// paused: the body stays in the kernel of the server.
async function pausedConnectionWithUnreadBody(protocol: "http" | "https") {
  const handled = Promise.withResolvers<net.Socket>();
  const server = protocol === "https" ? https.createServer(tlsCert) : http.createServer();
  server.once("request", req => {
    req.socket.on("error", () => {});
    req.socket.pause();
    handled.resolve(req.socket);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { client, writeUnread, result } = await pacedClient(protocol, (server.address() as net.AddressInfo).port);

  client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\n");
  const socket = await handled.promise;
  // Leaves the read that dispatched the request: a close inside it waits for the end of that read.
  await new Promise(resolve => setImmediate(resolve));
  await writeUnread("hello");
  return {
    socket,
    async result() {
      const { received, end } = await result();
      return { received: received.length, end };
    },
    async [Symbol.asyncDispose]() {
      client.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

// The kernel takes this at once on every platform, so the server closes in the call that ends the
// socket or the response. It is more than the client holds before it reads, so a reset cuts it.
const big = Buffer.alloc(120_000, "a");

describe.each(["http", "https"] as const)("%s: a close behind the FIN over unread input", protocol => {
  const closes: [string, (socket: net.Socket) => void][] = [
    ["req.socket.destroySoon()", socket => socket.destroySoon()],
    [
      "req.socket.end() then destroy() on 'finish'",
      socket => {
        socket.end();
        socket.once("finish", () => socket.destroy());
      },
    ],
  ];

  // Node resets in these two rows: a paused socket of its HTTP server does not read the body either.
  test.concurrent.each(closes)("%s delivers what the server wrote", async (_name, close) => {
    await using connection = await pausedConnectionWithUnreadBody(protocol);
    connection.socket.write(big);
    close(connection.socket);
    expect(await connection.result()).toEqual({ received: big.length, end: "end" });
  });

  // The server stops the reads when the buffer of the body is full. Node starts them again when
  // the response ends, so its result depends on which comes first, that read or the close.
  test.concurrent(
    "a response that closes the connection arrives whole when nothing reads the request body",
    async () => {
      const dispatched = Promise.withResolvers<IncomingMessage>();
      const paused = Promise.withResolvers<void>();
      const respond = Promise.withResolvers<void>();
      const onRequest = (req: IncomingMessage, res: ServerResponse) => {
        req.on("error", () => {});
        res.on("error", () => {});
        req.socket.once("pause", () => paused.resolve());
        dispatched.resolve(req);
        res.setHeader("Connection", "close");
        respond.promise.then(() => res.end(big));
      };
      await using server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { client, writeUnread, result } = await pacedClient(protocol, (server.address() as net.AddressInfo).port);

      client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 8388608\r\n\r\n");
      client.write(Buffer.alloc((await dispatched.promise).readableHighWaterMark, "b"));
      await paused.promise;
      await writeUnread("hello");
      respond.resolve();
      const { received, end } = await result();
      const headEnd = received.indexOf("\r\n\r\n");
      expect({ body: headEnd === -1 ? -1 : received.length - (headEnd + 4), end }).toEqual({
        body: big.length,
        end: "end",
      });
      client.destroy();
    },
  );
});

// A fault rule applies to every socket of the process, so these tests run one at a time.
describe.skipIf(!fault.available() || isWindows)("a close behind the FIN under socket fault injection", () => {
  afterEach(() => fault.clear());

  // A short send leaves the ciphertext of `tail` in the TLS layer, and the close of destroySoon() waits for it.
  const tail = Buffer.alloc(64 * 1024, "b");
  async function destroySoonBehindUnsentCiphertext(socket: net.Socket) {
    await new Promise(resolve => socket.write(big, resolve));
    // The kernel takes 1 byte of the next write.
    fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
    socket.write(tail);
    socket.destroySoon();
    await once(socket, "finish");
  }

  test("https: the close that waited for TLS ciphertext drops the unread bytes where it closes the fd", async () => {
    await using connection = await pausedConnectionWithUnreadBody("https");
    await destroySoonBehindUnsentCiphertext(connection.socket);
    fault.clear();
    expect(await connection.result()).toEqual({ received: big.length + tail.length, end: "end" });
  });

  // This close throws the ciphertext away, so no FIN of the server is out. It drops nothing: the
  // client must see the reset of a response that was cut, not the end of a complete one.
  test("https: a close that does not wait for that ciphertext stays a reset", async () => {
    await using connection = await pausedConnectionWithUnreadBody("https");
    await destroySoonBehindUnsentCiphertext(connection.socket);
    connection.socket.destroy();
    fault.clear();
    const { received, end } = await connection.result();
    expect({ whole: received === big.length + tail.length, end }).toEqual({ whole: false, end: "ECONNRESET" });
  });

  test("the close drops the unread bytes in as many reads as it takes", async () => {
    await using connection = await pausedConnectionWithUnreadBody("http");
    connection.socket.write(big);
    // The next 5 reads of the process take 1 byte each.
    fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: 5 });
    connection.socket.destroySoon();
    expect(await connection.result()).toEqual({ received: big.length, end: "end" });
  });

  // The handler makes the next read of the process fail, then closes the connection behind its
  // response. A close that reads takes that error. If the close does not read, the client takes it.
  test.each([
    ["a socket that was never paused is not read", "not-paused", "EHOSTUNREACH"],
    ["a socket that was read after its pause is not read", "read-since-pause", "EHOSTUNREACH"],
    ["a paused socket is read", "paused", "end"],
  ])("at its close, %s", async (_name, mode, expected) => {
    await using server = http.createServer((req, res) => {
      if (mode === "read-since-pause" && req.url === "/first") {
        // The request behind this one is read after the pause, so no input waits behind the pause.
        req.socket.pause();
        req.socket.resume();
        return void res.end("first");
      }
      if (mode === "paused") req.socket.pause();
      fault.set({ syscall: "recv", action: "errno", errno: "EHOSTUNREACH", repeat: 1 });
      res.setHeader("Connection", "close");
      res.end("last");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    // "end", or the code of the error of the client.
    let end = "none";
    const closed = Promise.withResolvers<void>();
    client.on("error", (err: NodeJS.ErrnoException) => (end = err.code!));
    client.on("end", () => (end = "end"));
    client.on("close", () => closed.resolve());
    await once(client, "connect");

    if (mode === "read-since-pause") {
      client.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\n");
      await once(client, "data");
    } else {
      client.resume();
    }
    client.write("GET /last HTTP/1.1\r\nHost: x\r\n\r\n");
    await closed.promise;
    expect(end).toBe(expected);
  });
});
