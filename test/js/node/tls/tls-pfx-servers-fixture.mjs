// Servers that take their identity from a PKCS#12 bundle, for node-tls-context.test.ts.
// agent1.pfx holds the key and the certificate of agent1, and the certificate of ca1.
// Each server requests a client certificate, and tells the client what it made of it.
//
// Start it with an IPC channel, and with NODE_EXTRA_CA_CERTS=<keys>/ca2-cert.pem: ca2 is then a default root of
// this process. It sends { route: "ready" }. Then, for each name of a route below that its parent sends, it starts
// the servers of that route and answers { route, addresses: { identity: port or pipe } }.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const pem = name => readFileSync(join(keys, name));

const pfx = { pfx: pem("agent1.pfx"), passphrase: "sample" };
const identities = {
  "pfx": pfx,
  // ca3 issued no client certificate.
  "pfx and ca": { ...pfx, ca: pem("ca3-cert.pem") },
};

const mutualTLS = { requestCert: true, rejectUnauthorized: false };
const otherIdentity = { key: pem("agent2-key.pem"), cert: pem("agent2-cert.pem") };
const servername = "pfx.example";
const verdict = socket => (socket.authorized ? "authorized" : String(socket.authorizationError));
const answer = socket => socket.end(verdict(socket));
const respond = (req, res) => res.end(verdict(req.socket));
const listen = async (server, ...address) => {
  await once(address.length ? server.listen(...address) : server.listen(0, "127.0.0.1"), "listening");
  return server;
};

// Each returns a server that listens, and that has `identity` by the time a client connects.
const routes = {
  "tls.createServer": identity => listen(tls.createServer({ ...identity, ...mutualTLS }, answer)),
  "tls.Server#setSecureContext": identity => {
    const server = tls.createServer({ ...otherIdentity, ...mutualTLS }, answer);
    server.setSecureContext(identity);
    return listen(server);
  },
  "tls.Server#setSecureContext while listening": async identity => {
    const server = await listen(tls.createServer({ ...otherIdentity, ...mutualTLS }, answer));
    server.setSecureContext(identity);
    return server;
  },
  // The context of the name that the clients ask for.
  "tls.Server#addContext": identity => {
    const server = tls.createServer({ ...otherIdentity, ...mutualTLS }, answer);
    server.addContext(servername, identity);
    return listen(server);
  },
  ...(process.platform === "win32" && {
    "tls.createServer on a named pipe": identity =>
      listen(tls.createServer({ ...identity, ...mutualTLS }, answer), `\\\\.\\pipe\\test\\${crypto.randomUUID()}`),
  }),
  "https.createServer": async identity =>
    listen((await import("node:https")).createServer({ ...identity, ...mutualTLS }, respond)),
  // In bun this server has a context of its own for the name, next to its default one.
  "https.createServer with a servername": async identity =>
    listen((await import("node:https")).createServer({ ...identity, servername, ...mutualTLS }, respond)),
  "http2.createSecureServer": async identity =>
    listen((await import("node:http2")).createSecureServer({ ...identity, ...mutualTLS }, respond)),
};

process.on("message", async route => {
  const addresses = {};
  for (const [name, identity] of Object.entries(identities)) {
    const server = await routes[route](identity);
    server.on("tlsClientError", () => {});
    const address = server.address();
    addresses[name] = typeof address === "string" ? address : address.port;
  }
  process.send({ route, addresses });
});
process.on("disconnect", () => process.exit(0));
process.send({ route: "ready" });
