//#FILE: test-net-end-destroyed.js
//#SHA1: cf219496c5dd2cb11f3d01750692b61791c7e2f9
//-----------------
"use strict";

const net = require("net");

test('socket is not destroyed when the "end" event is emitted', done => {
  const server = net.createServer();

  server.on("connection", () => {
    // Connection event handler
  });

  // Ensure that the socket is not destroyed when the 'end' event is emitted.

  server.listen(() => {
    const socket = net.createConnection({
      port: server.address().port,
    });

    socket.on("connect", () => {
      socket.on("end", () => {
        expect(socket.destroyed).toBe(false);
        server.close();
        done();
      });

      socket.end();
    });
  });
});

//<#END_FILE: test-net-end-destroyed.js
