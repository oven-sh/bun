// Sockets made with a `signal`, whose 'error' event the caller does not listen to or cannot listen to.
// Runs unchanged under Node.js. node-net.test.ts has the lines that Node.js v26.12.1 prints.
// TLS_FIXTURE is the JSON of the { cert, key } that the TLS servers use.
// The child process of the group "a socket sent to a child process" is this file. It sends "hello" over each socket that it gets,
// and tells its parent what the peer sent back.
if (process.argv[2] === "child process") {
  process.on("message", (name, socket) => {
    socket.once("data", data => process.send(`the child process read "${data}" back from the peer`));
    socket.end("hello");
  });
  return;
}

const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");

// Each call makes a socket with `signal`. All but the first then throw, so the caller never has the socket.
// The other groups start faster without node:http, node:https and node:http2.
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
    require("node:http2").connect("http://127.0.0.1:1", { localAddress: "nope", signal }),
  "http2.connect() to https with a localAddress that is not an IP address": signal =>
    require("node:http2").connect("https://127.0.0.1:1", { localAddress: "nope", signal }),
  "http2.connect() with a lookup that is not a function": signal =>
    require("node:http2").connect("http://nowhere.test:1", { lookup: 5, signal }),
  "http.Agent#createConnection() with a port out of range": signal =>
    new (require("node:http").Agent)().createConnection({ host: "127.0.0.1", port: 70000, signal }),
  "https.Agent#createConnection() with a port out of range": signal =>
    new (require("node:https").Agent)().createConnection({ host: "127.0.0.1", port: 70000, signal }),
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

// Each entry of `throwers` throws on a socket of its own. `also` is what else the caller does on that socket:
// "listen" adds an 'error' listener to it. "abort" aborts its signal in the thrower, before the throw.
async function throwOnEachSocket(also) {
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
    const controller = new AbortController();
    const options = { host: "127.0.0.1", port: server.address().port, signal: controller.signal };
    if (isTls) Object.assign(options, { ca: cert.cert, servername: "localhost" });
    const errors = [];
    let socket;
    await new Promise(resolve => {
      const thrower = () => {
        // The abort destroys the socket, and its 'close' ends the row.
        if (also === "abort") controller.abort(name);
        // Two turns of the event loop are past every tick that can report the throw.
        else setImmediate(() => setImmediate(resolve));
        throw new Error(name);
      };
      socket = arm ? (isTls ? tls.connect(options) : net.connect(options)) : net.connect(options, thrower);
      if (also === "listen") socket.on("error", error => errors.push(error.message));
      if (also === "abort") socket.on("close", hadError => resolve(console.log(`${name}: close ${hadError}`)));
      arm?.(socket, thrower);
      socket.resume();
    });
    if (also === "listen") {
      console.log(`${name}: the 'error' listener got ${errors.join() || "nothing"}, destroyed ${socket.destroyed}`);
    }
    socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

// A write is in flight, since the peer does not read, when the socket is destroyed. Its callback throws when the write fails.
// Each entry returns what destroys the socket.
const teardowns = {
  "a write in flight at the abort": (socket, abort) => abort,
  "a write in flight when an 'uncaughtException' listener destroys the socket": socket => {
    process.once("uncaughtException", () => socket.destroy());
    return () => {
      throw new Error("a 'connect' listener");
    };
  },
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
  "a listener that throws": () => throwOnEachSocket(),
  "a listener that throws on a socket with an 'error' listener": () => throwOnEachSocket("listen"),
  "a listener that aborts the signal, then throws": () => throwOnEachSocket("abort"),
  async "a write that fails"() {
    for (const [name, arm] of Object.entries(teardowns)) {
      const server = net.createServer(connection => connection.on("error", () => {}).pause());
      const accepted = new Promise(resolve => server.once("connection", resolve));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const controller = new AbortController();
      const socket = net.connect({ host: "127.0.0.1", port: server.address().port, signal: controller.signal });
      const teardown = arm(socket, () => controller.abort(name));
      const failed = new Promise(resolve => {
        socket.once("connect", () => {
          socket.write(Buffer.alloc(32 * 1024 * 1024), error => {
            if (!error) return;
            // Two turns of the event loop are past every tick that can report the throw.
            setImmediate(() => setImmediate(resolve));
            throw new Error(`the callback of ${name}`);
          });
          teardown();
        });
      });
      console.log(`${name}: close ${await closed(socket)}`);
      await failed;
      (await accepted).destroy();
      await new Promise(resolve => server.close(resolve));
    }
  },
  // Nothing ends the next two groups. Node.js has not started to read after the throw of a 'connect' listener, and the reads
  // are over at the end of the peer's data, so the socket must not keep the process alive:
  // https://github.com/nodejs/node/blob/v26.12.1/lib/net.js#L2068-L2074
  // https://github.com/nodejs/node/blob/v26.12.1/deps/uv/src/unix/stream.c#L931-L938
  "a 'connect' listener that throws on a socket that stays open"() {
    const server = net.createServer(connection => connection.on("error", () => {}).unref());
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const { signal } = new AbortController();
      const socket = net.connect({ host: "127.0.0.1", port: server.address().port, signal });
      socket.on("close", hadError => console.log(`close ${hadError}`));
      socket.on("connect", () => {
        throw new Error("a 'connect' listener");
      });
    });
  },
  "a 'readable' listener that throws at the end of a socket that stays open"() {
    const isTls = process.argv[3] === "tls";
    const cert = isTls ? JSON.parse(process.env.TLS_FIXTURE) : undefined;
    const onConnection = connection => {
      connection.on("error", () => {});
      connection.unref();
      connection.end();
    };
    const server = isTls ? tls.createServer(cert, onConnection) : net.createServer(onConnection);
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const options = {
        host: "127.0.0.1",
        port: server.address().port,
        signal: new AbortController().signal,
        allowHalfOpen: true,
      };
      if (isTls) Object.assign(options, { ca: cert.cert, servername: "localhost" });
      const socket = isTls ? tls.connect(options) : net.connect(options);
      socket.on("end", () => console.log("end"));
      socket.on("close", hadError => console.log(`close ${hadError}`));
      socket.on("readable", () => {
        if (socket.read() === null) throw new Error("a 'readable' listener at the end");
      });
    });
  },
  // The caller made the socket that the TLS socket wraps. The TLS socket's 'connect' listeners run inside its 'connect'.
  async "a listener that throws on a TLS socket over a socket"() {
    const cert = JSON.parse(process.env.TLS_FIXTURE);
    // [the listener's event, the TLS socket has a signal, the socket under it has one, the caller listens for 'error']
    const rows = [
      ["connect", true, false, false],
      ["secureConnect", true, false, false],
      ["session", true, false, false],
      ["keylog", true, false, false],
      ["connect", true, false, true],
      ["secureConnect", true, false, true],
      ["session", true, false, true],
      ["keylog", true, false, true],
      ["connect", false, true, false],
      ["connect", true, true, false],
    ];
    for (const [event, signal, signalUnder, listens] of rows) {
      const name =
        `tls over a socket${signalUnder ? (signal ? " that has a signal too" : " that has the signal") : ""}: ` +
        `a '${event}' listener${listens ? " beside an 'error' listener" : ""}`;
      const server = tls.createServer(cert, connection => {
        connection.on("error", () => {}).resume();
        // A TLS server of Bun sends its session tickets with its first write.
        connection.write("x");
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const under = { host: "127.0.0.1", port: server.address().port };
      if (signalUnder) under.signal = new AbortController().signal;
      const options = { socket: net.connect(under), ca: cert.cert, servername: "localhost" };
      if (signal) options.signal = new AbortController().signal;
      const socket = tls.connect(options);
      if (listens) socket.on("error", error => console.log(`${name}: 'error' listener got ${error.message}`));
      await new Promise(resolve => {
        socket.once(event, () => {
          // Two turns of the event loop are past every tick that can report the throw.
          setImmediate(() => setImmediate(resolve));
          throw new Error(name);
        });
        socket.resume();
      });
      console.log(`${name}: ${socket.destroyed ? "destroyed" : "open"}`);
      socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  },
  // new tls.TLSSocket(socket, { isServer: true, signal }) over a socket that a net.Server accepted.
  async "a listener that throws on a server-side TLS socket over a socket"() {
    const cert = JSON.parse(process.env.TLS_FIXTURE);
    const arms = {
      "a 'secure' listener": (socket, thrower) => socket.once("secure", thrower),
      "a 'keylog' listener": (socket, thrower) => socket.once("keylog", thrower),
      "the callback of a write that waits for the peer": (socket, thrower) =>
        socket.once("secure", () => socket.write(Buffer.alloc(8 * 1024 * 1024), thrower)),
    };
    for (const [name, arm] of Object.entries(arms)) {
      let socket;
      const server = net.createServer();
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const client = tls.connect({
        host: "127.0.0.1",
        port: server.address().port,
        ca: cert.cert,
        servername: "localhost",
      });
      client.on("error", () => {}).resume();
      await new Promise(resolve => {
        server.once("connection", accepted => {
          socket = new tls.TLSSocket(accepted, { isServer: true, ...cert, signal: new AbortController().signal });
          arm(socket, () => {
            // Two turns of the event loop are past every tick that can report the throw.
            setImmediate(() => setImmediate(resolve));
            throw new Error(`server side: ${name}`);
          });
          socket.resume();
        });
      });
      console.log(`server side: ${name}: ${socket.destroyed ? "destroyed" : "open"}`);
      socket.destroy();
      client.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  },
  // The callback of net.connect() sends its socket to a child process. The peer sends back what it gets.
  async "a socket sent to a child process"() {
    const server = net.createServer(connection => connection.on("error", () => {}).pipe(connection));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const child = require("node:child_process").fork(__filename, ["child process"]);
    const exited = new Promise(resolve => child.once("exit", resolve));
    for (const name of ["a callback that sends the socket", "a callback that sends the socket and then throws"]) {
      const answered = new Promise(resolve => child.once("message", resolve));
      const options = { host: "127.0.0.1", port: server.address().port, signal: new AbortController().signal };
      const socket = net.connect(options, () => {
        child.send(name, socket);
        if (name.endsWith("throws")) throw new Error(name);
      });
      console.log(`${name}: ${await answered}`);
    }
    child.disconnect();
    console.log(`the child process exits with code ${await exited}`);
    server.close();
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
