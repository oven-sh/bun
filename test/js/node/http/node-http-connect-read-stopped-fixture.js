// A server whose 'upgrade' and 'connect' listeners never read the socket. The socket buffers what
// the peer sends up to its high-water mark and then stops its reads. The process prints what every
// tunnel saw when it exits, and it must exit by itself: it has no timer and calls no process.exit().
//
//   PROTO=http|https (with CERT and KEY)
//   CLOSE=before|after   server.close() before or after the reads of the tunnels stop
//   READERS=1            the tunnels get a 'data' listener and are read to their end
//   SERVER=unref|ref     server.unref() comes before server.close(), and server.ref() between them
//                        for "ref". One tunnel gets a 'data' listener when nothing keeps the process alive
"use strict";
const { PROTO, CLOSE, READERS, SERVER, CERT, KEY } = process.env;
const secure = PROTO === "https";
const server = secure
  ? require("node:https").createServer({ cert: CERT, key: KEY })
  : require("node:http").createServer();
const connect = secure ? require("node:tls").connect : require("node:net").connect;

const requests = {
  "upgrade": ["GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: raw\r\n", ""],
  "connect": ["CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n", ""],
  // The tunnel starts behind the body.
  "upgrade with a body": [
    "POST / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: raw\r\nContent-Length: 5\r\n",
    "hello",
  ],
};
// The 'connect' listener gives the socket back to the server as a connection, and the server
// parses the Upgrade request on it in JavaScript.
const reemitted = "upgrade on a re-emitted tunnel";
if (!secure) requests[reemitted] = requests.upgrade;
const reply = "HTTP/1.1 200 OK\r\n\r\n";
// Twice what the socket buffers before it stops its reads. With SERVER, what it buffers and no
// more: no byte is on its way when the reads stop.
const unread = Buffer.alloc((SERVER ? 1 : 2) * 65536, "x");
// More than a loopback socket takes in one write.
const large = Buffer.alloc(16 * 1024 * 1024, "y");
// More than the server reads from a socket in one turn of the event loop.
const upload = Buffer.alloc(8 * 1024 * 1024, "z");

// `stopped` runs when the reads of the tunnel have stopped. `peer` is what the peer does when it
// has the reply: by default it sends `unread` and reads what comes.
const stoppedKinds = {
  // The peer closes its socket behind its bytes.
  "the peer leaves": {
    stopped(tunnel) {
      tunnel.client.once("close", rest);
      tunnel.client.destroySoon();
    },
  },
  // The peer is still connected when the process exits.
  "the peer stays": {},
  "the listener ended it at once": {
    start: tunnel => tunnel.socket.end(reply),
    stopped(tunnel) {
      tunnel.client.end();
      rest();
    },
  },
  "the listener ends it later": {
    stopped(tunnel) {
      tunnel.socket.end();
      tunnel.client.end();
      rest();
    },
  },
  // The bytes that are left to send keep the process alive, and then nothing does.
  "the listener writes to it later": {
    stopped(tunnel) {
      tunnel.socket.write(large, () => tunnel.result.events.push("write callback"));
      rest();
    },
  },
  // The peer does not read them until the listener has ended the socket.
  "the listener ends it later with bytes": {
    peer(client) {
      client.write(unread);
      client.pause();
    },
    stopped(tunnel) {
      tunnel.socket.end(large, () => tunnel.result.events.push("finish"));
      setImmediate(() => tunnel.client.resume());
      rest();
    },
  },
};
// A tunnel that reads keeps the process alive. `more` is what the peer does when it has read "more".
const readerKinds = {
  // The reads of this tunnel never stop for the listener. The server pauses them by itself while
  // chunks wait for their turn. It starts when the reads of the other tunnels have stopped.
  "a reader that writes for every chunk": {
    reads: true,
    start({ socket, result }) {
      socket.write(reply);
      socket.on("data", chunk => {
        result.received += chunk.length;
        socket.write("a");
        if (result.received === upload.length) socket.write("more");
      });
    },
    peer: client => client.write(upload),
    more: client => client.end("tail"),
  },
  // Its reader comes when nothing keeps the process alive.
  "a reader comes later": {
    later({ socket, result }) {
      socket.on("data", chunk => {
        result.received += chunk.length;
        // From here on this tunnel has nothing buffered and nothing to send.
        if (result.received === unread.length) socket.write("more");
      });
    },
    more: client => client.end(unread),
  },
};
// With SERVER, one tunnel of the second kind. In Node.js its socket keeps the process alive up to
// its 'close' in both cases.
if (SERVER) delete readerKinds["a reader that writes for every chunk"];
const kinds = READERS || SERVER ? readerKinds : stoppedKinds;

const tunnels = {};
const results = {};
for (const request of SERVER ? ["upgrade"] : Object.keys(requests)) {
  for (const kind in kinds) {
    const name = `${request}, ${kind}`;
    tunnels[name] = { name, request, kind: kinds[kind], result: { events: [], received: 0 } };
  }
}
const all = Object.values(tunnels);
const readers = all.filter(tunnel => tunnel.kind.reads);
let handedOff = 0;
let atRest = 0;

function close() {
  if (SERVER) server.unref();
  if (SERVER === "ref") server.ref();
  server.close(() => (results.server = "close"));
}

// A tunnel whose reads have stopped has done what it does.
function rest() {
  if (++atRest < all.length - readers.length) return;
  if (CLOSE === "after") close();
  for (const tunnel of readers) tunnel.kind.start(tunnel);
}

// Nothing keeps the process alive here. A reader that is not at its 'close' yet shows that nothing
// did it for that reader: the process exits, and the rows are as they are.
process.once("beforeExit", () => {
  if (readers.some(tunnel => !tunnel.result.events.includes("close"))) return;
  for (const tunnel of all) tunnel.kind.later?.(tunnel);
});

function start(tunnel) {
  const { socket, kind } = tunnel;
  if (kind.reads) return;
  if (kind.start) kind.start(tunnel);
  else socket.write(reply);
  (function untilReadsStop() {
    if (socket.readableLength < socket.readableHighWaterMark) return setImmediate(untilReadsStop);
    if (kind.stopped) kind.stopped(tunnel);
    else rest();
  })();
}

function onTunnel(req, socket) {
  const tunnel = tunnels[req.headers.tunnel];
  tunnel.socket = socket;
  results[tunnel.name] = tunnel.result;
  socket.on("error", error => tunnel.result.events.push(error.code));
  socket.on("end", () => {
    tunnel.result.events.push("end");
    socket.end();
  });
  socket.on("close", () => tunnel.result.events.push("close"));
  const handOff = () => {
    if (CLOSE === "after") return start(tunnel);
    if (++handedOff < all.length) return;
    close();
    all.forEach(start);
  };
  // The tunnel starts behind the body of the request.
  if (requests[tunnel.request][1]) req.on("end", handOff).resume();
  else handOff();
}
server.on("upgrade", onTunnel).on("connect", (req, socket) => {
  if (!req.headers.reemit) return onTunnel(req, socket);
  socket.write(reply);
  server.emit("connection", socket);
});

server.listen(0, "127.0.0.1", () => {
  for (const tunnel of all) {
    const { name, kind } = tunnel;
    const [head, body] = requests[tunnel.request];
    // Half-open: the peer ends its side only where its kind says so.
    const client = (tunnel.client = connect({
      port: server.address().port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
      allowHalfOpen: true,
    }));
    // Only the server's side of a tunnel may keep this process alive.
    client.unref();
    const lost = event => {
      if (!tunnel.socket) results[name] = `the peer got '${event}' before the listener ran`;
    };
    client.on("error", () => lost("error"));
    client.on("close", () => lost("close"));
    const request = () => {
      client.write(`${head}Tunnel: ${name}\r\n\r\n${body}`);
      // The reply: the listener has run, so the socket gets the bytes behind it and not the `head` argument.
      client.once("data", () => {
        if (kind.peer) {
          kind.peer(client);
        } else {
          client.write(unread);
          client.resume();
        }
        if (!kind.more) return;
        let tail = "";
        client.on("data", chunk => {
          tail = (tail + chunk.toString("latin1")).slice(-4);
          if (tail === "more") kind.more(client);
        });
      });
    };
    client.once(secure ? "secureConnect" : "connect", () => {
      if (tunnel.request !== reemitted) return request();
      client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nReemit: 1\r\n\r\n");
      client.once("data", request);
    });
  }
});

process.on("exit", () => console.log(JSON.stringify(results)));
