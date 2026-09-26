// A TLS handshake that finishes after this side shut its write direction down keeps the certificate verdict.
// Runs under node:test, so the same file runs on node (`node --test`) and on bun (`bun test`).
import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import { Duplex, duplexPair } from "node:stream";
import { test } from "node:test";
import tls from "node:tls";

const key = fs.readFileSync(new URL("./fixtures/agent1-key.pem", import.meta.url));
const cert = fs.readFileSync(new URL("./fixtures/agent1-cert.pem", import.meta.url));
// agent2 is signed by a CA that neither side trusts here, so it is the client certificate the server must refuse.
const clientKey = fs.readFileSync(new URL("./fixtures/agent2-key.pem", import.meta.url));
const clientCert = fs.readFileSync(new URL("./fixtures/agent2-cert.pem", import.meta.url));
// The controls trust the peer: ca1 signed the server's certificate, and the client's certificate is its own issuer.
const serverCA = fs.readFileSync(new URL("./fixtures/ca1-cert.pem", import.meta.url));
const clientCA = clientCert;
// Both runtimes refuse an untrusted client. Bun reports the certificate check to 'tlsClientError', Node reports how
// the connection ended.
const isBun = process.versions.bun !== undefined;

// Resolves when this process has read what its sockets had received by the time of the call: a new connection that
// the peer answers takes more turns of the event loop than a read that is already due.
async function pendingReadsDone() {
  const server = net.createServer(socket => socket.end("x"));
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const socket = net.connect(server.address().port, "127.0.0.1");
  await new Promise(answered => socket.once("data", answered));
  socket.destroy();
  server.close();
}

// Passes `flight` to `deliver` in `pieces` parts. The receiver has read each part before the next one leaves, so with
// two pieces it reads the flight in two parts, split inside a record.
async function inPieces(deliver, flight, pieces) {
  const size = Math.ceil(flight.length / pieces);
  for (let offset = 0; offset < flight.length; offset += size) {
    if (offset > 0) await pendingReadsDone();
    deliver(flight.subarray(offset, offset + size));
  }
}

// A client wraps a Duplex in TLS and calls end() right after its first flight left, so the handshake is still running.
// The server's certificate is not trusted, unless `trusted`. Returns the ordered events of the client.
async function endMidHandshake(rejectUnauthorized, { pieces = 1, trusted = false } = {}) {
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
  let delivered = Promise.resolve();
  raw.on("data", data => {
    if (pieces === 1) duplex.push(data);
    else delivered = delivered.then(() => inPieces(part => duplex.push(part), data, pieces));
  });
  raw.on("end", () => delivered.then(() => duplex.push(null)));
  raw.on("close", () => delivered.then(() => duplex.destroy()));
  const client = tls.connect({
    socket: duplex,
    servername: "agent1",
    rejectUnauthorized,
    ...(trusted && { ca: serverCA }),
  });
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

test("over a Duplex: the server's final flight arrives in two reads after end()", async () => {
  const events = await endMidHandshake(false, { pieces: 2 });
  const secureConnect = events.find(event => event.startsWith("secureConnect"));
  assert.strictEqual(
    secureConnect,
    "secureConnect authorized=false authError=UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    events.join(", "),
  );
});

for (const pieces of [1, 2]) {
  test(`over a Duplex: end() while the handshake runs keeps a trusted certificate authorized, final flight in ${pieces} read(s)`, async () => {
    const events = await endMidHandshake(true, { pieces, trusted: true });
    const secureConnect = events.find(event => event.startsWith("secureConnect"));
    assert.strictEqual(secureConnect, "secureConnect authorized=true authError=null", events.join(", "));
  });
}

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
// connection. With `overDuplex` the server does not get a TCP socket: its transport is one end of a Duplex pair, and
// `upstream` is the other end. Returns the port of the proxy and a function that closes everything.
async function behindProxy(server, wire, proxyOptions = {}, overDuplex = false) {
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const proxied = [];
  const proxy = net.createServer(proxyOptions, downstream => {
    let upstream;
    if (overDuplex) {
      const [transport, otherEnd] = duplexPair();
      transport.on("error", () => {});
      upstream = otherEnd;
      server.emit("connection", transport);
    } else {
      upstream = net.connect({ port: server.address().port, host: "127.0.0.1", ...proxyOptions });
    }
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

// The same shape on a plain TCP socket. The client calls end() when its last handshake flight left. The proxy
// delivers what the server sends from then on after the client's FIN arrived, in `pieces` parts, so the handshake
// completes on a socket that is already shut down. The proxy never forwards the FIN, so the server keeps writing.
// The server's certificate is not trusted, unless `trusted`. Returns the ordered events of the client.
async function endMidHandshakeOverTcp(maxVersion, rejectUnauthorized, { pieces = 1, trusted = false } = {}) {
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
      const clientEnded = Promise.withResolvers();
      let delivered = clientEnded.promise;
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
      downstream.on("end", clientEnded.resolve);
      upstream.on("data", chunk => {
        if (!ending) return void downstream.write(chunk);
        // The FIN can arrive before the server's answer does: each chunk waits for it, and for the chunk before.
        delivered = delivered.then(() => inPieces(part => downstream.write(part), chunk, pieces));
      });
    },
    { allowHalfOpen: true },
  );

  client = tls.connect({
    port,
    host: "127.0.0.1",
    servername: "agent1",
    rejectUnauthorized,
    maxVersion,
    ...(trusted && { ca: serverCA }),
  });
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

// Our own FIN does not end a handshake that is still running. A flight that arrives in two reads completes it as well.
for (const maxVersion of ["TLSv1.2", "TLSv1.3"]) {
  test(`${maxVersion} on a TCP socket: the server's final flight arrives in two reads after end()`, async () => {
    const events = await endMidHandshakeOverTcp(maxVersion, false, { pieces: 2 });
    const secureConnect = events.find(event => event.startsWith("secureConnect"));
    assert.strictEqual(
      secureConnect,
      "secureConnect authorized=false authError=UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      events.join(", "),
    );
  });

  for (const pieces of [1, 2]) {
    test(`${maxVersion} on a TCP socket: end() while the handshake runs keeps a trusted certificate authorized, final flight in ${pieces} read(s)`, async () => {
      const events = await endMidHandshakeOverTcp(maxVersion, true, { pieces, trusted: true });
      const secureConnect = events.find(event => event.startsWith("secureConnect"));
      assert.strictEqual(secureConnect, "secureConnect authorized=true authError=null", events.join(", "));
    });
  }
}

// The server side of the same shape. A server that asks for a client certificate calls end() on its socket while the
// handshake runs. The proxy holds the client's Certificate..Finished flight until the server's FIN arrived, so the
// handshake completes on a socket that is already shut down. The client's certificate is not trusted, unless
// `trusted`. With `afterHandshakeTimeout` the end() comes from the server's 'tlsClientError' listener, once the
// handshake timeout was reported. Returns the ordered events of the server.
async function serverEndMidHandshake(
  rejectUnauthorized,
  afterHandshakeTimeout = false,
  { pieces = 1, trusted = false, overDuplex = false } = {},
) {
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
      ...(trusted && { ca: clientCA }),
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
      upstream.on("end", async () => {
        await inPieces(part => upstream.write(part), Buffer.concat(held.splice(0)), pieces);
        serverEnded = true;
        for (const record of held.splice(0)) upstream.write(record);
      });
    },
    { allowHalfOpen: true },
    overDuplex,
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

for (const overDuplex of [false, true]) {
  const transport = overDuplex ? "over a Duplex" : "on a TCP socket";

  test(`${transport}: a server that end()s reports the failed check of a flight that arrives in two reads`, async () => {
    const events = await serverEndMidHandshake(false, false, { pieces: 2, overDuplex });
    assert.strictEqual(
      events[0],
      "secureConnection authorized=false authError=DEPTH_ZERO_SELF_SIGNED_CERT",
      events.join(", "),
    );
  });

  test(`${transport}: a server that end()s does not accept an untrusted client certificate that arrives in two reads`, async () => {
    assert.deepStrictEqual(await serverEndMidHandshake(true, false, { pieces: 2, overDuplex }), [
      isBun ? "tlsClientError DEPTH_ZERO_SELF_SIGNED_CERT" : "tlsClientError ECONNRESET",
    ]);
  });

  for (const pieces of [1, 2]) {
    test(`${transport}: a server that end()s keeps a trusted client certificate authorized, flight in ${pieces} read(s)`, async () => {
      assert.deepStrictEqual(await serverEndMidHandshake(true, false, { pieces, trusted: true, overDuplex }), [
        "secureConnection authorized=true authError=null",
        "data privileged-command authorized=true",
      ]);
    });
  }
}

// A client can offer the session of an earlier connection. Its certificate check is not the check of a handshake that
// the peer never answered.
for (const maxVersion of ["TLSv1.2", "TLSv1.3"]) {
  test(`${maxVersion}: end() before the handshake does not report the check of an offered session`, async () => {
    const server = tls.createServer({ key, cert, maxVersion }, socket => {
      socket.on("error", () => {});
      socket.end("x");
    });
    await new Promise(listening => server.listen(0, "127.0.0.1", listening));
    const first = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false });
    first.on("error", () => {});
    let session;
    first.on("session", ticket => (session = ticket));
    await new Promise(connected => first.once("secureConnect", connected));
    assert.strictEqual(first.authorizationError, "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    first.resume();
    await new Promise(closed => first.once("close", closed));
    // TLS 1.3 gives the session with the 'session' event only.
    if (maxVersion === "TLSv1.2") session ??= first.getSession();
    assert.ok(session?.length > 0, "the first connection gave no session to offer");
    server.close();

    // Accepts the connection and never answers.
    const sawFin = Promise.withResolvers();
    const accepted = [];
    const silent = net.createServer({ allowHalfOpen: true }, socket => {
      accepted.push(socket);
      socket.on("data", () => {});
      socket.on("error", () => {});
      socket.on("end", sawFin.resolve);
    });
    await new Promise(listening => silent.listen(0, "127.0.0.1", listening));
    const events = [];
    const client = tls.connect({ port: silent.address().port, host: "127.0.0.1", rejectUnauthorized: false, session });
    for (const event of ["secureConnect", "finish", "error", "close"]) {
      client.on(event, arg => events.push(arg?.code ? `${event} ${arg.code}` : event));
    }
    client.on("connect", () => client.end());
    try {
      await Promise.all([new Promise(finished => client.once("finish", finished)), sawFin.promise]);
      await pendingReadsDone();
      assert.deepStrictEqual(
        { events, authorized: client.authorized, authorizationError: client.authorizationError ?? null },
        { events: ["finish"], authorized: false, authorizationError: null },
      );
    } finally {
      client.destroy();
      for (const socket of accepted) socket.destroy();
      silent.close();
    }
  });
}

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

// The peer can go away while the handshake of a socket that called end() still runs. The socket closes with no error,
// and the server reports the handshake that never finished. `half`: the peer sends the first half of its last flight
// before its FIN.
for (const half of [false, true]) {
  test(`a server that end()s reports the handshake that its peer left ${half ? "in the middle of a flight" : "before its last flight"}`, async () => {
    const events = [];
    const refused = Promise.withResolvers();
    const serverClosed = Promise.withResolvers();
    let serverSocket;
    const server = tls.createServer({ key, cert, maxVersion: "TLSv1.3" }, () => events.push("secureConnection"));
    server.on("tlsClientError", err => {
      events.push(`tlsClientError ${err.code}`);
      refused.resolve();
    });
    server.on("connection", socket => {
      serverSocket = socket;
      socket.on("error", () => {});
      socket.on("close", serverClosed.resolve);
    });
    const { port, close } = await behindProxy(
      server,
      (downstream, upstream) => {
        let chunks = 0;
        const held = [];
        downstream.on("data", chunk => {
          // The ClientHello goes through. The proxy holds the client's last flight, and the server calls end().
          if (++chunks === 1) return void upstream.write(chunk);
          held.push(chunk);
          if (held.length === 1) serverSocket.end();
        });
        upstream.on("data", chunk => downstream.write(chunk));
        upstream.on("end", async () => {
          const flight = Buffer.concat(held.splice(0));
          if (half) {
            upstream.write(flight.subarray(0, Math.ceil(flight.length / 2)));
            await pendingReadsDone();
          }
          upstream.end();
        });
      },
      { allowHalfOpen: true },
    );
    const client = tls.connect({ port, host: "127.0.0.1", servername: "agent1", rejectUnauthorized: false });
    client.on("error", () => {});
    try {
      await Promise.all([refused.promise, serverClosed.promise]);
      assert.deepStrictEqual(events, ["tlsClientError ECONNRESET"]);
    } finally {
      client.destroy();
      close();
    }
  });
}
