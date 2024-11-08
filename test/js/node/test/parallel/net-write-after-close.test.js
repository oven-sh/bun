//#FILE: test-net-write-after-close.js
//#SHA1: fe97d63608f4e6651247e83071c81800a6de2ee6
//-----------------
"use strict";

const net = require("net");

test("write after close", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const { promise: writePromise, resolve: writeResolve } = Promise.withResolvers();
  let server;
  try {
    server = net.createServer(socket => {
      socket.on("end", () => resolve(socket));
      socket.resume();
      socket.on("error", error => {
        throw new Error("Server socket should not emit error");
      });
    });

    server.listen(0, () => {
      const client = net.connect(server.address().port, "127.0.0.1", () => {
        client.end();
      });
    });
    (await promise).write("test", writeResolve);
    const err = await writePromise;
    expect(err).toBeTruthy();
  } finally {
    server.close();
  }
});

//<#END_FILE: test-net-write-after-close.js
