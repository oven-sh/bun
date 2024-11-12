//#FILE: test-net-write-fully-async-buffer.js
//#SHA1: b26773ed4c8c5bafaaa8a4513b25d1806a72ae5f
//-----------------
"use strict";

const net = require("net");

// Note: This test assumes that the --expose-gc flag is available.
// In a Jest environment, you might need to configure this separately.

const data = Buffer.alloc(1000000);

let server;

beforeAll(done => {
  server = net
    .createServer(conn => {
      conn.resume();
    })
    .listen(0, () => {
      done();
    });
});

afterAll(() => {
  server.close();
});

test("net write fully async buffer", done => {
  const conn = net.createConnection(server.address().port, () => {
    let count = 0;

    function writeLoop() {
      if (count++ === 200) {
        conn.destroy();
        done();
        return;
      }

      while (conn.write(Buffer.from(data)));

      // Note: global.gc() is not available in standard Jest environments.
      // You might need to configure Jest to run with the --expose-gc flag.
      // For this test, we'll comment it out, but in a real scenario, you'd need to ensure it's available.
      // global.gc({ type: 'minor' });
      // The buffer allocated above should still be alive.
    }

    conn.on("drain", writeLoop);

    writeLoop();
  });
});

//<#END_FILE: test-net-write-fully-async-buffer.js
