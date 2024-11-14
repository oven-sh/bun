//#FILE: test-net-socket-connect-without-cb.js
//#SHA1: 2441c4dfe4351f2e9a02cd08df36e4703096864a
//-----------------
"use strict";

const net = require("net");

// This test ensures that socket.connect can be called without callback
// which is optional.

test("socket.connect without callback", done => {
  const server = net
    .createServer(conn => {
      conn.end();
      server.close();
    })
    .listen(0, () => {
      const client = new net.Socket();

      client.on("connect", () => {
        client.end();
        done();
      });

      const address = server.address();
      if (process.version.startsWith("v") && !process.versions.bun && address.family === "IPv6") {
        // Necessary to pass CI running inside containers.
        client.connect(address.port);
      } else {
        client.connect(address);
      }
    });

  expect(server).toBeDefined();
});

//<#END_FILE: test-net-socket-connect-without-cb.js
