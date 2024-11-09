//#FILE: test-net-stream.js
//#SHA1: 3682dee1fcd1fea4f59bbad200ab1476e0f49bda
//-----------------
"use strict";

const net = require("net");
const { once } = require("events");
const SIZE = 2e6;
const N = 10;
const buf = Buffer.alloc(SIZE, "a");
//TODO: need to check how to handle error on close events properly
test.skip("net stream behavior", async () => {
  let server;
  try {
    const { promise, resolve: done } = Promise.withResolvers();

    server = net.createServer(socket => {
      socket.setNoDelay();

      let onErrorCalls = 0;
      let onCloseCalls = 0;
      socket
        .on("error", () => {
          onErrorCalls++;
          socket.destroy();
        })
        .on("close", () => {
          onCloseCalls++;
          done({ onErrorCalls, onCloseCalls });
        });

      for (let i = 0; i < N; ++i) {
        socket.write(buf, () => {});
      }

      socket.end();
    });
    await once(server.listen(0), "listening");

    const conn = net.connect(server.address().port, "127.0.0.1");
    const { promise: dataPromise, resolve: dataResolve } = Promise.withResolvers();
    conn.on("data", buf => {
      dataResolve(conn.pause());
      setTimeout(() => {
        conn.destroy();
      }, 20);
    });
    expect(await dataPromise).toBe(conn);

    const { onCloseCalls, onErrorCalls } = await promise;
    expect(onErrorCalls).toBeGreaterThan(0);
    expect(onCloseCalls).toBeGreaterThan(0);
  } finally {
    server.close();
  }
});

//<#END_FILE: test-net-stream.js
