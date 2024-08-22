//#FILE: test-net-write-fully-async-hex-string.js
//#SHA1: e5b365bb794f38e7153fc41ebfaf991031f85423
//-----------------
"use strict";
// Flags: --expose-gc

// Regression test for https://github.com/nodejs/node/issues/8251.
const net = require("net");

const data = Buffer.alloc(1000000).toString("hex");

test("net write fully async hex string", done => {
  const server = net
    .createServer(conn => {
      conn.resume();
    })
    .listen(0, () => {
      const conn = net.createConnection(server.address().port, () => {
        let count = 0;

        function writeLoop() {
          if (count++ === 20) {
            conn.destroy();
            server.close();
            done();
            return;
          }

          while (conn.write(data, "hex"));
          global.gc({ type: "minor" });
          // The buffer allocated inside the .write() call should still be alive.
        }

        conn.on("drain", writeLoop);

        writeLoop();
      });
    });

  expect.assertions(2);
  server.on("listening", () => {
    expect(server.address().port).toBeGreaterThan(0);
  });
  server.on("connection", () => {
    expect(true).toBe(true); // Connection established
  });
});

//<#END_FILE: test-net-write-fully-async-hex-string.js
