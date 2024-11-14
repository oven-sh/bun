//#FILE: test-net-socket-destroy-twice.js
//#SHA1: b9066749198a610e24f0b75c017f00abb3c70bfc
//-----------------
"use strict";

const net = require("net");

describe("Net socket destroy twice", () => {
  let server;
  let port;

  beforeAll((done) => {
    server = net.createServer();
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  test("should handle destroying a socket twice", (done) => {
    const conn = net.createConnection(port, "127.0.0.1");

    let errorCalled = 0;
    conn.on("error", () => {
      errorCalled++;
      conn.destroy();
    });

    conn.on("close", () => {
      expect(errorCalled).toBe(1);
      done();
    });

    // Trigger an error by closing the server
    server.close();
  });
});

//<#END_FILE: test-net-socket-destroy-twice.js
