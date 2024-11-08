//#FILE: test-net-sync-cork.js
//#SHA1: baf95df782bcb1c53ea0118e8e47e93d63cf4262
//-----------------
"use strict";

const net = require("net");

const N = 100;
const buf = Buffer.alloc(2, "a");

let server;

beforeAll(done => {
  server = net.createServer(handle);
  server.listen(0, done);
});

afterAll(() => {
  server.close();
});

test("net sync cork", done => {
  const conn = net.connect(server.address().port);

  conn.on("connect", () => {
    let res = true;
    let i = 0;
    for (; i < N && res; i++) {
      conn.cork();
      conn.write(buf);
      res = conn.write(buf);
      conn.uncork();
    }
    expect(i).toBe(N);
    conn.end();
  });

  conn.on("close", done);
});

function handle(socket) {
  socket.resume();
  socket.on("error", () => {
    throw new Error("Socket error should not occur");
  });
  socket.on("close", () => {
    // This is called when the connection is closed
  });
}

//<#END_FILE: test-net-sync-cork.js
