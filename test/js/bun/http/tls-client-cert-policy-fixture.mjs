// Prints what three clients get from every kind of TLS server under the client-certificate policies named in argv,
// or without any what a client that leaves rejectUnauthorized unset does. The node:* kinds run on Node.js too.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import tls from "node:tls";

const keys = join(import.meta.dirname, "..", "..", "node", "test", "fixtures", "keys");
const pem = name => readFileSync(join(keys, name), "utf8");
// ec10 (CN=agent10.example.com) chains to ca5. ec (CN=agent2) is self-signed.
const credentials = { key: pem("ec10-key.pem"), cert: pem("ec10-cert.pem") };
const ca = pem("ca5-cert.pem");
const clients = {
  none: {},
  untrusted: { key: pem("ec-key.pem"), cert: pem("ec-cert.pem") },
  trusted: credentials,
};
const policies = {
  "ca": { ca },
  "caFile": { caFile: join(keys, "ca5-cert.pem") },
  "ca, requestCert": { ca, requestCert: true },
  "ca, requestCert, rejectUnauthorized: false": { ca, requestCert: true, rejectUnauthorized: false },
};
const servername = "policy.example";
const reply = who => `HTTP/1.1 200 OK\r\nContent-Length: ${who.length}\r\nConnection: close\r\n\r\n${who}`;
const peerName = socket => socket.getPeerCertificate()?.subject?.CN ?? "anonymous";

class OverDuplex extends Duplex {
  constructor(socket) {
    super();
    this.socket = socket;
    socket.on("data", chunk => this.push(chunk));
    socket.on("end", () => this.push(null));
    socket.on("close", () => this.destroy());
    socket.on("error", () => {});
  }
  _read() {}
  _write(chunk, encoding, callback) {
    this.socket.write(chunk, encoding, callback);
  }
  _final(callback) {
    this.socket.end(callback);
  }
  _destroy(error, callback) {
    this.socket.destroy();
    callback(error);
  }
}

function nodeTlsServer(policy) {
  const server = tls.createServer({ ...credentials, ...policy }, socket => {
    socket.on("error", () => {});
    socket.once("data", () => socket.end(reply(peerName(socket))));
  });
  server.on("tlsClientError", () => {});
  return server;
}
async function listening(server) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return { port: server.address().port, close: () => server.close() };
}
const bunSocketHandlers = {
  data(socket) {
    socket.end(reply(peerName(socket)));
  },
  error() {},
};

const servers = {
  "tls.createServer": policy => listening(nodeTlsServer(policy)),
  "tls.createServer over a Duplex": policy => {
    const server = nodeTlsServer(policy);
    return listening(net.createServer(raw => server.emit("connection", new OverDuplex(raw))));
  },
  "https.createServer": policy => {
    const server = https.createServer({ ...credentials, ...policy }, (req, res) => res.end("someone"));
    server.on("tlsClientError", () => {});
    return listening(server);
  },
};
if (typeof Bun !== "undefined") {
  const serve = tls => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: () => new Response("someone") });
    return { port: server.port, close: () => server.stop(true) };
  };
  const listen = options => {
    const listener = Bun.listen({ port: 0, hostname: "127.0.0.1", ...options });
    return { port: listener.port, close: () => listener.stop(true) };
  };
  servers["Bun.serve"] = policy => serve({ ...credentials, ...policy });
  servers["Bun.serve serverName entry"] = policy =>
    serve([credentials, { ...credentials, ...policy, serverName: servername }]);
  servers["Bun.listen"] = policy => listen({ tls: { ...credentials, ...policy }, socket: bunSocketHandlers });
  const upgrade = options =>
    listen({
      socket: {
        data(raw, initialData) {
          raw.upgradeTLS({ isServer: true, initialData, socket: bunSocketHandlers, ...options });
        },
        error() {},
      },
    });
  servers["upgradeTLS({ isServer: true, tls })"] = policy => upgrade({ tls: { ...credentials, ...policy } });
  servers["upgradeTLS({ isServer: true, secureContext })"] = policy =>
    upgrade({ secureContext: tls.createSecureContext({ ...credentials, ...policy }).context });
}

const request = `GET / HTTP/1.1\r\nHost: ${servername}\r\nConnection: close\r\n\r\n`;
function outcome(port, client, version) {
  const { promise, resolve } = Promise.withResolvers();
  let received = "";
  const done = () => resolve(received ? `served ${received.split("\r\n\r\n")[1]}` : "refused");
  // rejectUnauthorized: false, so that only the server can refuse.
  if (typeof Bun !== "undefined") {
    const protocol = { "TLSv1.2": 0x0303, "TLSv1.3": 0x0304 }[version];
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: { servername, rejectUnauthorized: false, minVersion: protocol, maxVersion: protocol, ...client },
      socket: {
        handshake: socket => void socket.write(request),
        data: (socket, chunk) => void (received += chunk),
        close: done,
        error() {},
      },
    });
    return promise;
  }
  const options = { servername, rejectUnauthorized: false, minVersion: version, maxVersion: version, ...client };
  const socket = tls.connect({ host: "127.0.0.1", port, ...options }, () => socket.write(request));
  socket.on("data", chunk => (received += chunk));
  socket.on("error", () => {});
  socket.on("close", done);
  return promise;
}

const table = {};
await Promise.all(
  Object.entries(servers).flatMap(([kind, start]) =>
    process.argv.slice(2).map(async name => {
      const server = await start(policies[name]);
      for (const version of ["TLSv1.2", "TLSv1.3"]) {
        const row = await Promise.all(Object.values(clients).map(client => outcome(server.port, client, version)));
        (table[kind] ??= {})[`${name} (${version})`] = row.join(" | ");
      }
      server.close();
    }),
  ),
);

if (process.argv.length === 2) {
  const server = await servers["https.createServer"]({});
  table["tls.connect"] = await new Promise(resolve => {
    const socket = tls.connect({ host: "127.0.0.1", port: server.port, servername });
    socket.on("secureConnect", () => resolve("connected"));
    socket.on("error", error => resolve(error.code));
  });
  if (typeof Bun !== "undefined") {
    table.fetch = await fetch(`https://127.0.0.1:${server.port}/`).then(
      () => "connected",
      error => error.code,
    );
    table["Bun.connect"] = await new Promise(resolve =>
      Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: true,
        socket: {
          handshake: socket => void socket.write(request),
          data: () => resolve("connected"),
          close: () => resolve("closed"),
          error() {},
        },
      }),
    );
  }
}

console.log(JSON.stringify(table));
process.exit(0);
