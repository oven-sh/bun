//#FILE: test-net-local-address-port.js
//#SHA1: 9fdb2786eb87ca722138e027be5ee72f04b9909c
//-----------------
"use strict";
const net = require("net");

const localhostIPv4 = "127.0.0.1";

describe("Net local address and port", () => {
  let server;
  let client;

  afterEach(() => {
    if (client) {
      client.destroy();
    }
    if (server && server.listening) {
      server.close();
    }
  });

  test("should have correct local address, port, and family", done => {
    server = net.createServer(socket => {
      expect(socket.localAddress).toBe(localhostIPv4);
      expect(socket.localPort).toBe(server.address().port);
      expect(socket.localFamily).toBe(server.address().family);

      socket.resume();
    });

    server.listen(0, localhostIPv4, () => {
      client = net.createConnection(server.address().port, localhostIPv4);
      client.on("connect", () => {
        client.end();
        // We'll end the test here instead of waiting for the server to close
        done();
      });
    });
  });
});

//<#END_FILE: test-net-local-address-port.js
