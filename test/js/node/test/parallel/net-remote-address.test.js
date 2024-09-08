//#FILE: test-net-remote-address.js
//#SHA1: a4c7e915b2d6465060b3d283c3cc3906ad629531
//-----------------
"use strict";

const net = require("net");

test("remote address behavior", done => {
  const server = net.createServer();

  server.listen(() => {
    const socket = net.connect({ port: server.address().port });

    expect(socket.connecting).toBe(true);
    expect(socket.remoteAddress).toBeUndefined();

    socket.on("connect", () => {
      expect(socket.remoteAddress).toBeDefined();
      socket.end();
    });

    socket.on("end", () => {
      server.close();
      done();
    });
  });
});

//<#END_FILE: test-net-remote-address.js
