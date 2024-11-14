//#FILE: test-net-listen-after-destroying-stdin.js
//#SHA1: 933b6b80e7babac7189e16f85967b75836efea74
//-----------------
"use strict";

// Just test that destroying stdin doesn't mess up listening on a server.
// This is a regression test for
// https://github.com/nodejs/node-v0.x-archive/issues/746.

const net = require("net");

test("destroying stdin does not affect server listening", done => {
  process.stdin.destroy();

  const server = net.createServer(socket => {
    console.log("accepted...");
    socket.end(() => {
      console.log("finished...");
      expect(true).toBe(true); // Ensure this callback is called
    });
    server.close(() => {
      console.log("closed");
      expect(true).toBe(true); // Ensure this callback is called
      done();
    });
  });

  server.listen(0, () => {
    console.log("listening...");
    expect(server.address().port).toBeGreaterThan(0);

    net.createConnection(server.address().port);
  });
});

//<#END_FILE: test-net-listen-after-destroying-stdin.js
