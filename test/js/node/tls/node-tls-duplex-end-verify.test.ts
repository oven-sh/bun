// A TLS handshake that finishes after this side shut its write direction down keeps the certificate verdict.
// Runs under node:test, so the same file runs on node (`node --test`) and on bun (`bun test`).
import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import tls from "node:tls";

const key = fs.readFileSync(new URL("./fixtures/agent1-key.pem", import.meta.url));
const cert = fs.readFileSync(new URL("./fixtures/agent1-cert.pem", import.meta.url));
// agent2 is signed by a CA that neither side trusts here, so it is the client certificate the server must refuse.
const clientKey = fs.readFileSync(new URL("./fixtures/agent2-key.pem", import.meta.url));
const clientCert = fs.readFileSync(new URL("./fixtures/agent2-cert.pem", import.meta.url));
// Both runtimes refuse an untrusted client. Bun reports the certificate check to 'tlsClientError', Node reports how
// the connection ended.
const isBun = process.versions.bun !== undefined;

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

// The tests below put a TCP proxy between the two peers. The proxy acts on TLS records, not on TCP chunks, so the
// moment of each step does not depend on how the kernel splits the byte stream.
const CHANGE_CIPHER_SPEC = 0x14;

// Calls onRecord(record) for each complete TLS record that `socket` receives.
function eachRecord(socket, onRecord) {
  let pending = Buffer.alloc(0);
  socket.on("data", chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 5 && pending.length >= 5 + pending.readUInt16BE(3)) {
      const record = pending.subarray(0, 5 + pending.readUInt16BE(3));
      pending = pending.subarray(record.length);
      onRecord(record);
    }
  });
}

// Starts `server` and a proxy in front of it. `wire(downstream, upstream)` connects the two sockets of each proxied
// connection. Returns the port of the proxy and a function that closes everything.
async function behindProxy(server, wire, proxyOptions = {}) {
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const proxied = [];
  const proxy = net.createServer(proxyOptions, downstream => {
    const upstream = net.connect({ port: server.address().port, host: "127.0.0.1", ...proxyOptions });
    proxied.push(downstream, upstream);
    upstream.on("error", () => {});
    downstream.on("error", () => {});
    upstream.on("close", () => downstream.destroy());
    downstream.on("close", () => upstream.destroy());
    wire(downstream, upstream);
  });
  await new Promise(listening => proxy.listen(0, "127.0.0.1", listening));
  return {
    port: proxy.address().port,
    close() {
      for (const socket of proxied) socket.destroy();
      proxy.close();
      server.close();
    },
  };
}

// The same shape on a plain TCP socket. The client calls end() when its last handshake flight left. The proxy holds
// the server's final flight until the client's FIN arrived, so the handshake completes on a socket that is already
// shut down. The proxy never forwards the FIN, so the server keeps writing. The server's certificate is not trusted.
// Returns the ordered events of the client.
async function endMidHandshakeOverTcp(maxVersion, rejectUnauthorized) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  const server = tls.createServer({ key, cert, maxVersion }, socket => {
    socket.on("error", () => {});
    socket.write("secret-banner");
  });
  server.on("tlsClientError", () => {});

  let client;
  const { port, close } = await behindProxy(
    server,
    (downstream, upstream) => {
      let sawChangeCipherSpec = false;
      let ending = false;
      let clientEnded = false;
      const held = [];
      eachRecord(downstream, record => {
        upstream.write(record);
        if (ending) return;
        // The last flight of the client before the server's final flight: the ClientHello in TLS 1.3, and in TLS 1.2
        // the Finished message, which is the record after ChangeCipherSpec.
        if (maxVersion === "TLSv1.3" || sawChangeCipherSpec) {
          ending = true;
          client.end();
        }
        sawChangeCipherSpec ||= record[0] === CHANGE_CIPHER_SPEC;
      });
      downstream.on("end", () => {
        clientEnded = true;
        // One write, so the client reads the flight in one piece.
        if (held.length > 0) downstream.write(Buffer.concat(held.splice(0)));
      });
      upstream.on("data", chunk => {
        if (ending && !clientEnded) held.push(chunk);
        else downstream.write(chunk);
      });
    },
    { allowHalfOpen: true },
  );

  client = tls.connect({ port, host: "127.0.0.1", servername: "agent1", rejectUnauthorized, maxVersion });
  client.on("secureConnect", () => {
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    setImmediate(() => client.destroy());
  });
  client.on("data", data => events.push(`data ${data}`));
  client.on("error", err => events.push(`error ${err.code}`));
  client.on("close", () => {
    events.push("close");
    resolve();
  });
  await promise;
  close();
  return events;
}

for (const maxVersion of ["TLSv1.2", "TLSv1.3"]) {
  test(`${maxVersion} on a TCP socket: end() while the handshake runs does not accept an untrusted certificate`, async () => {
    const events = await endMidHandshakeOverTcp(maxVersion, true);
    assert.ok(events.includes("error UNABLE_TO_VERIFY_LEAF_SIGNATURE"), events.join(", "));
    assert.ok(!events.some(event => event.startsWith("secureConnect") || event.startsWith("data")), events.join(", "));
  });

  test(`${maxVersion} on a TCP socket: end() while the handshake runs still reports the failed check on the socket`, async () => {
    const events = await endMidHandshakeOverTcp(maxVersion, false);
    const secureConnect = events.find(event => event.startsWith("secureConnect"));
    assert.strictEqual(
      secureConnect,
      "secureConnect authorized=false authError=UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      events.join(", "),
    );
  });
}

// The server side of the same shape. A server that asks for a client certificate calls end() on its socket while the
// handshake runs. The proxy holds the client's Certificate..Finished flight until the server's FIN arrived, so the
// handshake completes on a socket that is already shut down. The client's certificate is not trusted.
// With `afterHandshakeTimeout` the end() comes from the server's 'tlsClientError' listener, once the handshake
// timeout was reported. Returns the ordered events of the server.
async function serverEndMidHandshake(rejectUnauthorized, afterHandshakeTimeout = false) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  let serverSocket;
  const server = tls.createServer(
    {
      key,
      cert,
      requestCert: true,
      rejectUnauthorized,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ...(afterHandshakeTimeout && { handshakeTimeout: 50 }),
    },
    socket => {
      events.push(`secureConnection authorized=${socket.authorized} authError=${socket.authorizationError}`);
      socket.on("error", () => {});
      socket.on("data", data => {
        events.push(`data ${data} authorized=${socket.authorized}`);
        resolve();
      });
      if (!socket.authorized) resolve();
    },
  );
  server.on("connection", socket => {
    serverSocket = socket;
    socket.on("error", () => {});
  });
  server.on("tlsClientError", (err, socket) => {
    events.push(`tlsClientError ${err.code}`);
    if (err.code !== "ERR_TLS_HANDSHAKE_TIMEOUT") return resolve();
    socket.on("close", () => {
      events.push("close");
      resolve();
    });
    socket.end();
  });

  const { port, close } = await behindProxy(
    server,
    (downstream, upstream) => {
      let records = 0;
      let serverEnded = false;
      const held = [];
      eachRecord(downstream, record => {
        // The first record is the ClientHello. Every later one belongs to the flight the verdict comes from.
        if (++records === 1 || serverEnded) return void upstream.write(record);
        held.push(record);
        if (held.length === 1 && !afterHandshakeTimeout) serverSocket.end();
      });
      upstream.on("data", chunk => downstream.write(chunk));
      upstream.on("end", () => {
        serverEnded = true;
        // One write, so the server reads the flight in one piece.
        upstream.write(Buffer.concat(held.splice(0)));
      });
    },
    { allowHalfOpen: true },
  );

  const client = tls.connect({
    port,
    host: "127.0.0.1",
    servername: "agent1",
    key: clientKey,
    cert: clientCert,
    rejectUnauthorized: false,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
  });
  client.on("secureConnect", () => client.write("privileged-command"));
  client.on("error", () => {});
  // Ends the test when the server reported nothing.
  client.on("close", () => {
    if (events.length > 0) return;
    events.push("client close");
    resolve();
  });
  await promise;
  client.destroy();
  close();
  return events;
}

test("a server that end()s while the handshake runs still reports the failed check on the socket", async () => {
  const events = await serverEndMidHandshake(false);
  assert.strictEqual(
    events[0],
    "secureConnection authorized=false authError=DEPTH_ZERO_SELF_SIGNED_CERT",
    events.join(", "),
  );
});

test("a server that end()s while the handshake runs does not accept an untrusted client certificate", async () => {
  // Node cannot complete its own handshake after end(), so it reports a reset.
  assert.deepStrictEqual(await serverEndMidHandshake(true), [
    isBun ? "tlsClientError DEPTH_ZERO_SELF_SIGNED_CERT" : "tlsClientError ECONNRESET",
  ]);
});

test("a server that end()s after a handshake timeout does not accept an untrusted client certificate", async () => {
  assert.deepStrictEqual(await serverEndMidHandshake(true, true), [
    "tlsClientError ERR_TLS_HANDSHAKE_TIMEOUT",
    "close",
  ]);
});

// No end() anywhere. The peer sends one record that cannot be decrypted right behind its Finished message, in the
// same write. The receiver finishes the handshake and fails on the bad record in one read, so the connection is
// already in a fatal state when it reports the handshake. `from` names the peer that sends the bad record.
// Returns the ordered events of the other peer.
async function badRecordBehindFinished(from, rejectUnauthorized) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  const observeServer = from === "client";
  const badRecord = Buffer.concat([Buffer.from([0x17, 0x03, 0x03, 0x00, 0x20]), Buffer.alloc(32, 0xab)]);
  // TLS 1.2: the Finished message is the one record after ChangeCipherSpec, so the proxy can find it.
  const version = { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" };
  const server = tls.createServer(
    { key, cert, ...version, ...(observeServer && { requestCert: true, rejectUnauthorized }) },
    socket => {
      socket.on("error", () => {});
      if (!observeServer) return;
      events.push(`secureConnection authorized=${socket.authorized} authError=${socket.authorizationError}`);
      resolve();
    },
  );
  server.on("tlsClientError", err => {
    if (!observeServer) return;
    events.push(`tlsClientError ${err.code}`);
    resolve();
  });

  const { port, close } = await behindProxy(server, (downstream, upstream) => {
    const [sender, receiver] = observeServer ? [downstream, upstream] : [upstream, downstream];
    let sawChangeCipherSpec = false;
    let sent = false;
    eachRecord(sender, record => {
      if (sawChangeCipherSpec && !sent) {
        sent = true;
        receiver.write(Buffer.concat([record, badRecord]));
      } else receiver.write(record);
      sawChangeCipherSpec ||= record[0] === CHANGE_CIPHER_SPEC;
    });
    receiver.on("data", chunk => sender.write(chunk));
  });

  const client = tls.connect({
    port,
    host: "127.0.0.1",
    servername: "agent1",
    ...version,
    ...(observeServer ? { key: clientKey, cert: clientCert, rejectUnauthorized: false } : { rejectUnauthorized }),
  });
  client.on("secureConnect", () => {
    if (observeServer) return;
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    resolve();
  });
  client.on("error", err => {
    if (observeServer) return;
    events.push(`error ${err.code}`);
    resolve();
  });
  // Ends the test when the observed peer reported nothing.
  client.on("close", () => {
    if (events.length > 0) return;
    events.push("client close");
    resolve();
  });
  await promise;
  client.destroy();
  close();
  return events;
}

test("a bad record behind the server's Finished still reports the failed check on the client", async () => {
  const events = await badRecordBehindFinished("server", false);
  assert.strictEqual(
    events[0],
    "secureConnect authorized=false authError=UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    events.join(", "),
  );
});

test("a bad record behind the client's Finished still reports the failed check on the server", async () => {
  const events = await badRecordBehindFinished("client", false);
  assert.strictEqual(
    events[0],
    "secureConnection authorized=false authError=DEPTH_ZERO_SELF_SIGNED_CERT",
    events.join(", "),
  );
});

test("a bad record behind the client's Finished does not make a server accept an untrusted client certificate", async () => {
  const events = await badRecordBehindFinished("client", true);
  assert.strictEqual(events.length, 1, events.join(", "));
  // Node reports the bad record. Its code depends on the cipher, so only the class of the error is fixed.
  assert.match(events[0], isBun ? /^tlsClientError DEPTH_ZERO_SELF_SIGNED_CERT$/ : /^tlsClientError ERR_SSL_/);
});
