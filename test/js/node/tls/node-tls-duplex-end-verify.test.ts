// Runs under node:test, so the same file runs on node (`node --test`) and on bun (`bun test`).
import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import tls from "node:tls";

const key = fs.readFileSync(new URL("./fixtures/agent1-key.pem", import.meta.url));
const cert = fs.readFileSync(new URL("./fixtures/agent1-cert.pem", import.meta.url));

// A client wraps a Duplex in TLS and calls end() right after its first flight left, so the handshake is still running.
// The server's certificate is not trusted. Returns the ordered events of the client.
async function endMidHandshake(rejectUnauthorized) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  const server = tls.createServer({ key, cert }, socket => {
    socket.on("error", () => {});
    socket.write("secret-banner");
  });
  server.on("tlsClientError", () => {});
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const raw = net.connect(server.address().port, "127.0.0.1");
  raw.on("error", () => {});
  let firstWrite = true;
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, callback);
      if (firstWrite) {
        firstWrite = false;
        setImmediate(() => client.end());
      }
    },
    final(callback) {
      raw.end();
      callback();
    },
  });
  raw.on("data", data => duplex.push(data));
  raw.on("end", () => duplex.push(null));
  raw.on("close", () => duplex.destroy());
  const client = tls.connect({ socket: duplex, servername: "agent1", rejectUnauthorized });
  client.on("secureConnect", () => {
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    // A connection that was let through must not keep this test waiting.
    setImmediate(() => client.destroy());
  });
  client.on("data", data => events.push(`data ${data}`));
  client.on("error", err => events.push(`error ${err.code}`));
  client.on("close", () => {
    events.push("close");
    resolve();
  });
  await promise;
  raw.destroy();
  server.close();
  return events;
}

test("end() while the handshake runs does not accept an untrusted certificate", async () => {
  const events = await endMidHandshake(true);
  assert.ok(events.includes("error UNABLE_TO_VERIFY_LEAF_SIGNATURE"), events.join(", "));
  assert.ok(!events.some(event => event.startsWith("secureConnect") || event.startsWith("data")), events.join(", "));
});

test("end() while the handshake runs still reports the failed check on the socket", async () => {
  const events = await endMidHandshake(false);
  const secureConnect = events.find(event => event.startsWith("secureConnect"));
  assert.strictEqual(
    secureConnect,
    "secureConnect authorized=false authError=UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    events.join(", "),
  );
});
