process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dgram = require("dgram");

// node makes the UDP handle of a socket in createSocket(). What that handle delivers ('message') runs in the store of
// createSocket(), whichever call binds the socket later. Every other event runs in the store of the call that caused it.
const asyncLocalStorage = new AsyncLocalStorage();
const store = () => String(asyncLocalStorage.getStore());
const create = () => dgram.createSocket("udp4");

// Each layout makes a socket and sends a datagram to `port`, which answers it. It notes the store of each callback.
const layouts = {
  "bind() inside a store, createSocket() in none": {
    start(port, seen) {
      const socket = create();
      asyncLocalStorage.run("bind()", () =>
        socket.bind(0, "127.0.0.1", () => {
          seen["bind() callback"] = store();
          socket.send("x", port, "127.0.0.1", () => (seen["send() callback"] = store()));
        }),
      );
      return socket;
    },
    expected: {
      "bind() callback": "bind()",
      "'listening'": "bind()",
      "send() callback": "bind()",
      "'message'": "undefined",
      "'close'": "close()",
    },
  },
  "send() binds inside a store, createSocket() in none": {
    start(port, seen) {
      const socket = create();
      asyncLocalStorage.run("send()", () =>
        socket.send("x", port, "127.0.0.1", () => (seen["send() callback"] = store())),
      );
      return socket;
    },
    expected: {
      "'listening'": "send()",
      "send() callback": "send()",
      "'message'": "undefined",
      "'close'": "close()",
    },
  },
  "connect() binds inside a store, createSocket() in none": {
    start(port, seen) {
      const socket = create();
      asyncLocalStorage.run("connect()", () =>
        socket.connect(port, "127.0.0.1", () => {
          seen["connect() callback"] = store();
          socket.send("x", () => (seen["send() callback"] = store()));
        }),
      );
      return socket;
    },
    expected: {
      "'listening'": "connect()",
      "'connect'": "connect()",
      "connect() callback": "connect()",
      "send() callback": "connect()",
      "'message'": "undefined",
      "'close'": "close()",
    },
  },
  "createSocket() inside a store, bind() in none": {
    start(port, seen) {
      const socket = asyncLocalStorage.run("createSocket()", create);
      socket.bind(0, "127.0.0.1", () => {
        seen["bind() callback"] = store();
        socket.send("x", port, "127.0.0.1", () => (seen["send() callback"] = store()));
      });
      return socket;
    },
    expected: {
      "bind() callback": "undefined",
      "'listening'": "undefined",
      "send() callback": "undefined",
      "'message'": "createSocket()",
      "'close'": "close()",
    },
  },
  "createSocket() and send() each inside a store of its own": {
    start(port, seen) {
      const socket = asyncLocalStorage.run("createSocket()", create);
      asyncLocalStorage.run("send()", () =>
        socket.send("x", port, "127.0.0.1", () => (seen["send() callback"] = store())),
      );
      return socket;
    },
    expected: {
      "'listening'": "send()",
      "send() callback": "send()",
      "'message'": "createSocket()",
      "'close'": "close()",
    },
  },
  // A bind() that fails leaves the socket its handle. The bind() that opens the socket later is still not where
  // 'message' runs.
  "createSocket() inside a store, a bind() that fails, then a bind() inside a store of its own": {
    start(port, seen) {
      const socket = asyncLocalStorage.run("createSocket()", create);
      socket.once("error", error => {
        seen["'error'"] = `${store()} ${error.code}`;
        asyncLocalStorage.run("second bind()", () =>
          socket.bind(0, "127.0.0.1", () => {
            seen["bind() callback"] = store();
            socket.send("x", port, "127.0.0.1", () => (seen["send() callback"] = store()));
          }),
        );
      });
      // The socket that answers holds `port`.
      asyncLocalStorage.run("first bind()", () => socket.bind(port, "127.0.0.1"));
      return socket;
    },
    expected: {
      "'error'": "first bind() EADDRINUSE",
      "bind() callback": "second bind()",
      "'listening'": "second bind()",
      "send() callback": "second bind()",
      "'message'": "createSocket()",
      "'close'": "close()",
    },
  },
};

let open = Object.keys(layouts).length;
let failed = false;
const answers = create();
answers.on("message", (message, from) => answers.send(message, from.port, from.address));
answers.bind(0, "127.0.0.1", () => {
  for (const [name, { start, expected }] of Object.entries(layouts)) {
    const seen = {};
    const socket = start(answers.address().port, seen);
    socket.on("listening", () => (seen["'listening'"] = store()));
    socket.on("connect", () => (seen["'connect'"] = store()));
    socket.on("message", () => {
      seen["'message'"] = store();
      asyncLocalStorage.run("close()", () => socket.close());
    });
    socket.on("close", () => {
      seen["'close'"] = store();
      for (const key of new Set([...Object.keys(expected), ...Object.keys(seen)])) {
        if (seen[key] === expected[key]) continue;
        failed = true;
        console.error(`FAIL: ${name}: ${key} ran in the store ${seen[key]}, not ${expected[key]}`);
      }
      if (--open > 0) return;
      answers.close();
      process.exit(failed ? 1 : 0);
    });
  }
});
