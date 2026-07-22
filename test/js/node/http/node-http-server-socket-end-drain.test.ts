import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

// res.end(8 MiB) overflows the send buffer, so req.socket.end() defers its FIN.
// A pipelined request in the same read must not wipe that deferred shutdown
// (its resetResponseState() cleared HTTP_CONNECTION_CLOSE and the socket hung).
test("req.socket.end() with a large response buffered still closes when a pipelined request follows", async () => {
  const BIG = Buffer.alloc(8 << 20, 0x61);
  let handlerCalls = 0;
  await using server = http.createServer((req, res) => {
    handlerCalls++;
    res.writeHead(200, { "Content-Length": String(BIG.length) });
    if (handlerCalls === 1) {
      res.end(BIG);
      req.socket.end();
    } else {
      res.write(BIG);
      res.end();
    }
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = (server.address() as AddressInfo).port;

  const c = net.connect(port, "127.0.0.1");
  await once(c, "connect");
  let bytes = 0;
  c.on("data", d => (bytes += d.length));
  c.on("error", () => {});
  // Two pipelined requests in one write; neither carries Connection: close so
  // the close has to come from the server's socket.end().
  c.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n");
  await new Promise<void>(resolve => c.once("close", () => resolve()));

  // Exactly the first response's body plus its head (Node.js drops the second
  // response's writes because the socket's writable side is already ended).
  expect(bytes).toBeGreaterThanOrEqual(BIG.length);
  expect(bytes).toBeLessThan(BIG.length + 1024);
  // Bun stops parsing before the second request (Node.js dispatches it but its
  // writes never reach the wire), matching the immediate-shutdown path.
  expect(handlerCalls).toBe(1);
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
