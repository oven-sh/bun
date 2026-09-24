// A TLS client that turns the server down once its own handshake is done, as
// one report per mode. Runs on bun and on node, so node-tls-connect.test.ts can
// assert the same report for both.
//
// The server asks for a client certificate and accepts any. `server` is what
// it saw of the connection: "secureConnection" with the CN of the client
// certificate and the data it read, or "tlsClientError" with the error code.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const [mode, version] = process.argv.slice(2);
const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const pem = name => readFileSync(join(keys, name));

// agent1 is signed by ca1 and names only "agent1".
const serverSaw = Promise.withResolvers();
const server = tls.createServer({
  key: pem("agent1-key.pem"),
  cert: pem("agent1-cert.pem"),
  requestCert: true,
  rejectUnauthorized: false,
  minVersion: version,
  maxVersion: version,
  ALPNProtocols: mode === "http2.connect" ? ["h2"] : undefined,
});
server.on("secureConnection", socket => {
  const peerCN = socket.getPeerCertificate()?.subject?.CN ?? null;
  let data = "";
  socket.on("data", chunk => (data += chunk));
  socket.on("error", () => {});
  socket.on("close", () => serverSaw.resolve({ event: "secureConnection", peerCN, data }));
});
server.on("tlsClientError", error => serverSaw.resolve({ event: "tlsClientError", code: error.code }));
await once(server.listen(0, "127.0.0.1"), "listening");

const port = server.address().port;
const identity = { key: pem("agent3-key.pem"), cert: pem("agent3-cert.pem") };
// `servername: "agent1"` is the name the certificate carries.
const accepted = { host: "127.0.0.1", port, ca: pem("ca1-cert.pem"), servername: "agent1", ...identity };

const client = { events: [] };
function watch(socket) {
  socket.on("error", error => client.events.push(`error:${error.code}`));
  return new Promise(resolve =>
    socket.on("close", hadError => {
      client.events.push(`close:${hadError}`);
      resolve();
    }),
  );
}

let closed;
switch (mode) {
  case "checkServerIdentity":
    closed = watch(tls.connect({ ...accepted, servername: "not-agent1" }));
    break;
  case "checkServerIdentity function": {
    const checkServerIdentity = () => Object.assign(new Error("not the pinned key"), { code: "ERR_PINNED_KEY" });
    closed = watch(tls.connect({ ...accepted, checkServerIdentity }));
    break;
  }
  case "tls.connect({ socket })": {
    const raw = net.connect(port, "127.0.0.1");
    raw.on("error", () => {});
    await once(raw, "connect");
    closed = watch(tls.connect({ ...accepted, socket: raw, servername: "not-agent1" }));
    break;
  }
  case "https.request": {
    const request = https.request({ ...accepted, servername: "not-agent1", agent: false });
    closed = new Promise(resolve =>
      request.on("error", error => {
        client.events.push(`error:${error.code}`);
        resolve();
      }),
    );
    request.end();
    break;
  }
  case "http2.connect": {
    const session = http2.connect(`https://127.0.0.1:${port}`, { ...accepted, servername: "not-agent1" });
    session.on("error", error => client.events.push(`error:${error.code}`));
    closed = new Promise(resolve => session.on("close", resolve));
    break;
  }
  default: {
    const act = {
      "destroy()": socket => socket.destroy(),
      "destroy(error)": socket => socket.destroy(Object.assign(new Error("refused"), { code: "ERR_REFUSED" })),
      "end()": socket => socket.end(),
      "write() then destroy()": socket => {
        socket.write("hello");
        socket.destroy();
      },
    }[mode];
    if (!act) throw new Error(`unknown mode ${mode}`);
    const socket = tls.connect(accepted, () => act(socket));
    closed = watch(socket);
  }
}

const [saw] = await Promise.all([serverSaw.promise, closed]);
server.close();
console.log(JSON.stringify({ client: client.events, server: saw }));
process.exit(0);
