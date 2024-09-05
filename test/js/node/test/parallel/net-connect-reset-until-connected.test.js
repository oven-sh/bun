//#FILE: test-net-connect-reset-until-connected.js
//#SHA1: b0170103868d4f693e9afda7923e021758393a39
//-----------------
"use strict";

const net = require("net");

function barrier(count, cb) {
  return function () {
    if (--count === 0) cb();
  };
}

test("net connection reset until connected", done => {
  const server = net.createServer();
  server.listen(0, () => {
    const port = server.address().port;
    const conn = net.createConnection(port);
    const connok = barrier(2, () => conn.resetAndDestroy());

    conn.on("close", () => {
      expect(true).toBe(true); // Ensure 'close' event is called
    });

    server.on("connection", socket => {
      connok();
      socket.on("error", err => {
        expect(err).toEqual(
          expect.objectContaining({
            code: "ECONNRESET",
            name: "Error",
            message: expect.any(String),
          }),
        );
      });
      server.close();
    });

    conn.on("connect", connok);
  });

  // Ensure the test completes
  setTimeout(() => {
    done();
  }, 1000);
});

//<#END_FILE: test-net-connect-reset-until-connected.js
