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

// In Node the bytes of res.write() wait in the stream of the socket, so end() on that socket
// finishes the stream behind them.
describe.each(["http", "https"] as const)(
  "%s: res.socket.end() behind response bytes that wait for the client",
  protocol => {
    // 16 MiB in writes of 64 KiB: more than a loopback connection takes from a peer that reads
    // nothing. A kernel can take one large write whole, and then it refuses the next one.
    const chunk = Buffer.alloc(64 * 1024, "a");
    const length = 256 * chunk.length;

    test("the end() callback and 'finish' wait until the client has read them", async () => {
      const events: string[] = [];
      const ended = Promise.withResolvers<net.Socket>();
      const finished = Promise.withResolvers<void>();
      const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        if (req.url === "/turn") return void res.end();
        res.writeHead(200, { "Content-Length": length });
        for (let written = 0; written < length; written += chunk.length) res.write(chunk);
        const socket = res.socket!;
        socket.on("finish", () => events.push("finish"));
        socket.end(() => {
          events.push("end callback");
          finished.resolve();
        });
        ended.resolve(socket);
      };
      const server = protocol === "https" ? https.createServer(tlsCert, onRequest) : http.createServer(onRequest);
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as net.AddressInfo;
      // One exchange on a second connection: at least one whole turn of the server's event loop.
      const turn = () =>
        new Promise<void>((resolve, reject) => {
          (protocol === "https" ? https : http)
            .get({ port, host: "127.0.0.1", path: "/turn", agent: false, rejectUnauthorized: false }, res =>
              res.resume().on("end", () => resolve()),
            )
            .on("error", reject);
        });

      const client =
        protocol === "https"
          ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
          : net.connect(port, "127.0.0.1");
      try {
        await once(client, protocol === "https" ? "secureConnect" : "connect");
        client.pause();
        client.on("error", () => {});
        client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        const socket = await ended.promise;
        await turn();
        await turn();
        const before = { events: [...events], writableFinished: socket.writableFinished };

        // The whole body arrives, and then the stream finishes.
        let received = 0;
        let head = -1;
        const read = Promise.withResolvers<void>();
        client.on("data", chunk => {
          if (head === -1 && (head = chunk.indexOf("\r\n\r\n")) !== -1) head += received + 4;
          received += chunk.length;
          if (head !== -1 && received - head === length) read.resolve();
        });
        client.resume();
        await read.promise;
        await finished.promise;
        await turn();
        expect({ before, events, writableFinished: socket.writableFinished }).toEqual({
          before: { events: [], writableFinished: false },
          events: ["end callback", "finish"],
          writableFinished: true,
        });
      } finally {
        client.destroy();
        server.closeAllConnections();
        server.close();
      }
    });
  },
);
