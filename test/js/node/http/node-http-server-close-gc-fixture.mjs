// Runs under both `bun` and `node --expose-gc` and prints the same JSON.
//
// A keep-alive connection whose request was in flight when server.close() ran
// survives the close and stays attached to the closed server. Nothing in JS
// references Bun's native server wrapper after close(), so that connection
// itself has to keep the wrapper (the only GC root of the request and
// 'clientError' callbacks) alive for as long as it can still dispatch them.
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

const gc = () => (globalThis.Bun ? Bun.gc(true) : globalThis.gc?.());

async function round() {
  let server = http.createServer((req, res) => {
    req.resume().on("end", () => {
      res.writeHead(200, { "Content-Length": 2 });
      res.end("ok");
    });
  });
  const clientErrors = [];
  server.on("clientError", (err, sock) => {
    clientErrors.push(err.code);
    sock.destroy();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = net.connect(server.address().port, "127.0.0.1");
  try {
    let received = "";
    let closed = false;
    let waiter = Promise.withResolvers();
    const next = () => waiter.promise.then(() => (waiter = Promise.withResolvers()));
    client.setEncoding("latin1").on("data", chunk => {
      received += chunk;
      waiter.resolve();
    });
    client
      .on("error", () => {})
      .on("close", () => {
        closed = true;
        waiter.resolve();
      });
    await once(client, "connect");

    // Request 1 is in flight (body outstanding) when close() runs, so the
    // connection is busy and survives close().
    const requested = once(server, "request");
    client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1\r\n\r\n");
    await requested;
    server.close();
    server = null;

    // Finish request 1: the connection is now idle, kept alive, and the only
    // thing still attached to the closed server.
    client.write("x");
    while (!closed && !received.endsWith("\r\n\r\nok")) await next();
    gc();

    // Request 2 on the surviving connection is still served...
    if (!closed) client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    while (!closed && received.split("\r\n\r\nok").length < 3) await next();
    // ...and a malformed request 3 still reaches 'clientError'.
    if (!closed) client.write("GET / HTTP/1.1\r\nBad Header\r\n\r\n");
    while (!closed) await next();
    return { statuses: received.match(/HTTP\/1\.1 \d{3} [^\r\n]*/g), clientErrors };
  } finally {
    client.destroy();
    if (server?.listening) server.close();
  }
}

const results = [];
for (let i = 0; i < 3; i++) results.push(await round());
console.log(JSON.stringify(results));
