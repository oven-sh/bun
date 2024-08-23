//#FILE: test-net-socket-close-after-end.js
//#SHA1: d3abfad3599a4245fb35f5589c55bb56a43ca3f7
//-----------------
"use strict";

const net = require("net");

test('socket emits "end" before "close"', done => {
  const server = net.createServer();

  server.on("connection", socket => {
    let endEmitted = false;

    socket.once("readable", () => {
      setTimeout(() => {
        socket.read();
      }, 100);
    });

    socket.on("end", () => {
      endEmitted = true;
    });

    socket.on("close", () => {
      expect(endEmitted).toBe(true);
      server.close();
      done();
    });

    socket.end("foo");
  });

  server.listen(() => {
    const socket = net.createConnection(server.address().port, () => {
      socket.end("foo");
    });
  });
});

//<#END_FILE: test-net-socket-close-after-end.js
