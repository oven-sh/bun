process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Duplex } = require("stream");
const tls = require("tls");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

function expectStore(what, expected) {
  const store = asyncLocalStorage.getStore();
  if (store !== expected) {
    console.error(`FAIL: ${what} ran in ${JSON.stringify(store)}, expected ${JSON.stringify(expected)}`);
    failed = true;
  }
}

const fixtures = path.join(__dirname, "..", "..", "tls", "fixtures");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));

// A TLS socket emits 'close' from the close callback of the TCP handle under it. That callback runs in the async context
// the handle was made in, whoever destroys the TLS socket or the socket it wraps.
function closed(socket, what, expected) {
  return new Promise(resolve =>
    socket.once("close", () => {
      expectStore(`'close' of ${what}`, expected);
      resolve();
    }),
  );
}

// A connected net.Socket made in the store "raw".
function rawSocket(port) {
  return new Promise(resolve => {
    const raw = asyncLocalStorage.run("raw", () => net.connect(port, "127.0.0.1"));
    raw.on("error", () => {});
    raw.once("connect", () => resolve(raw));
  });
}

// A TLS socket made in the store "wrap" over `stream`. `act` runs in the store "destroy" once the handshake is done.
function wrap(stream, act) {
  const socket = asyncLocalStorage.run("wrap", () => tls.connect({ socket: stream, rejectUnauthorized: false }));
  socket.on("error", () => {});
  socket.once("secureConnect", () => asyncLocalStorage.run("destroy", act, socket));
  return socket;
}

async function ownConnection(port) {
  const socket = asyncLocalStorage.run("connect", () =>
    tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }),
  );
  socket.on("error", () => {});
  socket.once("secureConnect", () => asyncLocalStorage.run("destroy", () => socket.destroy()));
  await closed(socket, "a TLS socket that is destroyed after its handshake", "connect");
}

async function whileConnecting(port) {
  const socket = asyncLocalStorage.run("connect", () =>
    tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }),
  );
  socket.on("error", () => {});
  asyncLocalStorage.run("destroy", () => socket.destroy());
  await closed(socket, "a TLS socket that is destroyed while it connects", "connect");
}

// One handle is under both sockets: the one connect() made for the net.Socket.
async function overSocket(port) {
  const raw = await rawSocket(port);
  const socket = wrap(raw, socket => socket.destroy());
  await Promise.all([
    closed(socket, "a TLS socket over a net.Socket", "raw"),
    closed(raw, "a net.Socket whose TLS socket is destroyed", "raw"),
  ]);
}

async function socketDestroyedUnder(port) {
  const raw = await rawSocket(port);
  const socket = wrap(raw, () => raw.destroy());
  await Promise.all([
    closed(socket, "a TLS socket whose net.Socket is destroyed", "raw"),
    closed(raw, "a net.Socket that is destroyed under a TLS socket", "raw"),
  ]);
}

// A stream that is no net.Socket has no handle. Its TLS socket closes from an immediate of whoever destroys it.
async function overStream(port) {
  const raw = await rawSocket(port);
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end();
      callback();
    },
    destroy(err, callback) {
      raw.destroy();
      callback(err);
    },
  });
  raw.on("data", chunk => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  duplex.on("error", () => {});
  const socket = wrap(duplex, socket => socket.destroy());
  await closed(socket, "a TLS socket over a stream that is no net.Socket", "destroy");
}

// Node makes the handle of an accepted socket from the event loop, in no async context.
function accepted() {
  return new Promise(resolve => {
    const server = tls.createServer({ key, cert }, socket => {
      socket.on("error", () => {});
      closed(socket, "an accepted TLS socket that its server destroys", undefined).then(() => server.close(resolve));
      asyncLocalStorage.run("destroy", () => socket.destroy());
    });
    asyncLocalStorage.run("listen", () =>
      server.listen(0, "127.0.0.1", () => {
        const client = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false });
        client.on("error", () => {});
        client.resume();
      }),
    );
  });
}

const server = tls.createServer({ key, cert }, socket => {
  socket.on("error", () => {});
  socket.resume();
});
server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  await Promise.all([
    ownConnection(port),
    whileConnecting(port),
    overSocket(port),
    socketDestroyedUnder(port),
    overStream(port),
    accepted(),
  ]);
  server.close();
  process.exit(failed ? 1 : 0);
});
