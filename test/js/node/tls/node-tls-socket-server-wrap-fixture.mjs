/**
 * Standalone server-side TLSSocket wraps: `new tls.TLSSocket(socket, { isServer: true })`.
 * https://github.com/oven-sh/bun/issues/33954
 *
 * Runtime-agnostic (node:test): executed under both runtimes by
 * node-tls-socket-server-wrap.test.ts.
 */
import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import { test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, "..", "test", "fixtures", "keys");
const KEY = fs.readFileSync(path.join(FIXTURES_PATH, "agent1-key.pem"), "utf8");
const CERT = fs.readFileSync(path.join(FIXTURES_PATH, "agent1-cert.pem"), "utf8");

test("new TLSSocket({ isServer, requestCert }) without ca requests a client certificate", async () => {
  const { promise: securePromise, resolve: resolveSecure, reject } = Promise.withResolvers();
  const rawServer = net.createServer(raw => {
    const socket = new tls.TLSSocket(raw, {
      isServer: true,
      key: KEY,
      cert: CERT,
      requestCert: true,
    });
    socket.on("secure", () => resolveSecure(socket.getPeerCertificate()));
    socket.on("data", data => socket.write(data));
    socket.on("error", reject);
  });
  await new Promise(resolve => rawServer.listen(0, "127.0.0.1", resolve));
  const { port } = rawServer.address();

  const client = tls.connect({
    host: "127.0.0.1",
    port,
    key: KEY,
    cert: CERT,
    rejectUnauthorized: false,
  });
  client.on("error", reject);
  const echoPromise = new Promise(resolveEcho => client.on("data", data => resolveEcho(data.toString())));
  try {
    const peerCert = await securePromise;
    assert.ok(peerCert && peerCert.subject, "server must receive the client certificate");
    assert.strictEqual(peerCert.subject.CN, "agent1");
    // The presented certificate is untrusted (no `ca` on the server), but a
    // standalone server-side TLSSocket must not auto-reject the connection:
    // Node applies that policy only in tls.createServer's connection listener.
    client.write("ping");
    assert.strictEqual(await echoPromise, "ping");
  } finally {
    client.destroy();
    rawServer.close();
  }
});

test("new TLSSocket({ isServer }) without requestCert does not request a client certificate", async () => {
  const { promise: securePromise, resolve: resolveSecure, reject } = Promise.withResolvers();
  const rawServer = net.createServer(raw => {
    const socket = new tls.TLSSocket(raw, {
      isServer: true,
      key: KEY,
      cert: CERT,
    });
    socket.on("secure", () => resolveSecure(socket.getPeerCertificate()));
    socket.on("error", reject);
  });
  await new Promise(resolve => rawServer.listen(0, "127.0.0.1", resolve));
  const { port } = rawServer.address();

  const client = tls.connect({
    host: "127.0.0.1",
    port,
    key: KEY,
    cert: CERT,
    rejectUnauthorized: false,
  });
  client.on("error", reject);
  try {
    const peerCert = await securePromise;
    assert.strictEqual(Object.keys(peerCert ?? {}).length, 0);
  } finally {
    client.destroy();
    rawServer.close();
  }
});

test("new TLSSocket(duplex, { isServer, requestCert, rejectUnauthorized }) requests a certificate and does not auto-reject", async () => {
  // Generic-Duplex variant of the standalone server wrap (no native fd).
  const a = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      b.push(chunk);
      cb();
    },
    final(cb) {
      b.push(null);
      cb();
    },
  });
  const b = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      a.push(chunk);
      cb();
    },
    final(cb) {
      a.push(null);
      cb();
    },
  });

  const { promise: securePromise, resolve: resolveSecure, reject } = Promise.withResolvers();
  const server = new tls.TLSSocket(a, {
    isServer: true,
    key: KEY,
    cert: CERT,
    requestCert: true,
    rejectUnauthorized: true,
  });
  server.on("secure", () => resolveSecure(server.getPeerCertificate()));
  server.on("data", data => server.write(data));
  server.on("error", reject);

  const client = tls.connect({
    socket: b,
    key: KEY,
    cert: CERT,
    rejectUnauthorized: false,
  });
  client.on("error", reject);
  const echoPromise = new Promise(resolveEcho => client.on("data", data => resolveEcho(data.toString())));
  try {
    const peerCert = await securePromise;
    assert.ok(peerCert && peerCert.subject, "server must receive the client certificate");
    assert.strictEqual(peerCert.subject.CN, "agent1");
    // The cert is untrusted and rejectUnauthorized is set, but a standalone
    // server-side TLSSocket never auto-rejects: Node applies that policy only
    // in tls.createServer's connection listener.
    client.write("ping");
    assert.strictEqual(await echoPromise, "ping");
  } finally {
    client.destroy();
    server.destroy();
  }
});
