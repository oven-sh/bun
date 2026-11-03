// Prints which CA names servers that request a client certificate announce, and whom they authorize.
// The node:tls and node:https rows run on Node too: `node tls-client-ca-names-fixture.mjs <folder of the keys>`.
import { readFileSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const pem = name => readFileSync(`${process.argv[2]}/${name}.pem`, "utf8");
// ca1 issued agent1, ca2 issued agent3. The servers finish the handshake with every client, so that `authorized` can be read.
const identity = { key: pem("agent1-key"), cert: pem("agent1-cert"), requestCert: true, rejectUnauthorized: false };

/** A TLS 1.2 ClientHello. What the server answers up to its ServerHelloDone is not encrypted. */
function clientHello() {
  const extensions = Buffer.from([
    ...[0x00, 0x0a, 0x00, 0x04, 0x00, 0x02, 0x00, 0x17], // supported_groups: secp256r1
    ...[0x00, 0x0b, 0x00, 0x02, 0x01, 0x00], // ec_point_formats: uncompressed
    ...[0x00, 0x0d, 0x00, 0x06, 0x00, 0x04, 0x08, 0x04, 0x04, 0x01], // signature_algorithms: two for RSA keys
  ]);
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]),
    Buffer.alloc(32, 7), // random
    Buffer.from([0x00, 0x00, 0x02, 0xc0, 0x2f, 0x01, 0x00]), // no session, ECDHE-RSA-AES128-GCM-SHA256, no compression
    Buffer.from([0x00, extensions.length]),
    extensions,
  ]);
  const message = Buffer.concat([Buffer.from([0x01, 0x00, 0x00, body.length]), body]);
  return Buffer.concat([Buffer.from([0x16, 0x03, 0x01, 0x00, message.length]), message]);
}

/** Resolves to the CAs that the CertificateRequest of the server on `port` names. */
function announcedOn(port) {
  const { promise, resolve, reject } = Promise.withResolvers();
  let received = Buffer.alloc(0);
  const socket = net.connect(port, "127.0.0.1", () => socket.write(clientHello()));
  socket.on("error", reject);
  socket.on("close", () => reject(new Error("closed before ServerHelloDone")));
  socket.on("data", chunk => {
    received = Buffer.concat([received, chunk]);
    const fragments = [];
    for (let at = 0; at + 5 <= received.length; at += 5 + received.readUInt16BE(at + 3)) {
      if (received[at] !== 0x16) return reject(new Error(`record of type ${received[at]}`));
      fragments.push(received.subarray(at + 5, at + 5 + received.readUInt16BE(at + 3)));
    }
    const messages = Buffer.concat(fragments);
    for (let at = 0; at + 4 <= messages.length; at += 4 + messages.readUIntBE(at + 1, 3)) {
      const body = messages.subarray(at + 4, at + 4 + messages.readUIntBE(at + 1, 3));
      if (messages[at] === 14) resolve("no CertificateRequest");
      if (messages[at] !== 13 || at + 4 + messages.readUIntBE(at + 1, 3) > messages.length) continue;
      let names = 1 + body[0]; // behind certificate_types
      names += 2 + body.readUInt16BE(names); // behind supported_signature_algorithms
      const text = body.subarray(names + 2, names + 2 + body.readUInt16BE(names)).toString("latin1");
      resolve(["ca1", "ca2"].filter(name => text.includes(name)));
    }
  });
  return promise.finally(() => socket.destroy());
}

const listening = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const kinds = {
  "tls.createServer": async (options, use) => {
    const server = tls.createServer(options, socket => socket.end()).on("tlsClientError", () => {});
    return use(await listening(server)).finally(() => server.close());
  },
  "https.createServer": async (options, use) => {
    const server = https.createServer(options, (req, res) => res.end()).on("tlsClientError", () => {});
    return use(await listening(server)).finally(() => server.close());
  },
};
if (typeof Bun !== "undefined") {
  kinds["Bun.serve"] = (options, use) => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: options, fetch: () => new Response() });
    return use(server.port).finally(() => server.stop(true));
  };
  kinds["Bun.listen"] = (options, use) => {
    const server = Bun.listen({ port: 0, hostname: "127.0.0.1", tls: options, socket: { data() {}, error() {} } });
    return use(server.port).finally(() => server.stop(true));
  };
}

/** Whether a tls.Server with `options` authorizes the client that shows the certificate of `agent`. */
async function authorizes(options, agent) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const server = tls.createServer(options, socket => (resolve(socket.authorized), socket.end()));
  server.on("tlsClientError", reject);
  const client = tls.connect({
    port: await listening(server),
    host: "127.0.0.1",
    servername: "agent1",
    ca: pem("ca1-cert"),
    key: pem(`${agent}-key`),
    cert: pem(`${agent}-cert`),
  });
  client.on("error", reject);
  client.on("close", () => reject(new Error("closed before 'secureConnection'")));
  return promise.finally(() => (client.destroy(), server.close()));
}

const rows = {};
const announce = async (row, options) => {
  for (const kind in kinds) (rows[kind] ??= {})[row] = await kinds[kind](options, announcedOn);
};

await announce("no ca", identity);
tls.setDefaultCACertificates([pem("ca2-cert")]);
await announce("the default list", identity);
await announce("its own ca", { ...identity, ca: pem("ca1-cert") });
// The same certificates as the default list, so only where they come from differs.
await announce("the default list given as ca", { ...identity, ca: pem("ca2-cert") });
await announce("the default list again", identity);
rows.authorized = {
  "issued by a CA of the default list": await authorizes(identity, "agent3"),
  "issued by another CA": await authorizes(identity, "agent1"),
};
console.log(JSON.stringify(rows, null, 2));
