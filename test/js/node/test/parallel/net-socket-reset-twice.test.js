//#FILE: test-net-socket-reset-twice.js
//#SHA1: 70cb2037a6385ada696f8b9f8fa66a0b111275c4
//-----------------
"use strict";
const net = require("net");

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

test("net socket reset twice", (done) => {
  const conn = net.createConnection(port, "127.0.0.1");

  const errorHandler = jest.fn(() => {
    conn.resetAndDestroy();
  });

  conn.on("error", errorHandler);

  const closeHandler = jest.fn(() => {
    expect(errorHandler).toHaveBeenCalled();
    expect(closeHandler).toHaveBeenCalled();
    done();
  });

  conn.on("close", closeHandler);

  // Trigger the error event
  server.close();
});

//<#END_FILE: test-net-socket-reset-twice.js
