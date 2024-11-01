//#FILE: test-net-write-after-close.js
//#SHA1: fe97d63608f4e6651247e83071c81800a6de2ee6
//-----------------
"use strict";

const net = require("net");

let serverSocket;
let server;

beforeAll(done => {
  server = net.createServer(socket => {
    serverSocket = socket;
    socket.resume();
    socket.on("error", error => {
      throw new Error("Server socket should not emit error");
    });
  });

  server.listen(0, () => {
    done();
  });
});

afterAll(() => {
  server.close();
});

test("write after close", done => {
  const client = net.connect(server.address().port, "127.0.0.1", () => {
    client.on("end", () => {
      serverSocket.write("test", err => {
        expect(err).toBeTruthy();
        done();
      });
    });
    client.end();
  });
});

//<#END_FILE: test-net-write-after-close.js
