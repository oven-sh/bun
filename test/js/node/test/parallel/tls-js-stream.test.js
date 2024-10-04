//#FILE: test-tls-js-stream.js
//#SHA1: 90a8d9d14bac997dbf3abb56da784bfcba8efee6
//-----------------
"use strict";

const fixtures = require("../common/fixtures");
const net = require("net");
const stream = require("stream");
const tls = require("tls");

if (!tls.createSecureContext) {
  test.skip("missing crypto");
}

test("TLS over JavaScript stream", done => {
  const server = tls.createServer(
    {
      key: fixtures.readKey("agent1-key.pem"),
      cert: fixtures.readKey("agent1-cert.pem"),
    },
    c => {
      console.log("new client");
      c.resume();
      c.end("ohai");
    },
  );

  server.listen(0, () => {
    const raw = net.connect(server.address().port);

    let pending = false;
    raw.on("readable", () => {
      if (pending) p._read();
    });

    raw.on("end", () => {
      p.push(null);
    });

    const p = new stream.Duplex({
      read: function read() {
        pending = false;

        const chunk = raw.read();
        if (chunk) {
          console.log("read", chunk);
          this.push(chunk);
        } else {
          pending = true;
        }
      },
      write: function write(data, enc, cb) {
        console.log("write", data, enc);
        raw.write(data, enc, cb);
      },
    });

    const socket = tls.connect(
      {
        socket: p,
        rejectUnauthorized: false,
      },
      () => {
        console.log("client secure");
        socket.resume();
        socket.end("hello");
      },
    );

    socket.once("close", () => {
      console.log("client close");
      server.close();
      done();
    });
  });
});

//<#END_FILE: test-tls-js-stream.js
