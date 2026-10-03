// A TLS handshake that finishes after this side shut its write direction down keeps the certificate verdict.
// Runs under node:test, so the same file runs on node (`node --test`) and on bun (`bun test`).
import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import { Duplex, duplexPair } from "node:stream";
import { test } from "node:test";
import tls from "node:tls";
import { Worker } from "node:worker_threads";

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

// The same shape on a plain TCP socket. The client calls end() when its last handshake flight left. The proxy holds
// the server's final flight until the client's FIN arrived, so the handshake completes on a socket that is already
// shut down. The proxy never forwards the FIN, so the server keeps writing. The server's certificate is not trusted,
// unless `trusted`. Returns the ordered events of the client.
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
      downstream.on("end", async () => {
        await inPieces(part => downstream.write(part), Buffer.concat(held.splice(0)), pieces);
        clientEnded = true;
        for (const chunk of held.splice(0)) downstream.write(chunk);
      });
      upstream.on("data", chunk => {
        if (ending && !clientEnded) held.push(chunk);
        else downstream.write(chunk);
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

  for (const rejectUnauthorized of [false, true]) {
    test(`TLSv1.2, rejectUnauthorized ${rejectUnauthorized}: end() ${when} reports the handshake that the server cannot complete`, async () => {
      // The client cannot send its second flight after the FIN, so the handshake ends when the server closes.
      assert.deepStrictEqual(await endBeforeClientHello(when, "TLSv1.2", rejectUnauthorized), [
        "finish",
        "end",
        "error ECONNRESET",
        "close",
      ]);
    });
  }
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

for (const method of ["end", "destroySoon"]) {
  test(`${method}() inside 'connect' sends the ClientHello before the FIN`, async () => {
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
    client.on("connect", () => client[method]());
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
}

test(
  "the handle refuses a write after shutdown() inside 'connect'",
  { skip: !isBun && "Node's handle has another interface" },
  async () => {
    const server = net.createServer(socket => socket.on("error", () => {}).resume());
    await new Promise(listening => server.listen(0, "127.0.0.1", listening));
    const client = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false });
    const written = await new Promise((resolve, reject) => {
      client.on("error", reject);
      client.on("connect", () => {
        client._handle.shutdown();
        resolve(client._handle.write("x"));
      });
    });
    client.destroy();
    server.close();
    assert.strictEqual(written, -1);
  },
);

test("TLSv1.3: twelve clients that end() in the same tick all complete the handshake", async () => {
  // One turn of the event loop takes a few handshakes and the others wait for the next. This thread blocks until the
  // server has answered and closed every connection, so they wait with the server's FIN already here.
  const total = 12;
  const closed = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(
    `const { parentPort, workerData } = require("node:worker_threads");
    const { key, cert, closed } = workerData;
    const server = require("node:tls").createServer({ key, cert }, socket => socket.on("error", () => {}));
    server.on("tlsClientError", () => {});
    server.on("connection", socket =>
      socket.on("close", () => {
        Atomics.add(closed, 0, 1);
        Atomics.notify(closed, 0);
      }),
    );
    server.listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port));`,
    { eval: true, workerData: { key, cert, closed } },
  );
  try {
    const port = await new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.once("message", resolve);
    });
    let finished = 0;
    const clients = await Promise.all(
      Array.from({ length: total }, () => {
        const events = [];
        const { promise, resolve } = Promise.withResolvers();
        const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
        client.end();
        for (const event of ["secureConnect", "end"]) client.on(event, () => events.push(event));
        client.on("error", err => events.push(`error ${err.code}`));
        client.on("close", () => resolve(events.join(", ")));
        client.on("finish", () => {
          if (++finished < total) return;
          // The last FIN leaves when this turn's callbacks have run.
          setImmediate(() => {
            for (let count; (count = Atomics.load(closed, 0)) < total; ) Atomics.wait(closed, 0, count);
          });
        });
        return promise;
      }),
    );
    assert.deepStrictEqual([...new Set(clients)], ["secureConnect, end"]);
  } finally {
    await worker.terminate();
  }
});

test(
  "TLSv1.2: end() in the same tick does not accept the stored certificate of a resumed session for another name",
  { skip: !isBun && "Node does not check the name of a resumed session" },
  async () => {
    const server = tls.createServer({ key, cert, maxVersion: "TLSv1.2" }, socket => socket.on("error", () => {}));
    server.on("tlsClientError", () => {});
    await new Promise(listening => server.listen(0, "127.0.0.1", listening));
    const where = { port: server.address().port, host: "127.0.0.1", ca: serverCA };
    const first = tls.connect({ ...where, servername: "agent1" });
    await new Promise((connected, failed) => first.once("secureConnect", connected).once("error", failed));
    const session = first.getSession();
    first.destroy();
    // The client's part of a resumed handshake comes last, so the handshake completes after the FIN.
    const events = [];
    const client = tls.connect({ ...where, servername: "another.name", session });
    client.end();
    client.on("secureConnect", () => events.push("secureConnect"));
    client.on("error", err => events.push(`error ${err.code}`));
    await new Promise(closed => client.once("close", closed));
    server.close();
    assert.deepStrictEqual(events, ["error ERR_TLS_CERT_ALTNAME_INVALID"]);
  },
);

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

test(
  "resetAndDestroy() behind an end() in the same tick still resets the connection",
  { skip: !isBun && "Node does not reset a TLS socket" },
  async () => {
    const { promise, resolve } = Promise.withResolvers();
    const server = net.createServer(socket => {
      socket.on("error", () => {});
      // A connection that was reset refuses the write. One that was only closed takes it.
      socket.on("end", () => socket.write("x", resolve));
      socket.resume();
    });
    await new Promise(listening => server.listen(0, "127.0.0.1", listening));
    const client = tls.connect({ port: server.address().port, host: "127.0.0.1" });
    client.on("error", () => {});
    client.on("finish", () => client.resetAndDestroy());
    client.end();
    const refused = await promise;
    server.close();
    assert.ok(refused, "the peer's write went through");
  },
);
