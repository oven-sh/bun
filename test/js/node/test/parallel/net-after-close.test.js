//#FILE: test-net-after-close.js
//#SHA1: 5b16857d2580262739b7c74c87a520ee6fc974c9
//-----------------
"use strict";
const net = require("net");

let server;
let serverPort;

beforeAll(done => {
  server = net.createServer(s => {
    s.end();
  });

  server.listen(0, () => {
    serverPort = server.address().port;
    done();
  });
});

afterAll(done => {
  server.close(done);
});

test("net socket behavior after close", done => {
  const c = net.createConnection(serverPort);

  c.on("close", () => {
    expect(c._handle).toBeNull();

    // Calling functions / accessing properties of a closed socket should not throw.
    expect(() => {
      c.setNoDelay();
      c.setKeepAlive();
      c.bufferSize;
      c.pause();
      c.resume();
      c.address();
      c.remoteAddress;
      c.remotePort;
    }).not.toThrow();

    done();
  });
});

//<#END_FILE: test-net-after-close.js
