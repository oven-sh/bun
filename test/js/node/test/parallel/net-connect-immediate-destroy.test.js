//#FILE: test-net-connect-immediate-destroy.js
//#SHA1: 28ba78fafba37cb07a2ec4b18e3e35bbb78ef699
//-----------------
"use strict";
const net = require("net");

test("net.connect immediate destroy", done => {
  const server = net.createServer();
  server.listen(0, () => {
    const port = server.address().port;
    const socket = net.connect(port, "127.0.0.1");

    socket.on("connect", () => {
      throw new Error("Socket should not connect");
    });

    socket.on("error", () => {
      throw new Error("Socket should not emit error");
    });

    server.close(() => {
      socket.destroy();
      done();
    });
  });
});

//<#END_FILE: test-net-connect-immediate-destroy.js
