//#FILE: test-net-write-after-end-nt.js
//#SHA1: 086a5699d5eff4953af4e9f19757b8489e915579
//-----------------
"use strict";

const net = require("net");

// This test ensures those errors caused by calling `net.Socket.write()`
// after sockets ending will be emitted in the next tick.
test("net.Socket.write() after end emits error in next tick", done => {
  const server = net
    .createServer(socket => {
      socket.end();
    })
    .listen(() => {
      const client = net.connect(server.address().port, () => {
        let hasError = false;
        client.on("error", err => {
          hasError = true;
          server.close();
          done();
        });
        client.on("end", () => {
          const ret = client.write("hello");

          expect(ret).toBe(false);
          expect(hasError).toBe(false);

          // Check that the error is emitted in the next tick
          setImmediate(() => {
            expect(hasError).toBe(true);
          });
        });
        client.end();
      });
    });
});

//<#END_FILE: test-net-write-after-end-nt.js
