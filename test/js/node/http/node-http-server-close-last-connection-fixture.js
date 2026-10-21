// Each row has its own server. server.close() waits for the last connection of that server, and the program does
// something to that connection. A step follows an event or a round trip, never a timer.
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
process.on("uncaughtException", err => {
  if (!err.events) throw err;
  err.events.push("uncaught " + err.message);
});
process.on("exit", () => console.log(JSON.stringify(results)));

function row(name, protocol, run) {
  const events = (results[name] = []);
  const secure = protocol === "https";
  const server = secure ? https.createServer(tlsOptions) : http.createServer();
  // No idle timer of the server closes a connection of a row.
  server.keepAliveTimeout = 0;
  server.on("close", () => events.push("server close"));
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    const open = request => {
      const socket = secure
        ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => socket.write(request))
        : net.connect(port, "127.0.0.1", () => socket.write(request));
      socket.on("error", () => {});
      return socket;
    };
    // Calls then(raw socket) when the server has read a part of a request head from that connection.
    const partial = (head, then) => {
      const raw = net.connect(port, "127.0.0.1", () => {
        const peer = secure ? tls.connect({ socket: raw, rejectUnauthorized: false }, () => send(peer)) : send(raw);
        peer.on("error", () => {});
      });
      raw.on("error", () => {});
      const send = peer => {
        peer.write(head);
        // The bytes were written first, so the server has read them when it answers this.
        const barrier = open("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        barrier.resume();
        barrier.on("close", () => then(raw));
        return peer;
      };
    };
    run({
      server,
      events,
      open,
      partial,
      close: () => server.close(() => events.push("close callback")),
      boom() {
        throw Object.assign(new Error("boom"), { events });
      },
    });
  });
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

row("the 'close' listener of a socket that sent one byte throws", "http", ({ server, close, boom, partial }) => {
  server.once("connection", socket => socket.on("close", boom));
  server.on("request", (req, res) => res.end("ok"));
  partial("G", socket => {
    close();
    socket.destroy();
  });
});

row("server[Symbol.asyncDispose]() waits and a socket 'close' listener throws", "http", context => {
  const { server, events, boom, open } = context;
  server.on("upgrade", (req, socket) => {
    socket.on("close", boom);
    server[Symbol.asyncDispose]().then(() => events.push("disposed"));
    socket.write(switching);
    client.once("data", () => socket.destroy());
  });
  const client = open(upgrade);
});

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

// The last connection is idle after its response. Each row closes it in another way, and its 'close' listener throws.
function idleConnection(closeIt) {
  return ({ server, close, boom, open }) => {
    server.on("request", (req, res) => {
      req.socket.on("close", boom);
      close();
      res.end("ok");
      client.once("data", () => closeIt(server, client, req.socket));
    });
    const client = open(get);
  };
}
row(
  "closeAllConnections() closes the idle last connection",
  "http",
  idleConnection(server => server.closeAllConnections()),
);
row(
  "closeIdleConnections() closes the idle last connection",
  "http",
  idleConnection(server => server.closeIdleConnections()),
);
row(
  "the peer closes the idle last connection",
  "http",
  idleConnection((server, client) => client.end()),
);
// The native handle is closed and its close is not delivered yet when destroy() runs.
row(
  "closeIdleConnections() and then socket.destroy() close the idle last connection",
  "http",
  idleConnection((server, client, socket) => {
    server.closeIdleConnections();
    socket.destroy();
  }),
);

row("a socket 'end' listener removes every listener of the socket", "http", ({ server, close, open }) => {
  server.on("request", (req, res) => {
    req.socket.on("end", () => req.socket.removeAllListeners());
    close();
    res.end("ok");
    client.once("data", () => client.end());
  });
  const client = open(get);
});

row("a socket 'error' listener removes the 'close' listeners at the peer's reset", "http", context => {
  const { server, events, close, open } = context;
  server.on("request", (req, res) => {
    req.socket.on("error", err => {
      events.push("socket error " + err.code);
      req.socket.removeAllListeners("close");
    });
    close();
    res.end("ok");
    client.once("data", () => client.resetAndDestroy());
  });
  const client = open(get);
});

// The order of the server's 'close' and the events of the last socket.
function endBeforeServerClose({ server, events, close, open }) {
  server.on("request", (req, res) => {
    req.socket.on("end", () => events.push("socket end"));
    req.socket.on("close", () => events.push("socket close"));
    close();
    res.end("ok");
    client.once("data", () => client.end());
  });
  const client = open(get);
}
row("the peer ends the idle last connection", "http", endBeforeServerClose);
row("the peer ends the idle last connection (https)", "https", endBeforeServerClose);

row("close() itself closes the idle last connection", "http", ({ server, events, close, open }) => {
  server.on("request", (req, res) => {
    req.socket.on("close", () => events.push("socket close"));
    res.end("ok");
    client.once("data", close);
  });
  const client = open(get);
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

// A close that carries an error. On http Node emits the socket's 'error' before the server's 'close', on https after it.
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

function peerReset({ server, events, close, partial }) {
  server.on("request", (req, res) => res.end("ok"));
  server.on("clientError", (err, socket) => {
    events.push("clientError " + err.code);
    socket.destroy();
  });
  partial("GET / HT", socket => {
    close();
    socket.resetAndDestroy();
  });
}
row("the peer resets a connection that sent part of a request head", "http", peerReset);
row("the peer resets a connection that sent part of a request head (https)", "https", peerReset);

// The close carries an error, and a listener that runs on the way listens again.
function listenAgain(listenFrom) {
  return ({ server, events, close, open }) => {
    const again = () => server.listen(0, "127.0.0.1", () => events.push("listening again") && server.unref());
    server.on("clientError", () => listenFrom === "clientError" && again());
    server.on("request", (req, res) => {
      if (listenFrom !== "clientError") req.socket.on(listenFrom, again);
      close();
      res.write("x");
      client.once("data", () => res.destroy(new Error("destroyed")));
    });
    const client = open(get);
  };
}
row("a 'clientError' listener listens again", "http", listenAgain("clientError"));
row("the socket's 'error' listener listens again", "http", listenAgain("error"));
row("the socket's 'close' listener listens again", "http", listenAgain("close"));
