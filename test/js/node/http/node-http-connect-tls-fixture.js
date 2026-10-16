// A CONNECT proxy that ends TLS itself: its 'connect' listener puts a server-side TLS socket on the
// tunnel. Nothing reads that TLS socket, and the client sends more than it buffers, so its reads
// stop. Then the proxy shuts down the graceful way: server.close(), no process.exit(). The
// process must exit by itself.
//
//   MODE: "TLSSocket" (new tls.TLSSocket(socket, { isServer: true })), "unref" (the same, and
//         unref() on it) or "emit" (a tls.Server gets the socket as its 'connection').
//   CERT and KEY: the certificate of the proxy.
"use strict";
const http = require("node:http");
const net = require("node:net");
const tls = require("node:tls");

const { CERT: cert, KEY: key, MODE } = process.env;
const result = {};

const tlsServer = tls.createServer({ cert, key }, secure => secure.on("error", () => {}));
const proxy = http.createServer();
proxy.on("connect", (req, socket) => {
  socket.on("error", () => {});
  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (MODE === "emit") return void tlsServer.emit("connection", socket);
  const secure = new tls.TLSSocket(socket, { isServer: true, cert, key });
  secure.on("error", () => {});
  if (MODE === "unref") secure.unref();
});

proxy.listen(0, "127.0.0.1", () => {
  // The client is in this process and does not keep it alive.
  const client = net.connect(proxy.address().port, "127.0.0.1");
  client.on("error", () => {});
  client.unref();
  client.write("CONNECT a:443 HTTP/1.1\r\nHost: a:443\r\n\r\n");
  client.once("data", () => {
    const secure = tls.connect({ socket: client, rejectUnauthorized: false });
    secure.on("error", () => {});
    secure.once("secureConnect", () => {
      result.handshake = true;
      // More than the TLS socket of the proxy buffers.
      if (MODE !== "unref") secure.write(Buffer.alloc(1024 * 1024, "x"));
      proxy.close();
    });
  });
});

process.on("exit", () => console.log(JSON.stringify(result)));
