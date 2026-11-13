// connect() on a net.Socket or TLSSocket whose handle still owns a socket.
// The tests call the scenarios and pin what they return. The file has no bun import, so that
// `node <this file> <directory> <scenario>...` prints what node returns for them.
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";

// Greets each connection, and answers "count?" with the number of connections it has accepted.
// `at` is a path to listen on. `host` is an address, or null for the default one.
async function listen({ greeting = "hello", at, host = HOST } = {}) {
  const accepted = [];
  const left = [];
  let probes = 0;
  const server = net.createServer({ allowHalfOpen: true }, c => {
    accepted.push(c);
    left.push(new Promise(resolve => c.once("end", resolve).once("error", resolve)));
    c.on("error", () => {});
    c.on("data", d => {
      if (String(d).includes("count?")) c.write(`accepted=${accepted.length - probes};`);
    });
    if (greeting) c.write(greeting);
  });
  if (at) server.listen(at);
  else if (host === null) server.listen(0);
  else server.listen(0, host);
  await once(server, "listening");
  const port = at ? undefined : server.address().port;
  return {
    accepted,
    at,
    port,
    // Settles when connection i saw the FIN or the reset of its peer.
    left,
    // The connections that were dialed to this server. The server accepts in the order of the dials,
    // so it has accepted every earlier one when it answers the probe.
    async dialed() {
      probes++;
      const probe = at ? net.connect({ path: at }) : net.connect(port, host ?? HOST);
      let answer = "";
      probe.on("data", d => (answer += d));
      probe.write("count?");
      while (!answer.includes(";")) await once(probe, "data");
      probe.destroy();
      return Number(answer.match(/accepted=(\d+);/)[1]);
    },
    close() {
      for (const c of accepted) c.destroy();
      server.close();
    },
  };
}

async function listenTLS() {
  const keys = new URL("../test/fixtures/keys/", import.meta.url);
  const accepted = [];
  const server = tls.createServer(
    { key: fs.readFileSync(new URL("agent1-key.pem", keys)), cert: fs.readFileSync(new URL("agent1-cert.pem", keys)) },
    c => {
      accepted.push(c);
      c.on("error", () => {});
      c.write("hello");
    },
  );
  server.listen(0, HOST);
  await once(server, "listening");
  return {
    port: server.address().port,
    close() {
      for (const c of accepted) c.destroy();
      server.close();
    },
  };
}

// The events of `s` in order, its data, and its errors. `names` maps a placeholder to the text that
// differs from run to run (a port, a path).
function record(s, names = {}) {
  const events = [];
  const errors = [];
  let data = "";
  let wake = () => {};
  let isClosed = false;
  const scrub = text => {
    text = String(text).replace(/Local \([^)]*\)/, "Local (ADDRESS)");
    for (const [name, value] of Object.entries(names)) text = text.replaceAll(String(value), name);
    return text;
  };
  for (const e of ["connect", "ready", "secureConnect", "end"]) s.on(e, () => events.push(e));
  for (const e of ["connectionAttempt", "connectionAttemptFailed"]) s.on(e, ip => events.push(`${e} ${scrub(ip)}`));
  s.on("error", e => {
    events.push(`error ${e.code} ${e.syscall}`);
    const address = e.address === undefined ? undefined : scrub(e.address);
    errors.push({ message: scrub(e.message), code: e.code, syscall: e.syscall, address });
  });
  s.on("data", d => {
    data += d;
    wake();
  });
  const closed = new Promise(resolve => {
    s.on("close", hadError => {
      events.push(`close ${hadError}`);
      isClosed = true;
      wake();
      resolve();
    });
  });
  return {
    // Copies: what a scenario's own cleanup makes the socket report is not part of its result.
    get events() {
      return [...events];
    },
    get errors() {
      return [...errors];
    },
    names,
    data: () => data,
    closed,
    // Settles when `text` arrived, or when the socket closed without it.
    async until(text) {
      while (!data.includes(text) && !isClosed) await new Promise(resolve => (wake = resolve));
    },
  };
}

// What the connect() call came to: "connect" when the socket said it again, "close" when the call destroyed it.
function outcomeOf(s) {
  return new Promise(resolve => {
    const done = name => () => {
      s.removeListener("connect", onConnect);
      s.removeListener("close", onClose);
      resolve(name);
    };
    const onConnect = done("connect");
    const onClose = done("close");
    s.once("connect", onConnect);
    s.once("close", onClose);
  });
}

async function connectedClient(peer, options, names) {
  const s = net.connect({ port: peer.port, host: HOST, ...options });
  const r = record(s, { PORT: peer.port, ...names });
  await once(s, "connect");
  await r.until("hello");
  return { s, r };
}

async function connectedTLSClient(peer, names) {
  const s = tls.connect({ port: peer.port, host: HOST, rejectUnauthorized: false });
  const r = record(s, { PORT: peer.port, ...names });
  await once(s, "secureConnect");
  await r.until("hello");
  return { s, r };
}

// Two addresses for one name: the connect takes the path that walks a list of addresses.
// Nothing has to listen on the second one: an attempt on it is in the events.
const twoAddresses = (port, first = HOST, second = "127.0.0.2") => ({
  port,
  host: "reconnect-live.invalid",
  autoSelectFamily: true,
  lookup: (host, options, cb) =>
    cb(null, [
      { address: first, family: 4 },
      { address: second, family: 4 },
    ]),
});

// A second connect() with the path of `unix`, on the handle of `s`.
async function thenPath(s, r, unix) {
  s.connect({ path: unix.at });
  const destroyedInCall = s.destroyed;
  const outcome = await outcomeOf(s);
  s.destroy();
  return { outcome, destroyedInCall, events: r.events, errors: r.errors, dialed: await unix.dialed() };
}

// A second connect() with the port of `peer`.
async function thenPort(s, peer) {
  s.connect({ port: peer.port, host: HOST, rejectUnauthorized: false });
  const outcome = await outcomeOf(s);
  s.destroy();
  return { outcome };
}

export const scenarios = {
  // ---- Calls that node's handle refuses too.

  async "in-flight"() {
    const peer = await listen();
    const s = new net.Socket();
    const r = record(s, { PORT: peer.port });
    s.connect(peer.port, HOST);
    s.connect(peer.port, HOST);
    const outcome = await outcomeOf(s);
    s.destroy();
    peer.close();
    return { outcome, events: r.events, errors: r.errors };
  },

  async "lookup-twice"() {
    const peer = await listen();
    const s = new net.Socket();
    const r = record(s, { PORT: peer.port });
    s.connect({
      port: peer.port,
      host: "reconnect-live.invalid",
      lookup(host, options, cb) {
        const answer = options.all ? [[{ address: HOST, family: 4 }]] : [HOST, 4];
        cb(null, ...answer);
        cb(null, ...answer);
      },
    });
    const outcome = await outcomeOf(s);
    s.destroy();
    peer.close();
    return { outcome, events: r.events, errors: r.errors };
  },

  // A socket that a server accepted has a connection and no connect request.
  async accepted() {
    const peer = await listen();
    const other = await listen({ greeting: "OTHER" });
    const client = net.connect(peer.port, HOST);
    const c = record(client);
    await once(client, "connect");
    await c.until("hello");
    const accepted = peer.accepted[0];
    const r = record(accepted, { PORT: other.port });
    accepted.connect(other.port, HOST);
    const outcome = await outcomeOf(accepted);
    accepted.destroy();
    await c.closed;
    const result = { outcome, events: r.events, errors: r.errors, dialed: await other.dialed(), client: c.events };
    peer.close();
    other.close();
    return result;
  },

  // The socket sent its FIN. Its handle owns the socket until the peer closes too.
  async "after-end"() {
    const peer = await listen();
    const { s, r } = await connectedClient(peer);
    s.end();
    await peer.left[0];
    s.connect(peer.port, HOST);
    const outcome = await outcomeOf(s);
    s.destroy();
    const result = { outcome, events: r.events, errors: r.errors, dialed: await peer.dialed() };
    peer.close();
    return result;
  },

  // bind(2) of a socket that is connected.
  async "local-address"() {
    const peer = await listen();
    const { s, r } = await connectedClient(peer);
    s.connect({ port: peer.port, host: HOST, localAddress: HOST });
    const outcome = await outcomeOf(s);
    s.destroy();
    const result = { outcome, events: r.events, errors: r.errors, dialed: await peer.dialed() };
    peer.close();
    return result;
  },

  // A path on a TCP handle. node hands the path to uv_ip4_addr, and EINVAL is that parse failing:
  // https://github.com/nodejs/node/blob/v26.3.0/src/tcp_wrap.cc#L433-L465
  async "tcp-path"(dir) {
    const unix = await listen({ at: path.join(dir, "tcp.sock") });
    const peer = await listen();
    const { s, r } = await connectedClient(peer, undefined, { SOCK: unix.at });
    const result = await thenPath(s, r, unix);
    unix.close();
    peer.close();
    return result;
  },

  // The same while the connect of the handle is in flight: the parse comes before libuv sees the handle.
  async "tcp-path-in-flight"(dir) {
    const unix = await listen({ at: path.join(dir, "flight.sock") });
    const peer = await listen();
    const s = new net.Socket();
    const r = record(s, { PORT: peer.port, SOCK: unix.at });
    s.connect(peer.port, HOST);
    // The dial of that call starts on the next tick.
    await new Promise(resolve => process.nextTick(resolve));
    const result = await thenPath(s, r, unix);
    unix.close();
    peer.close();
    return result;
  },

  async "tls-path"(dir) {
    const unix = await listen({ at: path.join(dir, "tls.sock") });
    const peer = await listenTLS();
    const { s, r } = await connectedTLSClient(peer, { SOCK: unix.at });
    const result = await thenPath(s, r, unix);
    unix.close();
    peer.close();
    return result;
  },

  // A socket accepted on the default address. Where that is dual-stack, its local address is an IPv6 one.
  async "accepted-path"(dir) {
    const unix = await listen({ at: path.join(dir, "accepted.sock") });
    const peer = await listen({ host: null });
    const client = net.connect(peer.port, HOST);
    client.on("error", () => {});
    await once(client, "data");
    const accepted = peer.accepted[0];
    const r = record(accepted, { SOCK: unix.at });
    const result = await thenPath(accepted, r, unix);
    client.destroy();
    unix.close();
    peer.close();
    return result;
  },

  // A path that is an IPv4 address is an address to node's TCP handle.
  async "accepted-path-ipv4"() {
    const peer = await listen();
    const client = net.connect(peer.port, HOST);
    client.on("error", () => {});
    await once(client, "data");
    const accepted = peer.accepted[0];
    const r = record(accepted);
    accepted.connect({ path: HOST });
    const outcome = await outcomeOf(accepted);
    accepted.destroy();
    client.destroy();
    peer.close();
    return { outcome, events: r.events, errors: r.errors };
  },

  async "tcp6-path"(dir) {
    const unix = await listen({ at: path.join(dir, "tcp6.sock") });
    const peer = await listen({ host: "::1" });
    const s = net.connect(peer.port, "::1");
    const r = record(s, { PORT: peer.port, SOCK: unix.at });
    await once(s, "connect");
    await r.until("hello");
    const result = await thenPath(s, r, unix);
    unix.close();
    peer.close();
    return result;
  },

  async "tls-in-flight"() {
    const peer = await listenTLS();
    const s = tls.connect({ port: peer.port, host: HOST, rejectUnauthorized: false });
    const r = record(s, { PORT: peer.port });
    s.connect(peer.port, HOST);
    const outcome = await outcomeOf(s);
    s.destroy();
    peer.close();
    return { outcome, events: r.events, errors: r.errors };
  },

  // ---- Calls that node refuses with another errno, at another time, or after a step more.

  // A unix socket that is connected. node reports what connect(2) says for the new path, with the
  // request: EISCONN for a socket, ENOENT for a path that is not there.
  async "unix-path"(dir) {
    const peer = await listen({ at: path.join(dir, "unix.sock") });
    const s = net.connect({ path: peer.at });
    const r = record(s, { SOCK: peer.at });
    await once(s, "connect");
    await r.until("hello");
    const result = await thenPath(s, r, peer);
    peer.close();
    return result;
  },

  // connect(path); connect(path) in one tick.
  async "unix-in-flight"(dir) {
    const peer = await listen({ at: path.join(dir, "twice.sock") });
    const s = new net.Socket();
    const r = record(s, { SOCK: peer.at });
    s.connect({ path: peer.at });
    s.connect({ path: peer.at });
    const destroyedInCall = s.destroyed;
    const outcome = await outcomeOf(s);
    s.destroy();
    peer.close();
    return { outcome, destroyedInCall, events: r.events, errors: r.errors };
  },

  // A name with two addresses, and a bind that the handle refuses: the walk over the addresses stops.
  // node goes on to the second address: it closes the connection without an event and dials there.
  async "two-addresses-local-port"() {
    const peer = await listen();
    const { s, r } = await connectedClient(peer);
    r.names.LOCAL = s.localPort;
    s.connect({ ...twoAddresses(peer.port), localPort: s.localPort });
    const outcome = await outcomeOf(s);
    s.destroy();
    const result = { outcome, events: r.events, errors: r.errors, dialed: await peer.dialed() };
    peer.close();
    return result;
  },

  // The same with a first address that the socket's BlockList blocks.
  async "two-addresses-blocked"() {
    const peer = await listen();
    const blockList = new net.BlockList();
    const s = new net.Socket({ blockList });
    const r = record(s, { PORT: peer.port });
    s.connect(peer.port, HOST);
    await once(s, "connect");
    await r.until("hello");
    blockList.addAddress(HOST);
    s.connect(twoAddresses(peer.port));
    const outcome = await outcomeOf(s);
    s.destroy();
    const result = { outcome, events: r.events, errors: r.errors, data: r.data(), dialed: await peer.dialed() };
    peer.close();
    return result;
  },

  // connect(); connect() by a name with two addresses (#21524). The socket that said 'close' is closed.
  async "two-addresses-in-flight"() {
    const peer = await listen();
    const s = new net.Socket();
    const r = record(s, { PORT: peer.port });
    s.connect(twoAddresses(peer.port));
    s.connect(twoAddresses(peer.port));
    const outcome = await outcomeOf(s);
    // The server greeted the first dial. A socket that is still connected reads that before the probe returns.
    await peer.dialed();
    const result = {
      outcome,
      events: r.events,
      errors: r.errors,
      data: r.data(),
      state: { destroyed: s.destroyed, connecting: s.connecting, readyState: s.readyState },
    };
    s.destroy();
    peer.close();
    return result;
  },

  // The first address refuses. A 'connectionAttemptFailed' listener calls connect(path), and the walk
  // of the first call then finds the handle with the socket of that dial.
  async "walk-finds-a-socket"(dir) {
    const unix = await listen({ at: path.join(dir, "walk.sock") });
    const peer = await listen();
    const s = new net.Socket();
    const r = record(s, { PORT: peer.port, SOCK: unix.at });
    s.once("connectionAttemptFailed", () => s.connect({ path: unix.at }));
    // Nothing listens on 127.0.0.9: the kernel refuses.
    s.connect(twoAddresses(peer.port, "127.0.0.9", HOST));
    const outcome = await outcomeOf(s);
    // A socket that is still connected reads a greeting before the probes return.
    const dialed = { tcp: await peer.dialed(), unix: await unix.dialed() };
    const result = {
      outcome,
      events: r.events,
      data: r.data(),
      dialed,
      state: { destroyed: s.destroyed, connecting: s.connecting, readyState: s.readyState },
    };
    s.destroy();
    unix.close();
    peer.close();
    return result;
  },

  // Bun only: node's connect() takes no fd. libuv opens an fd only on a handle that has none.
  async fd() {
    const peer = await listen();
    const { s, r } = await connectedClient(peer);
    const fd = fs.openSync(fileURLToPath(import.meta.url), "r");
    try {
      s.connect({ fd });
      const outcome = await Promise.race([outcomeOf(s), peer.dialed().then(() => "none")]);
      s.destroy();
      const result = { outcome, events: r.events, errors: r.errors, dialed: await peer.dialed() };
      peer.close();
      return result;
    } finally {
      fs.closeSync(fd);
    }
  },

  // Windows: a named pipe that is connected, then its own name, then an address.
  async "named-pipe"() {
    const results = {};
    for (const call of ["path", "address"]) {
      const pipe = await listen({ at: `\\\\.\\pipe\\reconnect-live-${process.pid}-${call}` });
      const peer = await listen();
      const s = net.connect({ path: pipe.at });
      const r = record(s, { PIPE: pipe.at, PORT: peer.port });
      await once(s, "connect");
      await r.until("hello");
      if (call === "path") s.connect({ path: pipe.at });
      else s.connect(peer.port, HOST);
      const outcome = await outcomeOf(s);
      s.destroy();
      results[call] = { outcome, events: r.events, errors: r.errors, dialed: await peer.dialed() };
      pipe.close();
      peer.close();
    }
    return results;
  },

  // ---- A client socket that has not sent its FIN. The connection is swapped for a new one, as before:
  // connect(2) answers 0 for such a socket once on Linux, and node says 'connect' again there.

  async connected() {
    const peer = await listen();
    const { s } = await connectedClient(peer);
    const result = await thenPort(s, peer);
    peer.close();
    return result;
  },

  async "other-port"() {
    const peer = await listen();
    const other = await listen({ greeting: "OTHER" });
    const { s } = await connectedClient(peer);
    const result = await thenPort(s, other);
    peer.close();
    other.close();
    return result;
  },

  // The peer sent its FIN. The socket is half-open.
  async "after-fin"() {
    const peer = await listen();
    const { s } = await connectedClient(peer, { allowHalfOpen: true });
    peer.accepted[0].end();
    await once(s, "end");
    const result = await thenPort(s, peer);
    peer.close();
    return result;
  },

  async "two-addresses"() {
    const peer = await listen();
    const { s } = await connectedClient(peer);
    s.connect(twoAddresses(peer.port));
    const outcome = await outcomeOf(s);
    s.destroy();
    peer.close();
    return { outcome };
  },

  async "tls-established"() {
    const peer = await listenTLS();
    const { s } = await connectedTLSClient(peer);
    const result = await thenPort(s, peer);
    peer.close();
    return result;
  },

  // TCP is up and the handshake is not done.
  async "tls-handshake"() {
    const peer = await listenTLS();
    const s = tls.connect({ port: peer.port, host: HOST, rejectUnauthorized: false });
    s.on("error", () => {});
    await once(s, "connect");
    const result = await thenPort(s, peer);
    peer.close();
    return result;
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, ...names] = process.argv.slice(2);
  const results = {};
  for (const name of names) results[name] = await scenarios[name](dir);
  console.log(JSON.stringify(results, null, 1));
}
