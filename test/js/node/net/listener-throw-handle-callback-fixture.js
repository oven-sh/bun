// usage: <net|tls|tls-socket|unix> <client|server|listener> <case> [unix socket path]
// tls-socket is TLS over a net.Socket that the caller made.
// A listener or a write callback that runs straight from a handle's callback throws. The throw must
// reach uncaughtException, not the socket's 'error' event, and must leave the socket as it is.
// NO_HANDLER=1 leaves out the uncaughtException handler: the process must die of the throw.
// TLS_FIXTURE is the JSON-encoded { cert, key } pair to serve with. Runs unchanged under node.
const net = require("node:net");
const tls = require("node:tls");

const [, , transport, side, name, unixPath] = process.argv;
const isTLS = transport === "tls" || transport === "tls-socket";
const mod = isTLS ? tls : net;
const cert = isTLS ? JSON.parse(process.env.TLS_FIXTURE) : undefined;
// More than the kernel takes at once, so the write completes from the handle's writable callback.
const big = Buffer.alloc(4 * 1024 * 1024, "x");

// `events` holds what the socket under test and the process see, in order.
const result = { events: [], destroyed: undefined, delivered: false };
process.on("exit", () => console.log(JSON.stringify(result)));
function boom() {
  result.events.push("throw");
  throw new Error("boom");
}
function boomOnError(err) {
  if (err) boom();
}
function onData(data) {
  result.events.push("data:" + data);
  this.destroy();
}

// What follows the report of the throw:
const SEND = "send"; // the socket still carries bytes to its peer
const RECEIVE = "receive"; // the socket still gets bytes from its peer
const DESTROY = "destroy"; // there is no connection to send over
const LEAVE = "leave"; // nothing: the rest has to happen by itself
const cases = {
  client: {
    // After a throw from 'connect' node never starts to read, which stalls its TLS handshake.
    connect: { then: isTLS ? DESTROY : SEND, early: t => t.once("connect", boom) },
    "connect-destroyed": { then: DESTROY, early: t => t.once("connect", () => (t.destroy(), boom())) },
    // Nothing but the connection is left, and that does not hold the loop before its first read.
    "connect-idle": { then: LEAVE, idle: true, early: t => t.once("connect", boom) },
    ready: { then: SEND, early: t => t.once("ready", boom) },
    // The 'data' listener asked for a read, which a 'connect' listener started.
    "ready-reading": { then: RECEIVE, early: t => (t.on("data", onData), t.once("ready", boom)) },
    "early-write": { then: SEND, early: t => t.write("x", boom) },
    keylog: { then: SEND, early: t => t.once("keylog", boom) },
    session: { then: SEND, early: t => t.once("session", boom) },
    "attempt-failed": { then: DESTROY, early: t => t.once("connectionAttemptFailed", boom) },
  },
  listener: {
    keylog: { then: SEND, server: s => s.once("keylog", boom) },
    // These two hand out no socket to look at.
    drop: { then: LEAVE, server: s => ((s.maxConnections = 0), s.once("drop", boom)) },
    // The server refuses the client's certificate. It closes once the connection is gone.
    tlsClientError: {
      then: LEAVE,
      server: s => (s.once("tlsClientError", boom), s.on("close", () => result.events.push("server closed"))),
    },
  },
};
const connected = {
  drain: { then: SEND, late: t => (t.once("drain", boom), t.write(big)) },
  write: { then: SEND, late: t => t.write(big, boom) },
  // The peer resets the connection at the first bytes of the write, and nothing listens for 'error'. The socket must
  // still close.
  "write-reset": { then: LEAVE, late: t => t.write(big, boomOnError) },
  // An 'uncaughtException' listener destroys the socket, which fails the write while that listener runs.
  "write-destroyed": {
    then: LEAVE,
    late: t => {
      t.write(big, boomOnError);
      setImmediate(() => {
        throw new Error("first");
      });
    },
  },
  // The reads are over, so the half-open socket does not hold the loop.
  "readable-eof": { then: LEAVE, idle: true, late: t => (t.once("readable", boom), peer.end()) },
};
const { then, idle, early, late, server: armServer } = cases[side]?.[name] ?? connected[name];
const reset = name === "write-reset";

let target, peer, server;
let reported = false;
let received = "";
if (!process.env.NO_HANDLER) {
  process.on("uncaughtException", e => {
    // The reset is an error of its own.
    if (reset && e.message !== "boom") return;
    result.events.push("uncaught:" + e.message);
    if (e.message === "first") return target.destroy();
    reported = true;
    afterReport();
  });
}

function setTarget(t) {
  target = t;
  t.on("ready", () => result.events.push("ready"));
  if (!reset) t.on("error", e => result.events.push("error:" + e.message));
  t.on("close", hadError => {
    result.events.push("close:" + hadError);
    finish();
  });
  afterReport();
}
function setPeer(p) {
  peer = p;
  if (idle) p.unref();
  p.on("error", () => {});
  p.on("data", d => {
    // Only a TCP socket has a reset to send.
    if (reset) return unixPath ? p.destroy() : p.resetAndDestroy();
    received = (received + d.toString("latin1")).slice(-4);
    if (received !== "PING") return;
    result.delivered = true;
    target.destroy();
  });
  if (name === "write-destroyed") p.pause();
  afterReport();
}
function afterReport() {
  if (!reported || result.destroyed !== undefined) return;
  if (side === "listener" && then === LEAVE) return finish();
  if (!target || ((then === SEND || then === RECEIVE) && !peer)) return;
  // node destroys the socket for the reset before it fails the write.
  if (!reset) result.destroyed = target.destroyed;
  if (then === SEND) target.write("PING");
  if (then === RECEIVE) peer.write("PONG");
  if (then === DESTROY) target.destroy();
}
function finish() {
  peer?.destroy();
  if (server.listening) server.close();
}

function connect(port) {
  const options = unixPath ? { path: unixPath } : { port, host: "127.0.0.1" };
  const transportOptions = transport === "tls-socket" ? { socket: net.connect(options) } : options;
  const client = mod.connect(
    isTLS ? { ...transportOptions, ...cert, ca: cert.cert, servername: "localhost" } : options,
  );
  if (side !== "client") return setPeer(client);
  setTarget(client);
  if (early) early(client);
  else client.once(isTLS ? "secureConnect" : "connect", () => late(client));
}

server = mod.createServer({
  ...cert,
  allowHalfOpen: name === "readable-eof" || name === "tlsClientError",
  requestCert: name === "tlsClientError",
  // TLS 1.2 hands the client its session with the handshake.
  maxVersion: name === "session" ? "TLSv1.2" : undefined,
});
server.on("error", e => result.events.push("server-error:" + e.message));
if (idle) server.unref();
armServer?.(server);
server.on(isTLS ? "secureConnection" : "connection", s => {
  if (!server.listening) return s.destroy();
  if (side === "client") return setPeer(s);
  setTarget(s);
  late?.(s);
});
server.listen(...(unixPath ? [unixPath] : [0, "127.0.0.1"]), () => {
  const { port } = server.address();
  if (name !== "attempt-failed") return connect(port);
  // The local port of a connected socket is taken, and nothing listens on it.
  const holder = net.connect(port, "127.0.0.1", () => connect(holder.localPort));
});
