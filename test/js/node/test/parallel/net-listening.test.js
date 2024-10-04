//#FILE: test-net-listening.js
//#SHA1: 3c2824f7bd90fec69702e096faba0b4f07353a20
//-----------------
"use strict";
const net = require("net");

test("Server listening state", done => {
  const server = net.createServer();

  expect(server.listening).toBe(false);

  server.listen(0, () => {
    expect(server.listening).toBe(true);

    server.close(() => {
      expect(server.listening).toBe(false);
      done();
    });
  });
});

//<#END_FILE: test-net-listening.js
