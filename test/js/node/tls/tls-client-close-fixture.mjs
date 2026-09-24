// How a TLS client's way of closing reaches the server. report(mode, version)
// makes one connection and resolves with what the server and the wire saw.
// node-tls-connect.test.ts runs it in bun and in node, and expects the same
// reports from both.
//
// The server asks for a client certificate and accepts any. A plain TCP relay
// in front of it records what the client sent:
// - `client` lists the 'error' and 'close' events of the client.
// - `server` is what the server saw: "secureConnection" with the CN of the
//   client certificate, the data it read and the error of its socket, or
//   "tlsClientError" with the error code.
// - `sentAfterClientHello` says whether the client sent anything after its
//   first record.
// - `alerts` counts the client's alert records. A TLS 1.3 alert travels as an
//   application data record of 19 bytes: the alert, the inner content type and
//   the AEAD tag. Nothing else a mode sends has that size.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const pem = name => readFileSync(join(keys, name));

function wire(bytes) {
  let alerts = 0;
  for (let at = 0; at + 5 <= bytes.length; at += 5 + bytes.readUInt16BE(at + 3)) {
    const type = bytes[at];
    if (type === 21 || (type === 23 && bytes.readUInt16BE(at + 3) === 19)) alerts++;
  }
  const clientHello = bytes.length >= 5 ? 5 + bytes.readUInt16BE(3) : 0;
  return { sentAfterClientHello: bytes.length > clientHello, alerts };
}

// What a 'secureConnect' listener does with the socket.
const inSecureConnect = {
  "end() then destroy()": socket => {
    socket.end();
    socket.destroy();
  },
};

export async function report(mode, version) {
  // agent1 is signed by ca1 and names only "agent1".
  const serverSaw = Promise.withResolvers();
  const server = tls.createServer({
    key: pem("agent1-key.pem"),
    cert: pem("agent1-cert.pem"),
    requestCert: true,
    rejectUnauthorized: false,
    minVersion: version,
    maxVersion: version,
  });
  server.on("secureConnection", socket => {
    const peerCN = socket.getPeerCertificate()?.subject?.CN ?? null;
    let data = "";
    let error = null;
    socket.on("data", chunk => (data += chunk));
    socket.on("error", err => (error = err.code));
    socket.on("close", () => serverSaw.resolve({ event: "secureConnection", peerCN, data, error }));
  });
  server.on("tlsClientError", error => serverSaw.resolve({ event: "tlsClientError", code: error.code }));
  await once(server.listen(0, "127.0.0.1"), "listening");

  const fromClient = [];
  const relay = net.createServer(downstream => {
    const upstream = net.connect(server.address().port, "127.0.0.1");
    downstream.on("data", chunk => {
      fromClient.push(chunk);
      upstream.write(chunk);
    });
    upstream.on("data", chunk => downstream.write(chunk));
    downstream.on("end", () => upstream.end());
    upstream.on("end", () => downstream.end());
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
  });
  await once(relay.listen(0, "127.0.0.1"), "listening");

  // `servername: "agent1"` is the name the certificate carries.
  const accepted = {
    host: "127.0.0.1",
    port: relay.address().port,
    ca: pem("ca1-cert.pem"),
    servername: "agent1",
    key: pem("agent3-key.pem"),
    cert: pem("agent3-cert.pem"),
  };

  const client = [];
  function watch(socket) {
    socket.on("error", error => client.push(`error:${error.code}`));
    return new Promise(resolve =>
      socket.on("close", hadError => {
        client.push(`close:${hadError}`);
        resolve();
      }),
    );
  }

  let closed;
  switch (mode) {
    case "end() then destroy() after the handshake": {
      const socket = tls.connect(accepted, () => setImmediate(inSecureConnect["end() then destroy()"], socket));
      closed = watch(socket);
      break;
    }
    default: {
      const act = inSecureConnect[mode];
      if (!act) throw new Error(`unknown mode ${mode}`);
      const socket = tls.connect(accepted, () => act(socket));
      closed = watch(socket);
    }
  }

  const [saw] = await Promise.all([serverSaw.promise, closed]);
  relay.close();
  server.close();
  return { client, server: saw, ...wire(Buffer.concat(fromClient)) };
}
