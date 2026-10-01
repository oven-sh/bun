// A TLS socket over a Duplex hands each ciphertext record to that Duplex's write() from inside its own send, and it
// listens for 'drain' on the Duplex to retry a parked write. A Duplex that emits 'drain' from write() asks for that
// retry while the send is still running.
// Runs under node:test, so the same file runs on node (`node --test`) and on bun (`bun test`).
import assert from "node:assert";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import tls from "node:tls";

const key = fs.readFileSync(new URL("./fixtures/agent1-key.pem", import.meta.url));
const cert = fs.readFileSync(new URL("./fixtures/agent1-cert.pem", import.meta.url));

test("a write queued before the handshake goes out once over a Duplex that emits 'drain' from write()", async () => {
  // Position-dependent bytes, so a repeated or reordered range shows up.
  const payload = Buffer.alloc(256 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + (i >> 8)) & 0xff;

  // Two Duplexes wired to each other, so the exchange stays in this process.
  const clientSide = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      this.emit("drain");
      serverSide.push(chunk);
      callback();
    },
    final(callback) {
      serverSide.push(null);
      callback();
    },
  });
  const serverSide = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      clientSide.push(chunk);
      callback();
    },
    final(callback) {
      clientSide.push(null);
      callback();
    },
  });

  const received = [];
  const { promise: ended, resolve, reject } = Promise.withResolvers();
  const server = new tls.TLSSocket(serverSide, { isServer: true, key, cert });
  server.on("error", reject);
  server.on("data", chunk => received.push(chunk));
  server.on("end", () => {
    server.end();
    resolve();
  });

  const client = tls.connect({ socket: clientSide, rejectUnauthorized: false });
  client.on("error", reject);
  // The handshake has not started yet, so the payload waits and the flush after the handshake sends it.
  client.write(payload, () => client.end());

  await ended;
  const all = Buffer.concat(received);
  assert.strictEqual(all.length, payload.length);
  assert.ok(all.equals(payload));
});

test("an HTTP/2 request completes over a Duplex that emits 'drain' from write()", async () => {
  const server = http2.createSecureServer({ key, cert });
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const raw = net.connect(server.address().port, "127.0.0.1");
  await once(raw, "connect");
  const transport = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      this.emit("drain");
      raw.write(chunk, callback);
    },
  });
  raw.on("data", chunk => transport.push(chunk));

  const { promise, resolve, reject } = Promise.withResolvers();
  // A second copy of the client preface reaches the server as a protocol error.
  server.on("sessionError", reject);
  const session = http2.connect("https://localhost", {
    createConnection: () => tls.connect({ socket: transport, ALPNProtocols: ["h2"], rejectUnauthorized: false }),
  });
  session.on("error", reject);
  const request = session.request({ ":path": "/" });
  request.on("error", reject);
  request.setEncoding("utf8");
  request.on("response", headers => {
    let body = "";
    request.on("data", chunk => (body += chunk));
    request.on("end", () => resolve({ status: headers[":status"], body }));
  });
  request.end();

  try {
    assert.deepStrictEqual(await promise, { status: 200, body: "ok" });
  } finally {
    session.destroy();
    raw.destroy();
    server.close();
  }
});
