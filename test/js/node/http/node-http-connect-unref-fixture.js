// 'upgrade' and 'connect' listeners that call socket.unref() and socket.ref(). A tunnel keeps the
// process alive while it reads and is ref'd, or while it has bytes left to send. The process prints
// what every tunnel saw when it exits, and it must exit by itself: it has no timer and calls no
// process.exit().
//
//   PROTO=http|https (with CERT and KEY)
"use strict";
const { PROTO, CERT, KEY } = process.env;
const secure = PROTO === "https";
const server = secure
  ? require("node:https").createServer({ cert: CERT, key: KEY })
  : require("node:http").createServer();
const connect = secure ? require("node:tls").connect : require("node:net").connect;

const upgrade = "GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: raw\r\n";
// `first` is a request that the peer sends before this one, on the same connection.
const requests = {
  "upgrade": { head: upgrade },
  "connect": { head: "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n" },
  // The tunnel starts behind the body, and the listener runs before it.
  "upgrade with a body": {
    head: "POST / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: raw\r\nContent-Length: 5\r\n",
    body: "hello",
  },
  "upgrade behind a request": { head: upgrade, first: "GET / HTTP/1.1\r\nHost: a\r\n\r\n" },
};
// The 'connect' listener gives the socket back to the server as a connection, and the server
// parses the Upgrade request on it in JavaScript.
if (!secure) {
  requests["upgrade on a re-emitted tunnel"] = {
    head: upgrade,
    first: "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nReemit: 1\r\n\r\n",
  };
}
const reply = "HTTP/1.1 200 OK\r\n\r\n";
// What the socket buffers before it stops its reads.
const full = Buffer.alloc(65536, "x");
// More than a loopback socket takes in one write.
const large = Buffer.alloc(16 * 1024 * 1024, "y");

// The server closes when the reads of every tunnel that waits for it have stopped. Up to there the
// listening server keeps the process alive, also for the peers of the tunnels that are unref'd.
let waiting = 0;
function whenReadsStop(socket, then) {
  waiting++;
  (function poll() {
    if (socket.readableLength < socket.readableHighWaterMark) return setImmediate(poll);
    then?.();
    if (--waiting === 0) server.close(() => (results.server = "close"));
  })();
}

function count({ socket, result }) {
  socket.on("data", chunk => (result.received += chunk.length));
}

// Wraps a callback that the process must stay alive for.
let holding = 0;
function held(callback) {
  holding++;
  return () => {
    holding--;
    callback?.();
  };
}

// `connection` runs in the 'connection' listener and `listener` in the 'upgrade' or 'connect'
// listener. `start` runs when every tunnel has its listener, before the peer has the reply. The
// `later` steps run one at a time, each when nothing keeps the process alive: from there on, only
// its tunnel can. `more` is what the peer does when it has read "more".
const kinds = {
  // The tunnel of a request with a body has not started there.
  "unref() in the listener": {
    requests: Object.keys(requests),
    listener: ({ socket }) => socket.unref(),
  },
  "unref() while it reads": {
    requests: ["upgrade", "connect", "upgrade with a body"],
    start: ({ socket }) => socket.unref(),
  },
  // The listener writes nothing to this tunnel.
  "unref() before the request": {
    requests: ["upgrade", "upgrade with a body", "upgrade behind a request"],
    silent: true,
    connection: socket => socket.unref(),
  },
  // The bytes that are left to send keep the process alive.
  "unref(), then a write": {
    start({ socket, result }) {
      socket.unref();
      socket.write(
        large,
        held(() => result.events.push("write callback")),
      );
    },
  },
  "a write, then unref()": {
    start({ socket, result }) {
      socket.write(
        large,
        held(() => result.events.push("write callback")),
      );
      socket.unref();
    },
  },
  // The end of the stream goes out behind the bytes.
  "unref(), then end() with bytes": {
    start({ socket, result }) {
      socket.unref();
      socket.end(
        large,
        held(() => result.events.push("finish")),
      );
    },
  },
  "ref() after its reads stopped": {
    peerSends: full,
    start: ({ socket }) => whenReadsStop(socket, () => socket.ref()),
  },
  "ref() at the end of the stream": {
    peerEnds: true,
    start(tunnel) {
      tunnel.atEnd = held(() => tunnel.socket.ref());
      tunnel.socket.resume();
    },
    end: tunnel => tunnel.atEnd(),
  },
  "unref(), then its reads stop, then a reader": {
    peerSends: full,
    start(tunnel) {
      tunnel.socket.unref();
      whenReadsStop(tunnel.socket, () => count(tunnel));
    },
  },
  "unref(), then its reads stop, then ref() and a reader": {
    peerSends: full,
    start({ socket }) {
      socket.unref();
      whenReadsStop(socket);
    },
    later({ socket, result }) {
      socket.ref();
      socket.on("data", chunk => {
        result.received += chunk.length;
        if (result.received === full.length) socket.write("more");
      });
    },
    more: client => client.end(full),
  },
  "a reader, then unref(), then ref()": {
    start(tunnel) {
      count(tunnel);
      tunnel.socket.unref();
    },
    later({ socket }) {
      socket.ref();
      socket.write("more");
    },
    more: client => client.end(full),
  },
};
const all = [];
for (const [name, kind] of Object.entries(kinds)) {
  for (const request of kind.requests ?? ["upgrade"]) {
    all.push({ name: `${request}, ${name}`, request: requests[request], kind, result: { events: [], received: 0 } });
  }
}
const tunnels = Object.fromEntries(all.map(tunnel => [tunnel.name, tunnel]));
const results = {};
const later = all.filter(tunnel => tunnel.kind.later);
let handedOff = 0;

// Nothing keeps the process alive here. When something is not done that the process must stay
// alive for, it exits, and the rows are as they are.
process.on("beforeExit", () => {
  if (holding > 0 || later.length === 0) return;
  const tunnel = later.shift();
  tunnel.socket.once("close", held());
  tunnel.kind.later(tunnel);
});

function onTunnel(req, socket) {
  const tunnel = tunnels[req.headers.tunnel];
  const { kind, result } = tunnel;
  tunnel.socket = socket;
  results[tunnel.name] = result;
  socket.on("error", error => result.events.push(error.code));
  socket.on("end", () => {
    result.events.push("end");
    if (kind.end) kind.end(tunnel);
    else socket.end();
  });
  socket.on("close", () => result.events.push("close"));
  kind.listener?.(tunnel);
  if (++handedOff < all.length) return;
  for (const tunnel of all) {
    if (!tunnel.kind.silent) tunnel.socket.write(reply);
    tunnel.kind.start?.(tunnel);
  }
}
server.on("request", (req, res) => res.end("ok"));
server.on("upgrade", onTunnel).on("connect", (req, socket) => {
  if (!req.headers.reemit) return onTunnel(req, socket);
  socket.write(reply);
  server.emit("connection", socket);
});

function open(tunnel) {
  const { name, kind } = tunnel;
  const { head, body = "", first } = tunnel.request;
  // Half-open: the peer ends its side only where its kind says so.
  const client = connect({
    port: server.address().port,
    host: "127.0.0.1",
    rejectUnauthorized: false,
    allowHalfOpen: true,
  });
  // Only the server's side of a tunnel may keep this process alive.
  client.unref();
  const lost = event => {
    if (!tunnel.socket) results[name] = `the peer got '${event}' before the listener ran`;
  };
  client.on("error", () => lost("error"));
  client.on("close", () => lost("close"));
  const request = () => {
    client.write(`${head}Tunnel: ${name}\r\n\r\n${body}`);
    if (kind.silent) return client.resume();
    // The reply: the listener has run, so the socket gets the bytes behind it and not the `head` argument.
    client.once("data", () => {
      if (kind.peerEnds) return client.end();
      if (kind.peerSends) client.write(kind.peerSends);
      if (!kind.more) return client.resume();
      let tail = "";
      client.on("data", chunk => {
        tail = (tail + chunk.toString("latin1")).slice(-4);
        if (tail === "more") kind.more(client);
      });
    });
  };
  client.once(secure ? "secureConnect" : "connect", () => {
    if (!first) return request();
    client.write(first);
    client.once("data", request);
  });
}

// One connection at a time, so that the 'connection' listener knows whose socket it has.
const opening = [...all];
const accepted = new Set();
server.on("connection", socket => {
  // A re-emitted tunnel comes here a second time.
  if (accepted.has(socket)) return;
  accepted.add(socket);
  opening.shift().kind.connection?.(socket);
  if (opening.length > 0) open(opening[0]);
});
server.listen(0, "127.0.0.1", () => open(opening[0]));

process.on("exit", () => console.log(JSON.stringify(results)));
