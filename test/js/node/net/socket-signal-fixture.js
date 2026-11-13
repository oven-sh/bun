// Sockets made with a `signal`, whose 'error' event the caller does not listen to or cannot listen to.
// Runs unchanged under Node.js. node-net.test.ts has the lines that Node.js v26.12.1 prints.
// TLS_FIXTURE is the JSON of the { cert, key } that the TLS servers use.
const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const http2 = require("node:http2");
const fs = require("node:fs");

// Each call makes a socket with `signal`. All but the first then throw, so the caller never has the socket.
const calls = {
  "new net.Socket()": signal => new net.Socket({ signal }),
  "new net.Socket() with a blockList that is not one": signal => new net.Socket({ signal, blockList: {} }),
  "net.connect() with a port out of range": signal => net.connect({ host: "127.0.0.1", port: 70000, signal }),
  "net.connect() with no port": signal => net.connect({ host: "127.0.0.1", signal }),
  "net.connect() with a path that is not a string": signal => net.connect({ path: 5, signal }),
  "net.connect() with a localAddress that is not an IP address": signal =>
    net.connect({ host: "127.0.0.1", port: 1, localAddress: "nope", signal }),
  "net.connect() with a lookup that throws": signal =>
    net.connect({
      host: "nowhere.test",
      port: 1,
      signal,
      lookup() {
        throw new Error("lookup");
      },
    }),
  "net.createConnection() with a negative timeout": signal =>
    net.createConnection({ host: "127.0.0.1", port: 1, timeout: -1, signal }),
  "tls.connect() with a port out of range": signal => tls.connect({ host: "127.0.0.1", port: 70000, signal }),
  "tls.connect() with a negative timeout": signal => tls.connect({ host: "127.0.0.1", port: 1, timeout: -1, signal }),
  "http2.connect() with a localAddress that is not an IP address": signal =>
    http2.connect("http://127.0.0.1:1", { localAddress: "nope", signal }),
  "http2.connect() to https with a localAddress that is not an IP address": signal =>
    http2.connect("https://127.0.0.1:1", { localAddress: "nope", signal }),
  "http2.connect() with a lookup that is not a function": signal =>
    http2.connect("http://nowhere.test:1", { lookup: 5, signal }),
  "http.Agent#createConnection() with a port out of range": signal =>
    new http.Agent().createConnection({ host: "127.0.0.1", port: 70000, signal }),
  "https.Agent#createConnection() with a port out of range": signal =>
    new https.Agent().createConnection({ host: "127.0.0.1", port: 70000, signal }),
};

const closed = socket => new Promise(resolve => socket.on("close", resolve));

// The caller has each of these sockets and listens only for 'close'.
const sockets = {
  "a lookup that fails": signal => {
    const lookup = (hostname, options, callback) =>
      process.nextTick(callback, Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
    return closed(net.connect({ host: "nowhere.test", port: 1, signal, lookup }));
  },
  "an abort while it connects": (signal, abort) => {
    const socket = net.connect({ host: "nowhere.test", port: 1, signal, lookup() {} });
    abort();
    return closed(socket);
  },
  "an abort when it is connected": (signal, abort) =>
    new Promise(resolve => {
      const server = net.createServer(connection => {
        connection.on("error", () => {});
        connection.on("close", () => server.close());
        connection.resume();
      });
      server.listen(0, "127.0.0.1", () => {
        const socket = net.connect({ host: "127.0.0.1", port: server.address().port, signal });
        socket.on("connect", abort);
        socket.on("close", resolve);
      });
    }),
};

// The caller's own code throws on a socket made with `signal`. Each entry arms `thrower` before the socket connects.
const throwers = {
  "the callback of net.connect()": undefined,
  "a 'connect' listener": (socket, thrower) => socket.once("connect", thrower),
  "a 'ready' listener": (socket, thrower) => socket.once("ready", thrower),
  "the callback of a write before the connection": (socket, thrower) => socket.write("x", thrower),
  "the callback of a write that waits for the peer": (socket, thrower) =>
    socket.once("connect", () => socket.write(Buffer.alloc(8 * 1024 * 1024), thrower)),
  "a 'drain' listener": (socket, thrower) =>
    socket.once("drain", thrower).once("connect", () => {
      while (socket.write(Buffer.alloc(65536)));
    }),
  "tls: a 'connect' listener": (socket, thrower) => socket.once("connect", thrower),
  "tls: a 'session' listener": (socket, thrower) => socket.once("session", thrower),
  "tls: a 'keylog' listener": (socket, thrower) => socket.once("keylog", thrower),
  "tls: the callback of a write that waits for the peer": (socket, thrower) =>
    socket.once("secureConnect", () => socket.write(Buffer.alloc(8 * 1024 * 1024), thrower)),
};

const groups = {
  "an abort after the call"() {
    for (const [name, call] of Object.entries(calls)) {
      const controller = new AbortController();
      let thrown = "nothing";
      try {
        call(controller.signal);
      } catch (error) {
        thrown = error.code ?? error.name;
      }
      controller.abort(name);
      console.log(`${name}: threw ${thrown}`);
    }
  },
  async "a socket with no 'error' listener"() {
    for (const [name, open] of Object.entries(sockets)) {
      const controller = new AbortController();
      console.log(`${name}: close ${await open(controller.signal, () => controller.abort(name))}`);
    }
  },
  async "a listener that throws"() {
    const cert = JSON.parse(process.env.TLS_FIXTURE);
    for (const [name, arm] of Object.entries(throwers)) {
      const isTls = name.startsWith("tls: ");
      const onConnection = connection => {
        connection.on("error", () => {}).resume();
        // A TLS server of Bun sends its session tickets with its first write.
        connection.write("x");
      };
      const server = isTls ? tls.createServer(cert, onConnection) : net.createServer(onConnection);
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const options = { host: "127.0.0.1", port: server.address().port, signal: new AbortController().signal };
      if (isTls) Object.assign(options, { ca: cert.cert, servername: "localhost" });
      let socket;
      await new Promise(resolve => {
        const thrower = () => {
          // Two turns of the event loop are past every tick that can report the throw.
          setImmediate(() => setImmediate(resolve));
          throw new Error(name);
        };
        socket = arm ? (isTls ? tls.connect(options) : net.connect(options)) : net.connect(options, thrower);
        arm?.(socket, thrower);
        socket.resume();
      });
      socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  },
  "a signal that is already aborted"() {
    const name = "new net.Socket() with an fd that is a file";
    let thrown = "nothing";
    try {
      new net.Socket({ signal: AbortSignal.abort(name), fd: fs.openSync(__filename, "r"), writable: true });
    } catch (error) {
      thrown = error.code ?? error.name;
    }
    console.log(`${name}: threw ${thrown}`);
  },
};

// An 'error' event that nothing handles is an uncaught exception. Without this handler it ends the process.
// The handler names the socket: the reason of each abort is the name of its row, and an AbortError has it as its cause.
process.on("uncaughtException", error => {
  console.log(`uncaught ${error.name}: ${error.cause ?? error.message}`);
  process.exitCode = 1;
});
process.on("exit", code => console.log(`exit code ${code}`));
groups[process.argv[2]]();
