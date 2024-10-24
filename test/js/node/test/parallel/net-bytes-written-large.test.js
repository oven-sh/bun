//#FILE: test-net-bytes-written-large.js
//#SHA1: 9005801147f80a8058f1b2126d772e52abd1f237
//-----------------
"use strict";
const net = require("net");

const N = 10000000;

describe("Net bytes written large", () => {
  test("Write a Buffer", done => {
    const server = net
      .createServer(socket => {
        socket.end(Buffer.alloc(N), () => {
          expect(socket.bytesWritten).toBe(N);
        });
        expect(socket.bytesWritten).toBe(N);
      })
      .listen(0, () => {
        const client = net.connect(server.address().port);
        client.resume();
        client.on("close", () => {
          expect(client.bytesRead).toBe(N);
          server.close();
          done();
        });
      });
  });

  test("Write a string", done => {
    const server = net
      .createServer(socket => {
        socket.end("a".repeat(N), () => {
          expect(socket.bytesWritten).toBe(N);
        });
        expect(socket.bytesWritten).toBe(N);
      })
      .listen(0, () => {
        const client = net.connect(server.address().port);
        client.resume();
        client.on("close", () => {
          expect(client.bytesRead).toBe(N);
          server.close();
          done();
        });
      });
  });

  test("writev() with mixed data", done => {
    const server = net
      .createServer(socket => {
        socket.cork();
        socket.write("a".repeat(N));
        expect(socket.bytesWritten).toBe(N);
        socket.write(Buffer.alloc(N));
        expect(socket.bytesWritten).toBe(2 * N);
        socket.end("", () => {
          expect(socket.bytesWritten).toBe(2 * N);
        });
        socket.uncork();
      })
      .listen(0, () => {
        const client = net.connect(server.address().port);
        client.resume();
        client.on("close", () => {
          expect(client.bytesRead).toBe(2 * N);
          server.close();
          done();
        });
      });
  });
});

//<#END_FILE: test-net-bytes-written-large.js
