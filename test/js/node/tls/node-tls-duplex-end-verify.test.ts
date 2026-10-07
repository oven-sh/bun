// A TLS handshake that finishes after this side shut its write direction down keeps the certificate verdict.
// The last tests cover the other order on an established session: the peer closes first, while this side still has
// writes that its transport has not completed.
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
// Bun's debug and sanitizer builds use more memory for the same work, so a memory check gets a wider bound there.
const isDebugOrASAN = isBun && (process.versions.bun.includes("debug") || process.execPath.includes("bun-asan"));

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
// The server's certificate is not trusted, unless `trusted`. It is for "agent1". With `resumed` the client offers the
// session of an earlier connection that asked for "agent1", and its name check records whether the handshake resumed
// that session. Returns the ordered events of the client.
async function endMidHandshake(
  rejectUnauthorized,
  { pieces = 1, trusted = false, servername = "agent1", checkServerIdentity, resumed = false } = {},
) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  const server = tls.createServer({ key, cert }, socket => {
    socket.on("error", () => {});
    socket.write("secret-banner");
  });
  server.on("tlsClientError", () => {});
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  let session;
  if (resumed) {
    const first = tls.connect({ port: server.address().port, host: "127.0.0.1", servername: "agent1", ca: serverCA });
    first.resume();
    session = await new Promise((offered, failed) => {
      first.once("session", offered);
      first.once("error", failed);
      first.once("close", () => failed(new Error("the first connection closed before it offered a session")));
    });
    first.destroy();
  }
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
    servername,
    rejectUnauthorized,
    session,
    ...(trusted && { ca: serverCA }),
    ...(resumed && {
      checkServerIdentity(name, peerCertificate) {
        events.push(`session reused=${client.isSessionReused()}`);
        return tls.checkServerIdentity(name, peerCertificate);
      },
    }),
    ...(checkServerIdentity && { checkServerIdentity }),
  });
  client.on("secureConnect", () => {
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    // A connection that was let through must not keep this test waiting.
    setImmediate(() => client.destroy());
  });
  client.on("data", data => {
    events.push(`data ${data}`);
    // Data with no report of the handshake: this client must not keep the test waiting either.
    if (!events.some(event => event.startsWith("secureConnect"))) client.destroy();
  });
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
async function endMidHandshakeOverTcp(
  maxVersion,
  rejectUnauthorized,
  { pieces = 1, trusted = false, servername = "agent1", checkServerIdentity } = {},
) {
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
    servername,
    rejectUnauthorized,
    maxVersion,
    ...(trusted && { ca: serverCA }),
    ...(checkServerIdentity && { checkServerIdentity }),
  });
  client.on("secureConnect", () => {
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    setImmediate(() => client.destroy());
  });
  client.on("data", data => {
    events.push(`data ${data}`);
    // Data with no report of the handshake: this client must not keep the test waiting either.
    if (!events.some(event => event.startsWith("secureConnect"))) client.destroy();
  });
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

// The client's last flight is sealed after its FIN, so it can never leave. That flight must not hold up the handshake
// of the next socket that is shut down the same way. The first client stays open while the second one connects.
test("TLSv1.3 on a TCP socket: a second client that end()s finishes its handshake while the first one stays open", async () => {
  const server = tls.createServer({ key, cert, maxVersion: "TLSv1.3" }, socket => socket.on("error", () => {}));
  server.on("tlsClientError", () => {});
  const clients = [];
  const { port, close } = await behindProxy(
    server,
    (downstream, upstream) => {
      const client = clients.at(-1);
      let sawClientHello = false;
      let clientEnded = false;
      const held = [];
      eachRecord(downstream, record => {
        upstream.write(record);
        if (sawClientHello) return;
        sawClientHello = true;
        client.end();
      });
      downstream.on("end", () => {
        clientEnded = true;
        for (const chunk of held.splice(0)) downstream.write(chunk);
      });
      upstream.on("data", chunk => {
        if (clientEnded) downstream.write(chunk);
        else held.push(chunk);
      });
    },
    { allowHalfOpen: true },
  );
  const connectAndEnd = () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = tls.connect({
      port,
      host: "127.0.0.1",
      servername: "agent1",
      rejectUnauthorized: false,
      maxVersion: "TLSv1.3",
    });
    clients.push(client);
    client.on("secureConnect", () =>
      resolve(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`),
    );
    client.on("error", reject);
    client.on("close", () => reject(new Error("closed with no secureConnect")));
    return promise;
  };
  try {
    const first = await connectAndEnd();
    const second = await connectAndEnd();
    assert.deepStrictEqual(
      [first, second],
      [
        "secureConnect authorized=false authError=UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "secureConnect authorized=false authError=UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      ],
    );
  } finally {
    for (const client of clients) client.destroy();
    close();
  }
});

// The same for records that a socket seals before its handshake completes. A TLS 1.2 client seals its second flight
// after its FIN, and then waits for a server that never got it.
test("a TLSv1.3 client that end()s finishes its handshake while a TLSv1.2 client that did the same stays open", async () => {
  const server = tls.createServer({ key, cert }, socket => socket.on("error", () => {}));
  server.on("tlsClientError", () => {});
  const clients = [];
  const forwarded = [];
  const { port, close } = await behindProxy(
    server,
    (downstream, upstream) => {
      const client = clients.at(-1);
      const flightForwarded = forwarded.at(-1);
      let sawClientHello = false;
      let clientEnded = false;
      const held = [];
      eachRecord(downstream, record => {
        upstream.write(record);
        if (sawClientHello) return;
        sawClientHello = true;
        client.end();
      });
      downstream.on("end", () => {
        clientEnded = true;
        for (const chunk of held.splice(0)) downstream.write(chunk, flightForwarded.resolve);
      });
      upstream.on("data", chunk => {
        if (clientEnded) downstream.write(chunk, flightForwarded.resolve);
        else held.push(chunk);
      });
    },
    { allowHalfOpen: true },
  );
  const connectAndEnd = maxVersion => {
    const events = [];
    const client = tls.connect({
      port,
      host: "127.0.0.1",
      servername: "agent1",
      rejectUnauthorized: false,
      maxVersion,
    });
    clients.push(client);
    forwarded.push(Promise.withResolvers());
    const secureConnect = new Promise(resolve => client.on("secureConnect", resolve));
    client.on("secureConnect", () => events.push(`secureConnect authorized=${client.authorized}`));
    client.on("error", () => {});
    return { events, secureConnect };
  };
  try {
    const first = connectAndEnd("TLSv1.2");
    await forwarded[0].promise;
    await pendingReadsDone();
    const second = connectAndEnd("TLSv1.3");
    await second.secureConnect;
    assert.deepStrictEqual(
      { first: first.events, second: second.events },
      { first: [], second: ["secureConnect authorized=false"] },
    );
  } finally {
    for (const client of clients) client.destroy();
    close();
  }
});

// The same shape on a net.Socket that is already connected: tls.connect({ socket }) starts the handshake on it, and
// the client calls end() in the same turn. TLS 1.3 needs no proxy here: the server's one flight completes the
// handshake after the client's FIN. Returns the ordered events of the client.
async function endMidHandshakeOnConnectedSocket(
  rejectUnauthorized,
  { trusted = false, servername = "agent1", checkServerIdentity } = {},
) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  const server = tls.createServer({ key, cert, minVersion: "TLSv1.3" }, socket => {
    socket.on("error", () => {});
    socket.write("secret-banner");
  });
  server.on("tlsClientError", () => {});
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const raw = net.connect(server.address().port, "127.0.0.1");
  raw.on("error", () => {});
  await new Promise(connected => raw.once("connect", connected));
  const client = tls.connect({
    socket: raw,
    servername,
    rejectUnauthorized,
    ...(trusted && { ca: serverCA }),
    ...(checkServerIdentity && { checkServerIdentity }),
  });
  client.on("secureConnect", () => {
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    setImmediate(() => client.destroy());
  });
  client.on("data", data => {
    events.push(`data ${data}`);
    // Data with no report of the handshake: this client must not keep the test waiting either.
    if (!events.some(event => event.startsWith("secureConnect"))) client.destroy();
  });
  client.on("error", err => events.push(`error ${err.code}`));
  client.on("close", () => {
    events.push("close");
    resolve();
  });
  client.end();
  await promise;
  raw.destroy();
  server.close();
  return events;
}

// The server's chain is trusted, but its certificate is for "agent1" and the client asked for another name. The name
// check is the client's own, in JS. It also runs for a handshake that completes after end().
for (const [transport, endWithWrongName] of [
  ["over a Duplex", options => endMidHandshake(options.rejectUnauthorized, options)],
  ["TLSv1.2 on a TCP socket", options => endMidHandshakeOverTcp("TLSv1.2", options.rejectUnauthorized, options)],
  ["TLSv1.3 on a TCP socket", options => endMidHandshakeOverTcp("TLSv1.3", options.rejectUnauthorized, options)],
  ["on a connected socket", options => endMidHandshakeOnConnectedSocket(options.rejectUnauthorized, options)],
]) {
  const wrongName = { trusted: true, servername: "another.name" };

  test(`${transport}: end() while the handshake runs does not accept a certificate for another name`, async () => {
    const events = await endWithWrongName({ ...wrongName, rejectUnauthorized: true });
    assert.deepStrictEqual(events, ["error ERR_TLS_CERT_ALTNAME_INVALID", "close"]);
  });

  test(`${transport}: end() while the handshake runs still reports a certificate for another name on the socket`, async () => {
    const events = await endWithWrongName({ ...wrongName, rejectUnauthorized: false });
    assert.strictEqual(
      events[0],
      "secureConnect authorized=false authError=ERR_TLS_CERT_ALTNAME_INVALID",
      events.join(", "),
    );
  });

  test(`${transport}: end() while the handshake runs asks the client's own checkServerIdentity`, async () => {
    const asked = [];
    const events = await endWithWrongName({
      ...wrongName,
      rejectUnauthorized: true,
      checkServerIdentity: name => void asked.push(name),
    });
    assert.deepStrictEqual(
      { asked, first: events[0] },
      { asked: ["another.name"], first: "secureConnect authorized=true authError=null" },
    );
  });
}

// A resumed handshake sends no certificate. Bun checks the name against the certificate that the session stored.
test(
  "over a Duplex: end() while a resumed handshake runs does not accept the stored certificate for another name",
  { skip: !isBun && "Node does not check the name of a resumed session" },
  async () => {
    const events = await endMidHandshake(true, { trusted: true, servername: "another.name", resumed: true });
    assert.deepStrictEqual(events, ["session reused=true", "error ERR_TLS_CERT_ALTNAME_INVALID", "close"]);
  },
);

// end(...endArgs) in the turn of tls.connect(). The handshake has not started: the socket that carries it is still
// connecting, or the engine over the Duplex does not exist yet. The server's chain is trusted, and its certificate
// is for "agent1". Returns the ordered events of the client and the names that checkServerIdentity was asked for.
async function endBeforeHandshakeStarts(overDuplex, rejectUnauthorized, ...endArgs) {
  const events = [];
  const asked = [];
  const { promise, resolve } = Promise.withResolvers();
  const server = tls.createServer({ key, cert }, socket => {
    socket.on("error", () => {});
    socket.write("secret-banner");
  });
  server.on("tlsClientError", () => {});
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const raw = net.connect(server.address().port, "127.0.0.1");
  raw.on("error", () => {});
  let transport = raw;
  if (overDuplex) {
    transport = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        raw.write(chunk, callback);
      },
      final(callback) {
        raw.end();
        callback();
      },
    });
    transport.on("error", () => {});
    raw.on("data", data => transport.push(data));
    raw.on("end", () => transport.push(null));
    raw.on("close", () => transport.destroy());
  }
  const client = tls.connect({
    socket: transport,
    servername: "another.name",
    ca: serverCA,
    rejectUnauthorized,
    checkServerIdentity(name, peerCertificate) {
      asked.push(name);
      return tls.checkServerIdentity(name, peerCertificate);
    },
  });
  client.on("secureConnect", () => {
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    setImmediate(() => client.destroy());
  });
  client.on("data", data => {
    events.push(`data ${data}`);
    // Data with no report of the handshake: this client must not keep the test waiting either.
    if (!events.some(event => event.startsWith("secureConnect"))) client.destroy();
  });
  client.on("error", err => events.push(`error ${err.code}`));
  client.on("close", () => {
    events.push("close");
    resolve();
  });
  client.end(...endArgs);
  await promise;
  raw.destroy();
  server.close();
  return { events, asked };
}

for (const overDuplex of [false, true]) {
  const transport = overDuplex ? "over a Duplex" : "over a socket that is still connecting";

  for (const endArgs of [[], [""]]) {
    const call = `end(${endArgs.map(arg => JSON.stringify(arg))})`;

    test(`${transport}: ${call} in the turn of tls.connect() does not accept a certificate for another name`, async () => {
      assert.deepStrictEqual(await endBeforeHandshakeStarts(overDuplex, true, ...endArgs), {
        events: ["error ERR_TLS_CERT_ALTNAME_INVALID", "close"],
        asked: ["another.name"],
      });
    });
  }

  test(`${transport}: end() in the turn of tls.connect() still reports a certificate for another name on the socket`, async () => {
    const { events, asked } = await endBeforeHandshakeStarts(overDuplex, false);
    assert.deepStrictEqual(
      { asked, first: events[0] },
      { asked: ["another.name"], first: "secureConnect authorized=false authError=ERR_TLS_CERT_ALTNAME_INVALID" },
    );
  });
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

// Under TLS 1.2 the server still owes the client a flight when its handshake completes. After end() that flight can
// no longer leave. The refused connection closes all the same, on both sides. A control: node:tls destroys the socket
// that it refuses, and that close does not wait for the flight.
test("TLSv1.2: a server that end()s refuses an untrusted client certificate and both sockets close", async () => {
  const events = [];
  const serverClosed = Promise.withResolvers();
  const clientClosed = Promise.withResolvers();
  let serverSocket;
  const server = tls.createServer(
    { key, cert, requestCert: true, rejectUnauthorized: true, maxVersion: "TLSv1.2" },
    () => events.push("secureConnection"),
  );
  server.on("tlsClientError", err => events.push(`tlsClientError ${err.code}`));
  server.on("connection", socket => {
    serverSocket = socket;
    socket.on("error", () => {});
    socket.on("close", serverClosed.resolve);
  });
  const { port, close } = await behindProxy(
    server,
    (downstream, upstream) => {
      let records = 0;
      let serverEnded = false;
      const held = [];
      eachRecord(downstream, record => {
        if (++records === 1 || serverEnded) return void upstream.write(record);
        held.push(record);
        if (held.length === 1) serverSocket.end();
      });
      upstream.on("data", chunk => downstream.write(chunk));
      upstream.on("end", () => {
        serverEnded = true;
        upstream.write(Buffer.concat(held.splice(0)));
      });
      // The peer answers the server's close.
      serverClosed.promise.then(() => upstream.end());
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
    maxVersion: "TLSv1.2",
  });
  client.on("secureConnect", () => events.push("secureConnect"));
  client.on("error", () => {});
  client.on("close", clientClosed.resolve);
  await Promise.all([serverClosed.promise, clientClosed.promise]);
  close();
  assert.deepStrictEqual(events, [isBun ? "tlsClientError DEPTH_ZERO_SELF_SIGNED_CERT" : "tlsClientError ECONNRESET"]);
});
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

// A client calls end() before the first step of its handshake. Returns the ordered events of the client.
async function endBeforeClientHello(
  when,
  maxVersion,
  rejectUnauthorized,
  { trusted = false, servername = "agent1" } = {},
) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  const server = tls.createServer({ key, cert, maxVersion }, socket => socket.on("error", () => {}));
  server.on("tlsClientError", () => {});
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const client = tls.connect({
    port: server.address().port,
    host: "127.0.0.1",
    servername,
    rejectUnauthorized,
    maxVersion,
    ...(trusted && { ca: serverCA }),
  });
  if (when === "in the same tick") client.end();
  else if (when === "in the next tick") process.nextTick(() => client.end());
  else client.on("connect", () => client.end());
  for (const event of ["finish", "secureConnect", "end"]) client.on(event, () => events.push(event));
  client.on("error", err => events.push(`error ${err.code}`));
  client.on("close", () => {
    events.push("close");
    resolve();
  });
  await promise;
  server.close();
  return events;
}

for (const when of ["in the same tick", "in the next tick", "inside 'connect'"]) {
  test(`TLSv1.3: end() ${when} still refuses an untrusted certificate`, async () => {
    assert.deepStrictEqual(await endBeforeClientHello(when, "TLSv1.3", true), [
      "finish",
      "error UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "close",
    ]);
  });

  test(`TLSv1.3: end() ${when} still refuses a certificate for another name`, async () => {
    const wrongName = { trusted: true, servername: "another.name" };
    assert.deepStrictEqual(await endBeforeClientHello(when, "TLSv1.3", true, wrongName), [
      "finish",
      "error ERR_TLS_CERT_ALTNAME_INVALID",
      "close",
    ]);
  });

  test(`TLSv1.3: end() ${when} still completes the handshake`, async () => {
    assert.deepStrictEqual(await endBeforeClientHello(when, "TLSv1.3", false), [
      "finish",
      "secureConnect",
      "end",
      "close",
    ]);
  });

  test(`TLSv1.2: end() ${when} reports the handshake that the server cannot complete`, async () => {
    // The client cannot send its second flight after the FIN, so the handshake ends when the server closes.
    assert.deepStrictEqual(await endBeforeClientHello(when, "TLSv1.2", false), [
      "finish",
      "end",
      "error ECONNRESET",
      "close",
    ]);
  });
}

test("end() inside 'connect' still reports a ClientHello that the client cannot build", async () => {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  const server = tls.createServer({ key, cert }, socket => socket.on("error", () => {}));
  server.on("tlsClientError", () => {});
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  // No protocol version is inside this window, so the first step of the handshake fails.
  const client = tls.connect({
    port: server.address().port,
    host: "127.0.0.1",
    rejectUnauthorized: false,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.2",
  });
  client.on("connect", () => client.end());
  client.on("secureConnect", () => events.push("secureConnect"));
  client.on("error", err => events.push(`error ${err.code}`));
  client.on("close", () => {
    events.push("close");
    resolve();
  });
  await promise;
  server.close();
  // OpenSSL and BoringSSL name the reason differently.
  assert.match(events.join(", "), /^error ERR_SSL_NO_(PROTOCOLS_AVAILABLE|SUPPORTED_VERSIONS_ENABLED), close$/);
});

test("end() inside 'connect' sends the ClientHello before the FIN", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  let accepted;
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    accepted = socket;
    const received = [];
    socket.on("error", reject);
    socket.on("data", chunk => received.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(received)));
  });
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const client = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false });
  client.on("error", () => {});
  client.on("connect", () => client.end());
  const beforeFin = await promise;
  client.destroy();
  accepted.destroy();
  server.close();
  // One complete handshake record: the ClientHello.
  assert.deepStrictEqual(
    { type: beforeFin[0], complete: beforeFin.length >= 5 && beforeFin.length === 5 + beforeFin.readUInt16BE(3) },
    { type: 22, complete: true },
  );
});

test("end() after a second connect() of the same socket sends no ClientHello", async () => {
  // Only tls.connect() starts a handshake: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1795
  const received = [];
  const second = Promise.withResolvers();
  const server = net.createServer(socket => {
    let bytes = 0;
    socket.on("error", second.reject);
    socket.on("data", chunk => (bytes += chunk.length));
    socket.on("end", () => received.push(bytes) === 2 && second.resolve());
  });
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const where = { port: server.address().port, host: "127.0.0.1" };
  const client = tls.connect({ ...where, rejectUnauthorized: false });
  client.on("error", () => {});
  client.end();
  await new Promise(closed => client.once("close", closed));
  client.connect(where);
  client.end();
  try {
    await second.promise;
    assert.strictEqual(received[1], 0);
  } finally {
    client.destroy();
    server.close();
  }
});

// Records the events of `client` in `events` and calls `closed` at 'close'. A client that was let through, or that got
// data with no report of its handshake, is destroyed, so that it does not keep its test waiting.
function recordClient(client, events, closed) {
  client.on("secureConnect", () => {
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    setImmediate(() => client.destroy());
  });
  client.on("data", data => {
    events.push(`data ${data}`);
    if (!events.some(event => event.startsWith("secureConnect"))) client.destroy();
  });
  client.on("error", err => events.push(`error ${err.code}`));
  client.on("close", () => {
    events.push("close");
    closed();
  });
}

// A handshake that did not complete is never an established session. The client below wraps a Duplex, does not call
// end(), and its peer makes the handshake fail. `peer(otherEnd)` plays the peer on the other end of the Duplex, and
// can return a function that closes what it opened. Returns the ordered events of the client.
async function failedHandshakeOverDuplex(rejectUnauthorized, peer) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  const [transport, otherEnd] = duplexPair();
  transport.on("error", () => {});
  otherEnd.on("error", () => {});
  const close = await peer(otherEnd);
  const client = tls.connect({ socket: transport, servername: "agent1", ca: serverCA, rejectUnauthorized });
  recordClient(client, events, resolve);
  await promise;
  close?.();
  return events;
}

const HANDSHAKE = 0x16;
const SERVER_KEY_EXCHANGE = 12;

// A TLS 1.2 server with a trusted certificate for "agent1". The relay in front of it changes the last byte of the
// signature in ServerKeyExchange, so the peer proves no possession of the key. The chain is already verified then.
async function trustedChainWithBadKeyProof(otherEnd) {
  const server = tls.createServer({ key, cert, maxVersion: "TLSv1.2" }, socket => socket.on("error", () => {}));
  server.on("tlsClientError", () => {});
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const upstream = net.connect(server.address().port, "127.0.0.1");
  upstream.on("error", () => {});
  otherEnd.on("data", chunk => upstream.write(chunk));
  eachRecord(upstream, record => {
    if (record[0] === HANDSHAKE) {
      // A record can carry several handshake messages: type (1 byte), length (3 bytes), body.
      for (let at = 5; at + 4 <= record.length; ) {
        const end = at + 4 + record.readUIntBE(at + 1, 3);
        if (record[at] === SERVER_KEY_EXCHANGE && end <= record.length) record[end - 1] ^= 0xff;
        at = end;
      }
    }
    otherEnd.write(record);
  });
  upstream.on("close", () => otherEnd.destroy());
  return () => {
    upstream.destroy();
    server.close();
  };
}

for (const [failure, peer] of [
  [
    "a fatal alert",
    otherEnd =>
      void otherEnd.once("data", () => otherEnd.write(Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28]))),
  ],
  [
    "bytes that are not TLS",
    otherEnd => void otherEnd.once("data", () => otherEnd.write("this is not a TLS record\n")),
  ],
  ["a trusted chain with a bad key proof", trustedChainWithBadKeyProof],
]) {
  for (const rejectUnauthorized of [true, false]) {
    test(`over a Duplex: ${failure} is an error, not a secureConnect, with rejectUnauthorized: ${rejectUnauthorized}`, async () => {
      const events = await failedHandshakeOverDuplex(rejectUnauthorized, peer);
      assert.match(events[0], /^error ERR_SSL_/, events.join(", "));
      assert.deepStrictEqual(events.slice(1), ["close"]);
    });
  }
}

// A TLS 1.2 server with a trusted certificate that requires a client certificate. The client has none, so the server's
// alert arrives after the client verified the chain.
async function serverThatRequiresClientCert(otherEnd) {
  const server = tls.createServer({ key, cert, ca: clientCA, requestCert: true, maxVersion: "TLSv1.2" });
  server.on("tlsClientError", () => {});
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const upstream = net.connect(server.address().port, "127.0.0.1");
  upstream.on("error", () => {});
  otherEnd.pipe(upstream).pipe(otherEnd);
  return () => {
    upstream.destroy();
    server.close();
  };
}

for (const rejectUnauthorized of [true, false]) {
  test(`over a Duplex: an alert behind a verified chain is reported by its name, with rejectUnauthorized: ${rejectUnauthorized}`, async () => {
    const events = await failedHandshakeOverDuplex(rejectUnauthorized, serverThatRequiresClientCert);
    assert.match(events[0], /^error ERR_SSL_.*ALERT_HANDSHAKE_FAILURE$/, events.join(", "));
    assert.deepStrictEqual(events.slice(1), ["close"]);
  });
}

const ALERT = 0x15;
const FATAL = 2;

test("over a Duplex: a client that refuses the server's key proof sends its fatal alert", async () => {
  const sent = [];
  await failedHandshakeOverDuplex(true, async otherEnd => {
    eachRecord(otherEnd, record => sent.push([record[0], record[5]]));
    return trustedChainWithBadKeyProof(otherEnd);
  });
  assert.deepStrictEqual(sent, [
    [HANDSHAKE, 1],
    [ALERT, FATAL],
  ]);
});

test("over a Duplex: a server that shares no cipher with the client sends its fatal alert", async () => {
  const [transport, otherEnd] = duplexPair();
  const server = new tls.TLSSocket(transport, {
    isServer: true,
    secureContext: tls.createSecureContext({ key, cert }),
  });
  const serverFailed = new Promise(resolve => server.once("error", resolve));
  const client = tls.connect({ socket: otherEnd, maxVersion: "TLSv1.2", ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256" });
  const clientFailed = new Promise(resolve => client.once("error", resolve));
  assert.strictEqual((await serverFailed).code, "ERR_SSL_NO_SHARED_CIPHER");
  assert.match((await clientFailed).code, /^ERR_SSL_.*ALERT_HANDSHAKE_FAILURE$/);
  server.destroy();
});

// A handshake that the peer ends with a close_notify alert. The peer keeps the transport open, so only the alert tells
// this side that no session will come.
const CLOSE_NOTIFY = Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x01, 0x00]);

// A transport with no file descriptor. `peer(chunk, transport)` gets each chunk that the TLS socket writes to it.
function transportWithPeer(peer = () => {}) {
  const transport = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      callback();
      peer(chunk, transport);
    },
  });
  return transport;
}

// A peer that calls `answer(transport)` once: on a later turn of the event loop than the first flight of the TLS
// socket, or inside the write() of that flight with `inWrite`.
function answerFirstFlight(answer, inWrite = false) {
  let answered = false;
  return (chunk, transport) => {
    if (answered) return;
    answered = true;
    if (inWrite) answer(transport);
    else setImmediate(answer, transport);
  };
}

// The events of `socket` in order. Resolves at 'close'.
function eventsUntilClose(socket) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  socket.on("secureConnect", () => events.push("secureConnect"));
  socket.on("end", () => events.push("end"));
  socket.on("error", err => events.push(`error ${err.code}: ${err.message}`));
  socket.on("close", hadError => {
    events.push(`close ${hadError}`);
    resolve(events);
  });
  return promise;
}

const DISCONNECTED_IN_HANDSHAKE = [
  "end",
  "error ECONNRESET: Client network socket disconnected before secure TLS connection was established",
  "close true",
];

for (const rejectUnauthorized of [true, false]) {
  test(`over a Duplex: a close_notify in answer to the ClientHello fails the connection, rejectUnauthorized ${rejectUnauthorized}`, async () => {
    const transport = transportWithPeer(answerFirstFlight(transport => transport.push(CLOSE_NOTIFY)));
    const client = tls.connect({ socket: transport, servername: "agent1", rejectUnauthorized });
    assert.deepStrictEqual(await eventsUntilClose(client), DISCONNECTED_IN_HANDSHAKE);
  });
}

test("over a Duplex: a close_notify that the transport delivers inside its write() fails the connection", async () => {
  const transport = transportWithPeer(answerFirstFlight(transport => transport.push(CLOSE_NOTIFY), true));
  const client = tls.connect({ socket: transport, servername: "agent1" });
  assert.deepStrictEqual(await eventsUntilClose(client), DISCONNECTED_IN_HANDSHAKE);
});

test("over a Duplex: a close_notify that is readable before tls.connect() fails the connection", async () => {
  const transport = transportWithPeer();
  transport.push(CLOSE_NOTIFY);
  const client = tls.connect({ socket: transport, servername: "agent1" });
  assert.deepStrictEqual(await eventsUntilClose(client), DISCONNECTED_IN_HANDSHAKE);
});

test("over a Duplex: a close_notify that arrives in two reads fails the connection", async () => {
  const transport = transportWithPeer(
    answerFirstFlight(transport => {
      transport.push(CLOSE_NOTIFY.subarray(0, 3));
      setImmediate(() => transport.push(CLOSE_NOTIFY.subarray(3)));
    }),
  );
  const client = tls.connect({ socket: transport, servername: "agent1" });
  assert.deepStrictEqual(await eventsUntilClose(client), DISCONNECTED_IN_HANDSHAKE);
});

test("over a Duplex: a close_notify after this side called end() fails the connection", async () => {
  const transport = transportWithPeer(
    answerFirstFlight(transport => {
      client.end();
      setImmediate(() => transport.push(CLOSE_NOTIFY));
    }),
  );
  const client = tls.connect({ socket: transport, servername: "agent1" });
  assert.deepStrictEqual(await eventsUntilClose(client), DISCONNECTED_IN_HANDSHAKE);
});

test("over a Duplex: a close_notify in place of the server's last TLS 1.2 flight fails the connection", async () => {
  // A real server answers the ClientHello, so the client has checked a trusted certificate when the alert arrives.
  let clientWrites = 0;
  const serverTransport = transportWithPeer(chunk => {
    if (clientWrites < 2) clientTransport.push(chunk);
  });
  const clientTransport = transportWithPeer((chunk, transport) => {
    clientWrites++;
    if (clientWrites === 1) serverTransport.push(chunk);
    // The client sent its last flight. It now waits for the server's ChangeCipherSpec.
    else if (clientWrites === 2) setImmediate(() => transport.push(CLOSE_NOTIFY));
  });
  const server = new tls.TLSSocket(serverTransport, {
    isServer: true,
    secureContext: tls.createSecureContext({ key, cert, maxVersion: "TLSv1.2" }),
  });
  server.on("error", () => {});
  try {
    const client = tls.connect({ socket: clientTransport, servername: "agent1", ca: serverCA });
    assert.deepStrictEqual(await eventsUntilClose(client), DISCONNECTED_IN_HANDSHAKE);
  } finally {
    server.destroy();
    serverTransport.destroy();
  }
});

test("over a TLS socket: a close_notify in answer to the inner ClientHello fails the inner connection", async () => {
  // The outer session carries the inner handshake. The outer server answers the inner ClientHello itself.
  const server = tls.createServer({ key, cert }, socket => {
    socket.on("error", () => {});
    socket.once("data", () => socket.write(CLOSE_NOTIFY));
  });
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const outer = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false });
  outer.on("error", () => {});
  try {
    await new Promise(secured => outer.once("secureConnect", secured));
    const inner = tls.connect({ socket: outer, servername: "agent1" });
    assert.deepStrictEqual(await eventsUntilClose(inner), DISCONNECTED_IN_HANDSHAKE);
  } finally {
    outer.destroy();
    server.close();
  }
});

// The same alert on a TCP socket: https://github.com/oven-sh/bun/issues/44517
for (const rejectUnauthorized of [true, false]) {
  test(`on a TCP socket: a close_notify in answer to the ClientHello fails the connection, rejectUnauthorized ${rejectUnauthorized}`, async () => {
    const peer = net.createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => socket.write(CLOSE_NOTIFY));
    });
    await new Promise(listening => peer.listen(0, "127.0.0.1", listening));
    try {
      const client = tls.connect({ port: peer.address().port, host: "127.0.0.1", rejectUnauthorized });
      assert.deepStrictEqual(await eventsUntilClose(client), DISCONNECTED_IN_HANDSHAKE);
    } finally {
      peer.close();
    }
  });
}

test("on a TCP socket: a close_notify in place of the client's last TLS 1.2 flight is a 'tlsClientError'", async () => {
  const server = tls.createServer({ key, cert, maxVersion: "TLSv1.2" });
  const reported = new Promise(resolve => server.once("tlsClientError", resolve));
  // The proxy forwards the ClientHello and answers the server's flight itself.
  const { port, close } = await behindProxy(server, (downstream, upstream) => {
    downstream.once("data", clientHello => upstream.write(clientHello));
    upstream.once("data", () => upstream.write(CLOSE_NOTIFY));
  });
  const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
  client.on("error", () => {});
  try {
    const err = await reported;
    assert.deepStrictEqual({ code: err.code, message: err.message }, { code: "ECONNRESET", message: "socket hang up" });
  } finally {
    client.destroy();
    close();
  }
});

// The peer can go away while the handshake of a socket that called end() still runs. The socket closes with no error,
// and the server reports the handshake that never finished. `half`: the peer sends the first half of its last flight
// before its FIN.
for (const maxVersion of ["TLSv1.2", "TLSv1.3"]) {
  for (const half of [false, true]) {
    test(`${maxVersion}: a server that end()s reports the handshake that its peer left ${half ? "in the middle of a flight" : "before its last flight"}`, async () => {
      const events = [];
      const refused = Promise.withResolvers();
      const serverClosed = Promise.withResolvers();
      let serverSocket;
      const server = tls.createServer({ key, cert, maxVersion }, () => events.push("secureConnection"));
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
      const client = tls.connect({
        port,
        host: "127.0.0.1",
        servername: "agent1",
        rejectUnauthorized: false,
        maxVersion,
      });
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
}

// Two in-memory Duplexes, one per side of a connection. From `stall()` on, the side named by `stalls` keeps each chunk
// and its write callback, as a transport does that has not completed the write. `release()` completes them in order.
// From `gather()` on, the chunks of the other side wait for `deliver()`, which passes them on as one chunk.
// With `peerStaysOpen`, the end() of a side does not end the other one: only the close_notify says that it closed.
function stallingPair(stalls, { peerStaysOpen = false } = {}) {
  const held = [];
  let stalled = false;
  let gathered;
  const makeSide = name =>
    new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        if (stalled && name === stalls) return void held.push([chunk, callback]);
        if (gathered && name !== stalls) gathered.push(chunk);
        else sides[name === "client" ? "server" : "client"].push(chunk);
        callback();
      },
      final(callback) {
        if (!peerStaysOpen) sides[name === "client" ? "server" : "client"].push(null);
        callback();
      },
    });
  const sides = { client: makeSide("client"), server: makeSide("server") };
  return {
    sides,
    held,
    stall: () => void (stalled = true),
    release() {
      stalled = false;
      for (const [chunk, callback] of held.splice(0)) {
        sides[stalls === "client" ? "server" : "client"].push(chunk);
        callback();
      }
    },
    gather: () => void (gathered = []),
    deliver() {
      sides[stalls].push(Buffer.concat(gathered));
      gathered = undefined;
    },
  };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

// An established session over `pair`. `writer` is the socket on the side that can stall.
async function connectOver(pair, stalls) {
  const server = new tls.TLSSocket(pair.sides.server, {
    isServer: true,
    secureContext: tls.createSecureContext({ key, cert }),
  });
  const client = tls.connect({ socket: pair.sides.client, rejectUnauthorized: false });
  await Promise.all([
    new Promise(secured => client.once("secureConnect", secured)),
    new Promise(secured => server.once("secure", secured)),
  ]);
  // The session tickets of TLS 1.3 have left the server.
  await turn();
  const [writer, reader] = stalls === "server" ? [server, client] : [client, server];
  return { client, server, writer, reader };
}

// The peer's close_notify does not end the session while the transport still has a write. Node completes that write
// and the ones queued behind it. An answer at once fails them all, with an 'error' that an application which only
// called write() does not expect.
for (const side of ["client", "server"]) {
  for (const ends of [false, true]) {
    test(`over a Duplex: a ${side} write in flight and the write behind it complete when the peer closes its side first${ends ? ", and so does an end() behind them" : ""}`, async () => {
      const pair = stallingPair(side);
      const { client, server, writer, reader } = await connectOver(pair, side);
      const log = [];
      let received = "";
      const bothReceived = Promise.withResolvers();
      const bothWritten = Promise.withResolvers();
      reader.on("data", chunk => {
        received += chunk;
        if (received.length === 2) bothReceived.resolve();
      });
      // It reads the peer's close.
      writer.resume();
      writer.on("error", err => log.push(`'error': ${err.message}`));
      reader.on("error", err => log.push(`peer 'error': ${err.message}`));
      const closed = new Promise(resolve => writer.once("close", resolve));
      try {
        pair.stall();
        writer.write("x", err => log.push(`write callback: ${err?.message}`));
        writer.write("y", err => {
          log.push(`queued write callback: ${err?.message}`);
          bothWritten.resolve();
        });
        await turn();
        // The peer's close_notify, then its end of the Duplex. A socket that closes at the close_notify destroys the Duplex.
        const transportEnded = new Promise(resolve => pair.sides[side].once("end", resolve));
        reader.end();
        await Promise.race([transportEnded, closed]);
        await turn();
        assert.deepStrictEqual({ held: pair.held.length, log }, { held: 1, log: [] });
        if (ends) writer.end();
        pair.release();

        await Promise.all([bothWritten.promise, bothReceived.promise]);
        assert.deepStrictEqual(
          { received, log },
          { received: "xy", log: ["write callback: undefined", "queued write callback: undefined"] },
        );
        // A socket over a half-open Duplex stays writable until its own end().
        if (ends) await closed;
      } finally {
        client.destroy();
        server.destroy();
      }
    });
  }
}

for (const side of ["client", "server"]) {
  // The close_notify is the peer's EOF. Node reports it at once and keeps the socket open for the write. An
  // application that reads until 'end' must not wait for a transport that is slow to complete that write.
  test(`over a Duplex: a ${side} reports 'end' at the peer's close_notify while its write is in flight`, async () => {
    const pair = stallingPair(side, { peerStaysOpen: true });
    const { client, server, writer, reader } = await connectOver(pair, side);
    const log = [];
    let received = "";
    const arrived = Promise.withResolvers();
    const written = Promise.withResolvers();
    reader.on("data", chunk => {
      received += chunk;
      arrived.resolve();
    });
    writer.resume();
    writer.on("end", () => log.push("'end'"));
    writer.on("error", err => log.push(`'error': ${err.message}`));
    reader.on("error", err => log.push(`peer 'error': ${err.message}`));
    try {
      pair.stall();
      writer.write("x", err => {
        log.push(`write callback: ${err?.message}`);
        written.resolve();
      });
      await turn();
      // The next chunk of the writer's transport is the peer's close_notify. The TLS socket reads it first.
      const closeNotify = new Promise(resolve => pair.sides[side].once("data", resolve));
      reader.end();
      await closeNotify;
      await turn();
      assert.deepStrictEqual({ held: pair.held.length, log }, { held: 1, log: ["'end'"] });
      pair.release();

      await Promise.all([written.promise, arrived.promise]);
      assert.deepStrictEqual({ received, log }, { received: "x", log: ["'end'", "write callback: undefined"] });
    } finally {
      client.destroy();
      server.destroy();
    }
  });

  // The peer's last data and its close_notify can arrive in one read. The answer that the 'data' handler writes is
  // a write in flight like one that began earlier.
  test(`over a Duplex: a ${side} completes the writes of its 'data' handler when the same chunk carries the peer's close_notify`, async () => {
    const pair = stallingPair(side, { peerStaysOpen: true });
    const { client, server, writer, reader } = await connectOver(pair, side);
    const log = [];
    let received = "";
    const bothReceived = Promise.withResolvers();
    const bothWritten = Promise.withResolvers();
    reader.on("data", chunk => {
      received += chunk;
      if (received.length === 2) bothReceived.resolve();
    });
    writer.on("data", request => {
      log.push(`'data': ${request}`);
      writer.write("x", err => log.push(`write callback: ${err?.message}`));
      writer.write("y", err => {
        log.push(`queued write callback: ${err?.message}`);
        bothWritten.resolve();
      });
    });
    writer.on("error", err => log.push(`'error': ${err.message}`));
    reader.on("error", err => log.push(`peer 'error': ${err.message}`));
    try {
      pair.stall();
      pair.gather();
      // The peer ends its transport after its close_notify.
      const closeNotifyLeft = new Promise(resolve =>
        pair.sides[side === "client" ? "server" : "client"].once("finish", resolve),
      );
      reader.end("request");
      await closeNotifyLeft;
      pair.deliver();
      await turn();
      assert.deepStrictEqual({ held: pair.held.length, log }, { held: 1, log: ["'data': request"] });
      pair.release();

      await Promise.all([bothWritten.promise, bothReceived.promise]);
      assert.deepStrictEqual(
        { received, log },
        { received: "xy", log: ["'data': request", "write callback: undefined", "queued write callback: undefined"] },
      );
    } finally {
      client.destroy();
      server.destroy();
    }
  });

  // A transport can complete a write and pass on the peer's close_notify in one callback. The socket then has not
  // heard of the completed write, and it still holds the write that it queued behind it.
  test(`over a Duplex: a ${side} completes the write behind one that its transport completes in the callback that delivers the peer's close_notify`, async () => {
    const pair = stallingPair(side, { peerStaysOpen: true });
    const { client, server, writer, reader } = await connectOver(pair, side);
    const log = [];
    let received = "";
    const bothReceived = Promise.withResolvers();
    const bothWritten = Promise.withResolvers();
    reader.on("data", chunk => {
      received += chunk;
      if (received.length === 2) bothReceived.resolve();
    });
    writer.resume();
    writer.on("error", err => log.push(`'error': ${err.message}`));
    reader.on("error", err => log.push(`peer 'error': ${err.message}`));
    try {
      pair.stall();
      writer.write("x", err => log.push(`write callback: ${err?.message}`));
      writer.write("y", err => {
        log.push(`queued write callback: ${err?.message}`);
        bothWritten.resolve();
      });
      await turn();
      pair.gather();
      // The peer ends its transport after its close_notify.
      const closeNotifyLeft = new Promise(resolve =>
        pair.sides[side === "client" ? "server" : "client"].once("finish", resolve),
      );
      reader.end();
      await closeNotifyLeft;
      pair.release();
      pair.deliver();

      await bothWritten.promise;
      assert.deepStrictEqual(log, ["write callback: undefined", "queued write callback: undefined"]);
      await bothReceived.promise;
      assert.strictEqual(received, "xy");
    } finally {
      client.destroy();
      server.destroy();
    }
  });
}

test("over a Duplex: what the peer sends behind its close_notify is not kept while a write is in flight", async () => {
  const pair = stallingPair("client", { peerStaysOpen: true });
  const { client, server, writer, reader } = await connectOver(pair, "client");
  const log = [];
  let received = "";
  const arrived = Promise.withResolvers();
  const written = Promise.withResolvers();
  reader.on("data", chunk => {
    received += chunk;
    arrived.resolve();
  });
  writer.resume();
  writer.on("error", err => log.push(`'error': ${err.message}`));
  reader.on("error", err => log.push(`peer 'error': ${err.message}`));
  try {
    pair.stall();
    writer.write("x", err => {
      log.push(`write callback: ${err?.message}`);
      written.resolve();
    });
    await turn();
    // The next chunk of the writer's transport is the peer's close_notify. The TLS socket reads it first.
    const closeNotify = new Promise(resolve => pair.sides.client.once("data", resolve));
    reader.end();
    await closeNotify;
    const flood = Buffer.alloc(1024 * 1024, 0x17);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 128; i++) pair.sides.client.push(flood);
    await turn();
    const kept = process.memoryUsage.rss() - before;
    pair.release();

    await Promise.all([written.promise, arrived.promise]);
    assert.deepStrictEqual({ received, log }, { received: "x", log: ["write callback: undefined"] });
    // 128 MiB went in. Node's own buffering is not what this checks.
    if (isBun) assert.ok(kept < (isDebugOrASAN ? 64 : 32) * 1024 * 1024, `kept ${kept} bytes`);
  } finally {
    client.destroy();
    server.destroy();
  }
});

// Node's TLSWrap reads the handle of the socket it wraps, so that socket never hears of the peer's FIN. One that did
// would end its own side at the FIN (allowHalfOpen is false by default) and refuse what the TLS socket still has to send.
for (const side of ["client", "server"]) {
  test(`over a TLS socket: a ${side} write in flight and the write behind it complete when the peer closes its side first`, async () => {
    const accepted = Promise.withResolvers();
    const listener = tls.createServer({ key, cert }, accepted.resolve);
    await new Promise(listening => listener.listen(0, "127.0.0.1", listening));
    const outerClient = tls.connect({ port: listener.address().port, host: "127.0.0.1", rejectUnauthorized: false });
    const outerServer = await accepted.promise;
    const log = [];
    for (const outer of [outerClient, outerServer]) outer.on("error", err => log.push(`outer 'error': ${err.code}`));
    const server = new tls.TLSSocket(outerServer, { isServer: true, key, cert });
    const client = tls.connect({ socket: outerClient, rejectUnauthorized: false });
    try {
      await Promise.all([
        new Promise(secured => client.once("secureConnect", secured)),
        new Promise(secured => server.once("secure", secured)),
      ]);
      const [writer, reader] = side === "client" ? [client, server] : [server, client];
      let received = 0;
      reader.on("data", chunk => (received += chunk.length));
      const readerEnded = new Promise(ended => reader.once("end", ended));
      writer.resume();
      writer.on("error", err => log.push(`'error': ${err.code}`));
      reader.on("error", err => log.push(`peer 'error': ${err.code}`));

      // More than the kernel takes at once, so the outer socket still has it when the peer's FIN arrives.
      const first = Buffer.alloc(8 * 1024 * 1024, "a");
      writer.write(first, err => log.push(`write callback: ${err?.code}`));
      writer.write("tail", err => log.push(`queued write callback: ${err?.code}`));
      reader.end();
      await readerEnded;
      assert.deepStrictEqual(
        { received, log },
        { received: first.length + 4, log: ["write callback: undefined", "queued write callback: undefined"] },
      );
    } finally {
      client.destroy();
      server.destroy();
      outerClient.destroy();
      outerServer.destroy();
      listener.close();
    }
  });
}

// The peer's close_notify ends the read side only. What this side still says, and when it closes, is up to its own end().
for (const side of ["client", "server"]) {
  test(`over a Duplex: a ${side} answers after the peer closed its side, however late, and then closes with its own end()`, async () => {
    const pair = stallingPair(side);
    const { client, server, writer, reader } = await connectOver(pair, side);
    const log = [];
    let received = "";
    reader.on("data", chunk => (received += chunk));
    const readerEnded = new Promise(ended => reader.once("end", ended));
    for (const [name, socket] of [
      ["", writer],
      ["peer ", reader],
    ]) {
      socket.on("error", err => log.push(`${name}'error': ${err.message}`));
    }
    try {
      const writerEnded = new Promise(ended => writer.once("end", ended));
      writer.resume();
      reader.end("request");
      await writerEnded;
      // Long after the transport was last busy.
      await turn();
      await turn();
      assert.deepStrictEqual(
        { destroyed: writer.destroyed, writable: writer.writable },
        { destroyed: false, writable: true },
      );
      for (const piece of ["a ", "late ", "reply"]) {
        writer.write(piece, err => log.push(`write callback: ${err?.message}`));
        await turn();
      }
      const closed = new Promise(resolve => writer.once("close", resolve));
      writer.end();
      await Promise.all([readerEnded, closed]);
      assert.deepStrictEqual(
        { received, log },
        { received: "a late reply", log: Array(3).fill("write callback: undefined") },
      );
    } finally {
      client.destroy();
      server.destroy();
    }
  });
}

// A reader that gets the data and then a bare EOF cannot tell the end of the data from a cut. TLS 1.2 keeps the record type readable.
test("over a Duplex: the close_notify follows a write that was in flight when the peer closed, after the transport's own EOF too", async () => {
  const types = [];
  const pair = stallingPair("client");
  const write = pair.sides.client._write;
  pair.sides.client._write = function (chunk, encoding, callback) {
    for (let rest = chunk; rest.length >= 5; rest = rest.subarray(5 + rest.readUInt16BE(3))) types.push(rest[0]);
    write.call(this, chunk, encoding, callback);
  };
  const server = new tls.TLSSocket(pair.sides.server, {
    isServer: true,
    secureContext: tls.createSecureContext({ key, cert, maxVersion: "TLSv1.2" }),
  });
  const client = tls.connect({ socket: pair.sides.client, rejectUnauthorized: false });
  const log = [];
  client.on("error", err => log.push(`'error': ${err.message}`));
  server.on("error", err => log.push(`peer 'error': ${err.message}`));
  try {
    await Promise.all([
      new Promise(secured => client.once("secureConnect", secured)),
      new Promise(secured => server.once("secure", secured)),
    ]);
    server.resume();
    client.resume();
    types.length = 0;
    pair.stall();
    client.write("x");
    await turn();
    const transportEnded = new Promise(ended => pair.sides.client.once("end", ended));
    server.end();
    await transportEnded;
    const closed = new Promise(resolve => client.once("close", resolve));
    client.end();
    pair.release();
    await closed;
    // 23 is application data, 21 an alert.
    assert.deepStrictEqual({ types, log }, { types: [23, 21], log: [] });
  } finally {
    client.destroy();
    server.destroy();
  }
});

// Nothing but that stream can say whether its write is still worth waiting for.
test("over a Duplex: a write that the stream never completes does not keep the process alive after the peer closed", async () => {
  const { spawn } = await import("node:child_process");
  const script = `
    const tls = require("node:tls"), { Duplex } = require("node:stream"), fs = require("node:fs");
    const [key, cert] = ${JSON.stringify([new URL("./fixtures/agent1-key.pem", import.meta.url).pathname, new URL("./fixtures/agent1-cert.pem", import.meta.url).pathname])}.map(f => fs.readFileSync(f));
    let holds = false;
    const a = new Duplex({ read() {}, write(c, e, cb) { if (holds) return; b.push(c); cb(); }, final(cb) { b.push(null); cb(); } });
    const b = new Duplex({ read() {}, write(c, e, cb) { a.push(c); cb(); }, final(cb) { a.push(null); cb(); } });
    const server = new tls.TLSSocket(b, { isServer: true, key, cert });
    const client = tls.connect({ socket: a, rejectUnauthorized: false });
    server.resume();
    client.resume();
    client.once("end", () => { holds = true; client.write("never completed"); });
    client.once("secureConnect", () => setImmediate(() => server.end()));
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "inherit", "inherit"] });
  const [exitCode, signal] = await new Promise(exited => child.once("exit", (...status) => exited(status)));
  assert.deepStrictEqual({ exitCode, signal }, { exitCode: 0, signal: null });
});

// Node leaves both sockets open for good here. A peer must not be able to hold a connection that way.
for (const side of ["client", "server"]) {
  test(
    `over a TLS socket: a ${side} write that waits for the handshake does not hold the connection after the peer's FIN`,
    { skip: !isBun },
    async () => {
      const accepted = Promise.withResolvers();
      const listener = tls.createServer({ key, cert }, accepted.resolve);
      await new Promise(listening => listener.listen(0, "127.0.0.1", listening));
      const outerClient = tls.connect({ port: listener.address().port, host: "127.0.0.1", rejectUnauthorized: false });
      const outerServer = await accepted.promise;
      const [outer, peer] = side === "client" ? [outerClient, outerServer] : [outerServer, outerClient];
      for (const socket of [outer, peer]) socket.on("error", () => {});
      peer.resume();
      const inner =
        side === "client"
          ? tls.connect({ socket: outer, rejectUnauthorized: false })
          : new tls.TLSSocket(outer, { isServer: true, key, cert });
      try {
        inner.on("error", () => {});
        const closed = [inner, outer].map(socket => new Promise(resolve => socket.once("close", resolve)));
        const written = new Promise(resolve => inner.write("early", err => resolve(err?.code)));
        // The peer never takes part in the inner handshake.
        peer.end();
        await Promise.all(closed);
        assert.notStrictEqual(await written, undefined);
      } finally {
        inner.destroy();
        outerClient.destroy();
        outerServer.destroy();
        listener.close();
      }
    },
  );
}
