// Each row has its own server. server.close() waits for the last connection, and the program does something to
// that connection. No step waits for a timer: a step follows an event or a round trip.
// Prints one JSON object: the name of each row and its events in order. Node.js runs this file too.
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");

const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
const tlsOptions = {
  key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
};
const get = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
const upgrade = "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n";
const switching = "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n";

const results = {};
const anyOrder = [];
process.on("uncaughtException", err => {
  if (!err.events) throw err;
  err.events.push("uncaught " + err.message);
});
process.on("exit", () => {
  for (const events of anyOrder) events.sort();
  console.log(JSON.stringify(results));
});

function row(name, protocol, run) {
  const events = (results[name] = []);
  const secure = protocol === "https";
  const server = secure ? https.createServer(tlsOptions) : http.createServer();
  server.on("close", () => events.push("server close"));
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    run({
      server,
      events,
      close: () => server.close(() => events.push("close callback")),
      boom() {
        throw Object.assign(new Error("boom"), { events });
      },
      open(request) {
        const socket = secure
          ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => socket.write(request))
          : net.connect(port, "127.0.0.1", () => socket.write(request));
        socket.on("error", () => {});
        return socket;
      },
    });
  });
  return events;
}

// The response is destroyed one round trip after close(), from outside the parse of its connection.
function responseCloseThrows({ server, events, close, boom, open }) {
  server.on("request", (req, res) => {
    res.on("close", () => {
      events.push("response close");
      boom();
    });
    close();
    res.write("x");
    client.once("data", () => res.destroy());
  });
  const client = open(get);
}
row("a response 'close' listener throws", "http", responseCloseThrows);
row("a response 'close' listener throws (https)", "https", responseCloseThrows);

row("a socket 'close' listener throws", "http", ({ server, close, boom, open }) => {
  server.on("request", (req, res) => {
    req.socket.on("close", boom);
    close();
    res.write("x");
    client.once("data", () => res.destroy());
  });
  const client = open(get);
});

row("the 'close' listener of an upgraded socket throws", "http", ({ server, close, boom, open }) => {
  server.on("upgrade", (req, socket) => {
    socket.on("close", boom);
    close();
    socket.write(switching);
    client.once("data", () => socket.destroy());
  });
  const client = open(upgrade);
});

// This close carries an error (an incomplete request). Node emits the socket's 'close' in a later turn of the loop
// than its 'error', with the server's 'close' in between. Bun emits both in one tick.
anyOrder.push(
  row("the 'close' listener of a socket that sent one byte throws", "http", ({ server, close, boom, open }) => {
    server.once("connection", socket => socket.on("close", boom));
    server.on("request", (req, res) => res.end("ok"));
    const partial = open("G");
    partial.on("connect", () => {
      // The byte was written first, so the server has read it when it answers this.
      const barrier = open("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      barrier.resume();
      barrier.on("close", () => {
        close();
        partial.destroy();
      });
    });
  }),
);

// Node emits the socket's 'close' in a later turn of the loop than the server's, so the promise settles in between.
anyOrder.push(
  row("server[Symbol.asyncDispose]() waits and a socket 'close' listener throws", "http", context => {
    const { server, events, boom, open } = context;
    server.on("upgrade", (req, socket) => {
      socket.on("close", boom);
      server[Symbol.asyncDispose]().then(() => events.push("disposed"));
      socket.write(switching);
      client.once("data", () => socket.destroy());
    });
    const client = open(upgrade);
  }),
);

row("an 'aborted' listener removes the socket's 'close' listeners", "http", ({ server, close, open }) => {
  server.on("request", (req, res) => {
    req.on("error", () => {});
    req.on("aborted", () => req.socket.removeAllListeners("close"));
    close();
    res.write("x");
    client.once("data", () => res.destroy());
  });
  const client = open(get);
});

row("the program's socket.emit swallows 'close'", "http", ({ server, close, open }) => {
  server.on("upgrade", (req, socket) => {
    const emit = socket.emit;
    socket.emit = function (name) {
      if (name === "close") return false;
      return emit.apply(this, arguments);
    };
    close();
    socket.write(switching);
    client.once("data", () => socket.destroy());
  });
  const client = open(upgrade);
});

row("the 'error' listener of a socket destroyed with an error throws", "http", ({ server, close, boom, open }) => {
  server.on("upgrade", (req, socket) => {
    socket.on("error", boom);
    close();
    socket.write(switching);
    client.once("data", () => socket.destroy(new Error("destroyed")));
  });
  const client = open(upgrade);
});

row("a tunnel that is idle after the peer's FIN is destroyed", "http", ({ server, close, open }) => {
  server.on("upgrade", (req, socket) => {
    socket.on("end", () => {
      close();
      socket.write(switching);
      client.once("data", () => socket.destroy());
    });
    socket.resume();
    client.end();
  });
  const client = open(upgrade);
});

row("a socket 'readable' listener throws at the peer's FIN", "http", ({ server, events, close, boom, open }) => {
  server.on("request", (req, res) => {
    const socket = req.socket;
    socket.on("readable", () => {
      if (socket.read() === null) boom();
    });
    close();
    res.end("ok");
    client.once("data", () => client.end());
    client.on("close", () => server.getConnections((err, count) => events.push("connections " + count)));
  });
  const client = open(get);
});

row("the tunnel socket was emitted as a 'connection' of a second server", "http", ({ server, events, close, open }) => {
  const other = http.createServer();
  server.on("upgrade", (req, socket) => {
    socket.on("error", () => {});
    socket.write(switching);
    other.emit("connection", socket);
    close();
    client.once("data", () => socket.destroy());
    client.on("close", () => server.getConnections((err, count) => events.push("connections " + count)));
  });
  const client = open(upgrade);
});

// Node emits the socket's 'error' before the server's 'close' on http, and after it on https.
function destroyWithError({ server, events, close, open }) {
  server.on("clientError", () => events.push("clientError"));
  server.on("request", (req, res) => {
    close();
    res.write("x");
    client.once("data", () => res.destroy(new Error("destroyed")));
  });
  const client = open(get);
}
row("the response is destroyed with an error", "http", destroyWithError);
row("the response is destroyed with an error (https)", "https", destroyWithError);
