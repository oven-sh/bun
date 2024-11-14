//#FILE: test-tls-net-socket-keepalive.js
//#SHA1: 9ae6965b63d37c0f9cb2ab7d068d4da2a68b8b1f
//-----------------
"use strict";

const fixtures = require("../common/fixtures");
const tls = require("tls");
const net = require("net");

// This test ensures that when tls sockets are created with `allowHalfOpen`,
// they won't hang.
const key = fixtures.readKey("agent1-key.pem");
const cert = fixtures.readKey("agent1-cert.pem");
const ca = fixtures.readKey("ca1-cert.pem");
const options = {
  key,
  cert,
  ca: [ca],
};

test("TLS sockets with allowHalfOpen do not hang", done => {
  const server = tls.createServer(options, conn => {
    conn.write("hello", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
    });
    conn.on("data", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
    });
    conn.on("end", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
    });
    conn.on("data", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
    });
    conn.on("close", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
    });
    conn.end();
  });

  server.listen(0, () => {
    const netSocket = new net.Socket({
      allowHalfOpen: true,
    });

    const socket = tls.connect({
      socket: netSocket,
      rejectUnauthorized: false,
    });

    const { port, address } = server.address();

    // Doing `net.Socket.connect()` after `tls.connect()` will make tls module
    // wrap the socket in StreamWrap.
    netSocket.connect({
      port,
      address,
    });

    socket.on("secureConnect", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
    });
    socket.on("end", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
    });
    socket.on("data", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
    });
    socket.on("close", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
      server.close();
      done();
    });

    socket.write("hello");
    socket.end();
  });
});

//<#END_FILE: test-tls-net-socket-keepalive.js
