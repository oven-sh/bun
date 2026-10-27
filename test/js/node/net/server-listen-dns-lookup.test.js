// server.listen(port, host) resolves host through dns.lookup(host, { all: true }) in every process,
// as Node's lookupAndListen does: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L2259-L2278
// Written with node:test so the same file runs under Node.
const { test, mock } = require("node:test");
const assert = require("node:assert");
const dns = require("node:dns");
const net = require("node:net");
const tls = require("node:tls");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const fixture = name => readFileSync(join(__dirname, "..", "tls", "fixtures", name), "utf8");

const realLookup = dns.lookup;

function mockLookup(table) {
  const calls = [];
  mock.method(dns, "lookup", (hostname, options, callback) => {
    calls.push({ hostname, options });
    if (hostname in table) {
      const result = table[hostname];
      process.nextTick(() => (result instanceof Error ? callback(result) : callback(null, result)));
    } else {
      realLookup(hostname, options, callback);
    }
  });
  return calls;
}

function listenOutcome(server, ...args) {
  return new Promise(resolve => {
    server.once("error", error => resolve({ error }));
    server.listen(...args, () => resolve({ address: server.address() }));
  });
}

test("the host is resolved with dns.lookup and the server binds the resolved address", async t => {
  t.after(() => mock.restoreAll());
  const calls = mockLookup({ "my-alias.test": [{ address: "127.0.0.1", family: 4 }] });
  const server = net.createServer();
  try {
    const { error, address } = await listenOutcome(server, 0, "my-alias.test");
    assert.strictEqual(error, undefined);
    assert.strictEqual(address.address, "127.0.0.1");
    assert.strictEqual(address.family, "IPv4");
    assert.deepStrictEqual(
      calls.map(c => [c.hostname, c.options.all]),
      [["my-alias.test", true]],
    );
  } finally {
    server.close();
  }
});

test("a lookup error is emitted as the server's 'error' unchanged", async t => {
  t.after(() => mock.restoreAll());
  const lookupError = Object.assign(new Error("getaddrinfo ENOTFOUND nowhere.test"), {
    code: "ENOTFOUND",
    syscall: "getaddrinfo",
    hostname: "nowhere.test",
  });
  mockLookup({ "nowhere.test": lookupError });
  const server = net.createServer();
  const { error } = await listenOutcome(server, 0, "nowhere.test");
  assert.strictEqual(error, lookupError);
  assert.strictEqual(server.listening, false);
});

test("a bind failure on the resolved address is an 'error' event with the resolved address", async t => {
  t.after(() => mock.restoreAll());
  // TEST-NET-1 (RFC 5737) is never assigned to a local interface.
  mockLookup({ "unbindable.test": [{ address: "192.0.2.1", family: 4 }] });
  const server = net.createServer();
  const { error } = await listenOutcome(server, 0, "unbindable.test");
  assert.strictEqual(error.code, "EADDRNOTAVAIL");
  assert.strictEqual(error.syscall, "listen");
  assert.strictEqual(error.address, "192.0.2.1");
  assert.strictEqual(server.listening, false);
});

test("close() before the lookup answers cancels the listen", async t => {
  t.after(() => mock.restoreAll());
  mockLookup({ "slow.test": [{ address: "127.0.0.1", family: 4 }] });
  const server = net.createServer();
  const onListening = mock.fn();
  const onError = mock.fn();
  server.on("listening", onListening);
  server.on("error", onError);
  server.listen(0, "slow.test");
  server.close();
  // The mocked lookup answers on the next tick; give the loop a few turns after it.
  await new Promise(resolve => setImmediate(() => setImmediate(resolve)));
  assert.strictEqual(onListening.mock.callCount(), 0);
  assert.strictEqual(onError.mock.callCount(), 0);
  assert.strictEqual(server.listening, false);
  assert.strictEqual(server.address(), null);
});

test("a tls.Server resolves its host the same way", async t => {
  t.after(() => mock.restoreAll());
  const calls = mockLookup({ "tls-alias.test": [{ address: "127.0.0.1", family: 4 }] });
  const server = tls.createServer();
  try {
    const { error, address } = await listenOutcome(server, 0, "tls-alias.test");
    assert.strictEqual(error, undefined);
    assert.strictEqual(address.address, "127.0.0.1");
    assert.deepStrictEqual(
      calls.map(c => c.hostname),
      ["tls-alias.test"],
    );
  } finally {
    server.close();
  }
});

test("a setSecureContext() made while the host is being resolved is the one served", async t => {
  t.after(() => mock.restoreAll());
  mockLookup({ "tls-switch.test": [{ address: "127.0.0.1", family: 4 }] });
  const server = tls.createServer({ key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem") });
  try {
    const listening = listenOutcome(server, 0, "tls-switch.test");
    server.setSecureContext({ key: fixture("agent2-key.pem"), cert: fixture("agent2-cert.pem") });
    const { error, address } = await listening;
    assert.strictEqual(error, undefined);
    const subjectCN = await new Promise((resolve, reject) => {
      const client = tls.connect({ port: address.port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
        const cn = client.getPeerCertificate().subject.CN;
        client.destroy();
        resolve(cn);
      });
      client.on("error", reject);
    });
    assert.strictEqual(subjectCN, "agent2");
  } finally {
    server.close();
  }
});
