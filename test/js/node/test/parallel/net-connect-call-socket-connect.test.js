//#FILE: test-net-connect-call-socket-connect.js
//#SHA1: 953a427c411633a029dcf978ea07fb701ae5ed9a
//-----------------
"use strict";

const net = require("net");
const Socket = net.Socket;

// This test checks that calling `net.connect` internally calls
// `Socket.prototype.connect`.
//
// This is important for people who monkey-patch `Socket.prototype.connect`
// since it's not possible to monkey-patch `net.connect` directly (as the core
// `connect` function is called internally in Node instead of calling the
// `exports.connect` function).
//
// Monkey-patching of `Socket.prototype.connect` is done by - among others -
// most APM vendors, the async-listener module and the
// continuation-local-storage module.
//
// Related:
// - https://github.com/nodejs/node/pull/12342
// - https://github.com/nodejs/node/pull/12852

test("net.connect calls Socket.prototype.connect", async () => {
  // Monkey patch Socket.prototype.connect to check that it's called.
  const orig = Socket.prototype.connect;
  const connectMock = jest.fn(function () {
    return orig.apply(this, arguments);
  });
  Socket.prototype.connect = connectMock;

  const server = net.createServer();

  await new Promise(resolve => {
    server.listen(() => {
      const port = server.address().port;
      const client = net.connect({ port }, () => {
        client.end();
      });
      client.on("end", () => {
        server.close(resolve);
      });
    });
  });

  expect(connectMock).toHaveBeenCalledTimes(1);

  // Restore original Socket.prototype.connect
  Socket.prototype.connect = orig;
});

//<#END_FILE: test-net-connect-call-socket-connect.js
