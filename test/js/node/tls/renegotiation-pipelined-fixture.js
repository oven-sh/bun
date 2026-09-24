// Run with node: its OpenSSL server can start a renegotiation.
//
// A TLS 1.2 server whose chain verifies under ca1 and whose certificate names
// only "agent1". It asks for no client certificate in the first handshake. It
// renegotiates from 'secureConnection' and asks for one there. The relay in
// front of it forwards the server's ChangeCipherSpec, Finished and
// HelloRequest in one write, so the client reads the renegotiation request in
// the pass that completes its first handshake.
//
// stdout: the relay's port, then one JSON line for each connection that ends:
// the CN of the client certificate the server got, or null.
const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const pem = name => fs.readFileSync(path.join(process.env.KEYS, name), "utf8");
const CHANGE_CIPHER_SPEC = 20;

const server = tls.createServer(
  {
    cert: pem("agent1-cert.pem"),
    key: pem("agent1-key.pem"),
    ca: pem("ca2-cert.pem"),
    requestCert: false,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
  },
  socket => {
    let peerCN = null;
    socket.on("error", () => {});
    socket.on("close", () => console.log(JSON.stringify({ peerCN })));
    socket.renegotiate({ requestCert: true, rejectUnauthorized: false }, err => {
      if (!err) peerCN = socket.getPeerCertificate()?.subject?.CN ?? null;
      socket.end();
    });
  },
);
server.on("tlsClientError", () => console.log(JSON.stringify({ peerCN: null })));

server.listen(0, "127.0.0.1", () => {
  const relay = net.createServer(client => {
    const upstream = net.connect(server.address().port, "127.0.0.1");
    client.on("error", () => {});
    upstream.on("error", () => {});
    client.pipe(upstream);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());

    // Hold the ChangeCipherSpec record until the two records after it are
    // here: the Finished and the HelloRequest.
    let buffered = Buffer.alloc(0);
    let held = [];
    let released = false;
    upstream.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 5) {
        const length = 5 + buffered.readUInt16BE(3);
        if (buffered.length < length) break;
        const record = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        if (released || (held.length === 0 && record[0] !== CHANGE_CIPHER_SPEC)) {
          client.write(record);
          continue;
        }
        held.push(record);
        if (held.length === 3) {
          client.write(Buffer.concat(held));
          released = true;
        }
      }
    });
  });
  relay.listen(0, "127.0.0.1", () => console.log(relay.address().port));
});
