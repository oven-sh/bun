//#FILE: test-net-writable.js
//#SHA1: dfbbbc883e83311b16b93fc9e06d214552cb6448
//-----------------
"use strict";

const net = require("net");

test("net writable after end event", done => {
  const server = net.createServer(s => {
    server.close();
    s.end();
  });

  server.listen(0, "127.0.0.1", () => {
    const socket = net.connect(server.address().port, "127.0.0.1");
    socket.on("end", () => {
      expect(socket.writable).toBe(true);
      socket.write("hello world");
      done();
    });
  });

  expect.assertions(1);
});

//<#END_FILE: test-net-writable.js
