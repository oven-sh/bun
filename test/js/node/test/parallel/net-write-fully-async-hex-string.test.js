//#FILE: test-net-write-fully-async-hex-string.js
//#SHA1: e5b365bb794f38e7153fc41ebfaf991031f85423
//-----------------
"use strict";

const net = require("net");

let server;

afterAll(() => {
  if (server) {
    server.close();
  }
});

test("net write fully async hex string", done => {
  const data = Buffer.alloc(1000000).toString("hex");

  server = net.createServer(conn => {
    conn.resume();
  });

  server.listen(0, () => {
    const conn = net.createConnection(server.address().port, () => {
      let count = 0;

      function writeLoop() {
        if (count++ === 20) {
          conn.destroy();
          done();
          return;
        }
        while (conn.write(data, "hex"));
        // Note: We can't use global.gc in Jest, so we'll skip this part
        // global.gc({ type: 'minor' });
        // The buffer allocated inside the .write() call should still be alive.

        // Use setImmediate to allow other operations to occur
        setImmediate(writeLoop);
      }

      conn.on("drain", writeLoop);

      writeLoop();
    });
  });
});

//<#END_FILE: test-net-write-fully-async-hex-string.js
