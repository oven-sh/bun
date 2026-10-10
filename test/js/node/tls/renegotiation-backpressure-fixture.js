// TLS 1.2 server for the tests that mix a renegotiation with an upload that is
// under write backpressure. Runs in Node, because a Bun server does not
// renegotiate. It reads nothing on its own. The test drives it over stdin, so
// no step depends on relative speeds. A command applies to the latest
// connection:
//
//   A      ->  take ONE read off the socket, then report READ. One read opens
//              a receive window of about highWaterMark bytes: room for one
//              record, and far too little to make the client writable.
//   R      ->  ask for a renegotiation. Reports RENEG_REQUEST at once and
//              RENEG_DONE err=<code|null> when the new handshake is over.
//   D      ->  keep reading from now on.
//   E <n>  ->  report GOT_ALL once <n> bytes have arrived.
//
// A report is "<connection number> <what> mismatchAt=<offset|-1>". The first
// report of a connection is OPEN. The number keeps a late report of an earlier
// connection apart from the current one. The offset is the first byte that
// broke the pattern the client uploads (byte[i] === i % 251), so a splice the
// cipher happens to accept still fails.
"use strict";
const tls = require("node:tls");

const say = line => process.stdout.write(line + "\n");

let connections = 0;
let current = null;

const server = tls.createServer(
  {
    cert: process.env.SERVER_CERT,
    key: process.env.SERVER_KEY,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
    // Bounds how much one read() pulls off the socket, and with it how much
    // receive window each read opens.
    highWaterMark: 16 * 1024,
  },
  socket => {
    const id = ++connections;
    const connection = {
      reads: 0,
      reportRead: false,
      closed: false,
      offset: 0,
      mismatchAt: -1,
      expectTotal: Infinity,
      tell(what) {
        say(`${id} ${what} mismatchAt=${connection.mismatchAt}`);
      },
      renegotiate() {
        socket.renegotiate({}, error => connection.tell(`RENEG_DONE err=${error ? error.code || error.message : "null"}`));
        connection.tell("RENEG_REQUEST");
      },
      reportTotal() {
        if (connection.offset >= connection.expectTotal) {
          connection.expectTotal = Infinity;
          connection.tell("GOT_ALL");
        }
      },
    };
    current = connection;
    socket.pause();
    connection.tell("OPEN");

    const pull = () => {
      if (connection.closed) return;
      while (connection.reads > 0) {
        const chunk = socket.read();
        if (!chunk) break;
        connection.reads--;
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] !== (connection.offset + i) % 251) {
            if (connection.mismatchAt < 0) connection.mismatchAt = connection.offset + i;
            break;
          }
        }
        connection.offset += chunk.length;
        if (connection.reportRead) {
          connection.reportRead = false;
          connection.tell("READ");
        }
        connection.reportTotal();
      }
      setImmediate(pull);
    };
    setImmediate(pull);

    socket.on("error", error => {
      connection.closed = true;
      connection.tell(`ERROR code=${error.code}`);
    });
    socket.on("close", () => {
      connection.closed = true;
      connection.tell("CLOSE");
    });
  },
);

process.stdin.on("data", data => {
  for (const command of data.toString().split("\n")) {
    if (!current) continue;
    if (command === "A") {
      current.reads = 1;
      current.reportRead = true;
    } else if (command === "R") {
      current.renegotiate();
    } else if (command === "D") {
      current.reads = Number.MAX_SAFE_INTEGER;
    } else if (command.startsWith("E ")) {
      current.expectTotal = Number(command.slice(2));
      current.reportTotal();
    }
  }
});
// The test process is gone: do not outlive it.
process.stdin.on("end", () => process.exit(0));

server.listen(0, "127.0.0.1", () => say(`READY ${server.address().port}`));
