// A TLS server that turns the client down once its own handshake is done.
// report(mode, version) makes one connection and resolves with what both
// sides saw. node-tls-connect.test.ts runs it in bun and in node, and expects
// the same reports from both.
//
// In a full TLS 1.2 handshake the server's Finished is the last message, and
// the server's handshake callback runs before it is sent. In TLS 1.3 the
// server has nothing left to send at that point.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const pem = name => readFileSync(join(keys, name));

// One application data record that does not decrypt.
const junkRecord = Buffer.concat([Buffer.from([23, 3, 3, 0, 16]), Buffer.alloc(16, 0xa5)]);
const junkMode = "destroy() in 'secureConnection' with a junk record behind the client's Finished";
const wrapMode = "destroy() in 'secure' of a TLSSocket that wraps the connection";

export async function report(mode, version) {
  // The client certificate (agent3) is not signed by ca1, so the server cannot verify it.
  const serverDone = Promise.withResolvers();
  let serverEvent = null;
  const options = {
    key: pem("agent1-key.pem"),
    cert: pem("agent1-cert.pem"),
    ca: pem("ca1-cert.pem"),
    requestCert: true,
    rejectUnauthorized: mode === "requestCert and rejectUnauthorized",
    minVersion: version,
    maxVersion: version,
  };
  const server =
    mode === wrapMode
      ? net.createServer(raw => {
          raw.on("error", () => {});
          const socket = new tls.TLSSocket(raw, { ...options, isServer: true });
          socket.on("error", () => {});
          socket.on("close", () => serverDone.resolve());
          socket.on("secure", () => {
            serverEvent = "secure";
            socket.destroy();
          });
        })
      : tls.createServer(options);
  server.on("secureConnection", socket => {
    serverEvent = "secureConnection";
    socket.on("error", () => {});
    socket.on("close", () => serverDone.resolve());
    if (mode.startsWith("destroy()")) socket.destroy();
    else socket.end();
  });
  server.on("tlsClientError", () => {
    serverEvent = "tlsClientError";
    serverDone.resolve();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  // Puts the junk record behind the flight that ends with the client's Finished, in the same write. In TLS 1.2 that
  // flight ends with the record behind the client's ChangeCipherSpec.
  const relay = net.createServer(downstream => {
    const upstream = net.connect(server.address().port, "127.0.0.1");
    let pending = Buffer.alloc(0);
    let held = [];
    let behindChangeCipherSpec = false;
    downstream.on("data", chunk => {
      if (mode !== junkMode || !held) return void upstream.write(chunk);
      pending = Buffer.concat([pending, chunk]);
      while (held && pending.length >= 5 && pending.length >= 5 + pending.readUInt16BE(3)) {
        const record = pending.subarray(0, 5 + pending.readUInt16BE(3));
        pending = pending.subarray(record.length);
        // The ClientHello goes through at once.
        if (!held.length && record[0] === 22 && record[5] === 1) upstream.write(record);
        else held.push(record);
        if (behindChangeCipherSpec) {
          upstream.write(Buffer.concat([...held, junkRecord, pending]));
          held = null;
        }
        behindChangeCipherSpec = record[0] === 20;
      }
    });
    upstream.on("data", chunk => downstream.write(chunk));
    downstream.on("end", () => upstream.end());
    upstream.on("end", () => downstream.end());
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
  });
  await once(relay.listen(0, "127.0.0.1"), "listening");

  const client = { secureConnect: false, error: null };
  const socket = tls.connect({
    host: "127.0.0.1",
    port: relay.address().port,
    ca: pem("ca1-cert.pem"),
    servername: "agent1",
    key: pem("agent3-key.pem"),
    cert: pem("agent3-cert.pem"),
  });
  socket.on("secureConnect", () => (client.secureConnect = true));
  socket.on("error", error => (client.error = error.code));
  socket.resume();
  await Promise.all([new Promise(resolve => socket.on("close", resolve)), serverDone.promise]);
  relay.close();
  server.close();
  return { client, server: serverEvent };
}
