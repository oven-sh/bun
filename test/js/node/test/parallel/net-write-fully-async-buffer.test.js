//#FILE: test-net-write-fully-async-buffer.js
//#SHA1: b26773ed4c8c5bafaaa8a4513b25d1806a72ae5f
//-----------------
"use strict";
// Flags: --expose-gc

// Note: This is a variant of test-net-write-fully-async-hex-string.js.
// This always worked, but it seemed appropriate to add a test that checks the
// behavior for Buffers, too.
const net = require("net");

const data = Buffer.alloc(1000000);

test("net write fully async buffer", done => {
  const server = net
    .createServer(conn => {
      conn.resume();
    })
    .listen(0, () => {
      const conn = net.createConnection(server.address().port, () => {
        let count = 0;

        function writeLoop() {
          if (count++ === 200) {
            conn.destroy();
            server.close();
            done();
            return;
          }

          while (conn.write(Buffer.from(data)));
          global.gc({ type: "minor" });
          // The buffer allocated above should still be alive.
        }

        conn.on("drain", writeLoop);

        writeLoop();
      });
    });

  expect(server.listening).toBe(true);
});

//<#END_FILE: test-net-write-fully-async-buffer.js
