process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const http2 = require("http2");
const net = require("net");
const path = require("path");
const tls = require("tls");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;
let checked = 0;

function expectStore(what, expected) {
  checked++;
  const store = asyncLocalStorage.getStore();
  if (store !== expected) {
    console.error(`FAIL: ${what} ran in ${JSON.stringify(store)}, expected ${JSON.stringify(expected)}`);
    failed = true;
  }
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// An HTTP/1.1 client of an http2 server with allowHTTP1, on a connection that emit("connection") hands over. The
// first request is answered on the kept-alive connection. The client then sends the second request and ends its side
// in one write, so the handler of the second request writes to a connection whose peer has closed its half.
const fixtures = path.join(__dirname, "..", "..", "tls", "fixtures");
let requests = 0;
const server = http2.createSecureServer(
  {
    allowHTTP1: true,
    key: fs.readFileSync(path.join(fixtures, "agent1-key.pem")),
    cert: fs.readFileSync(path.join(fixtures, "agent1-cert.pem")),
  },
  (request, response) => {
    if (++requests === 1) return response.end("one");
    response.on("close", () =>
      setImmediate(() => {
        if (checked !== 2) console.error(`FAIL: ${checked} of 2 callbacks ran`);
        acceptor.close();
        process.exit(failed || checked !== 2 ? 1 : 0);
      }),
    );
    asyncLocalStorage.run("response write", () =>
      response.write("two", () =>
        expectStore("the callback of a response write on a half-closed connection", "response write"),
      ),
    );
    // Queued behind the response's write, so it inherits that context.
    asyncLocalStorage.run("socket write", () =>
      request.socket.write("x", () =>
        expectStore("the callback of a write on the connection, behind the response's write", "response write"),
      ),
    );
  },
);

const acceptor = net.createServer(socket => asyncLocalStorage.run("emit", () => server.emit("connection", socket)));
asyncLocalStorage.run("listen", () =>
  acceptor.listen(0, "127.0.0.1", () =>
    asyncLocalStorage.exit(() => {
      const client = tls.connect({
        port: acceptor.address().port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
      });
      client.on("error", err => requests === 2 || fail(`the client reported ${err.code}`));
      let received = "";
      client.on("data", chunk => {
        received += chunk;
        if (requests === 1 && received.endsWith("one")) client.end("GET /2 HTTP/1.1\r\nHost: localhost\r\n\r\n");
      });
      client.write("GET /1 HTTP/1.1\r\nHost: localhost\r\n\r\n");
    }),
  ),
);
