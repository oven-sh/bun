// TLS 1.2 server for the tests that mix a renegotiation with an upload that is
// under write backpressure. Runs in Node, because a Bun server does not
// renegotiate. It reads nothing on its own. The test drives it over stdin, so
// no step depends on relative speeds. A command applies to the latest
// connection:
//
//   A <n>  ->  read <n> more bytes, stop, then report READ. The test asks for
//              a fraction of what the client had to write to fill the
//              connection: enough to reopen the receive window, which gives
//              the client room for a record, and far too little to make the
//              client writable.
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
      readUntil: 0,
      reportRead: false,
      closed: false,
      offset: 0,
      mismatchAt: -1,
      expectTotal: Infinity,
      tell(what) {
        say(`${id} ${what} mismatchAt=${connection.mismatchAt}`);
      },
      renegotiate() {
        socket.renegotiate({}, error =>
          connection.tell(`RENEG_DONE err=${error ? error.code || error.message : "null"}`),
        );
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
      while (connection.offset < connection.readUntil) {
        const chunk = socket.read();
        if (!chunk) break;
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] !== (connection.offset + i) % 251) {
            if (connection.mismatchAt < 0) connection.mismatchAt = connection.offset + i;
            break;
          }
        }
        connection.offset += chunk.length;
        connection.reportTotal();
      }
      if (connection.reportRead && connection.offset >= connection.readUntil) {
        connection.reportRead = false;
        connection.tell("READ");
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
    if (command.startsWith("A ")) {
      current.readUntil = current.offset + Number(command.slice(2));
      current.reportRead = true;
    } else if (command === "R") {
      current.renegotiate();
    } else if (command === "D") {
      current.readUntil = Infinity;
    } else if (command.startsWith("E ")) {
      current.expectTotal = Number(command.slice(2));
      current.reportTotal();
    }
  }
});
// The test process is gone: do not outlive it.
process.stdin.on("end", () => process.exit(0));

server.listen(0, "127.0.0.1", () => say(`READY ${server.address().port}`));
