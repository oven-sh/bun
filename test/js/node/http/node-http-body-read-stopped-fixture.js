// One connection of a node:http server in one state, named by argv[2]. The question of every row
// is what keeps the process alive: the process has no timer that holds it and calls no
// process.exit(), so it exits when nothing of the connection keeps it alive. It then prints what
// the row saw as one JSON line. A row whose connection holds the process for good prints nothing.
// The file runs under Node.js as it is.
//
//   PROTO=http|https (with CERT and KEY)
//   CLOSE=before|after|unref   server.close() in the listener, server.close() when the row has
//                              reached its state, or server.unref() in place of it
//   KEEPALIVE=<ms>             server.keepAliveTimeout
"use strict";
const { Readable, Writable, pipeline } = require("node:stream");
const { PROTO, CLOSE = "before", KEEPALIVE, CERT, KEY } = process.env;
const secure = PROTO === "https";
const server = secure
  ? require("node:https").createServer({ cert: CERT, key: KEY })
  : require("node:http").createServer();
const connect = secure ? require("node:tls").connect : require("node:net").connect;
if (KEEPALIVE) server.keepAliveTimeout = Number(KEEPALIVE);

// The first bytes of every body. They come with the head of the request.
const first = Buffer.alloc(1000, "f");
// What a request buffers before it stops the reads.
const full = Buffer.alloc(65536, "x");
// Twice that: the socket has more to read when the reads stop.
const unread = Buffer.alloc(2 * full.length, "x");
// More than a loopback socket takes in one write.
const large = Buffer.alloc(16 * 1024 * 1024, "y");
const tail = Buffer.from("tail");
// A body of this length never ends.
const endless = 10_000_000;
const switching = "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n";
const get = path => `GET ${path} HTTP/1.1\r\nHost: a\r\n\r\n`;
const post = length => `POST / HTTP/1.1\r\nHost: a\r\nContent-Length: ${length}\r\n\r\n`;

const result = { events: [], received: 0 };
const row = { result };

// The peer sends the bytes when it has the first bytes of the reply.
const onReply = (bytes = unread) => row.client.once("data", () => row.client.write(bytes));
// `turns` turns of the event loop later.
function after(turns, fn) {
  setImmediate(function turn() {
    if (--turns > 0) setImmediate(turn);
    else fn();
  });
}
// Runs only if something else has kept the process alive until then.
const ifStillAlive = fn =>
  setTimeout(() => {
    result.events.push("still alive");
    fn();
  }, 150).unref();
// The request reads one chunk and the response ends. Then the peer sends more than the request buffers.
function endThenStop() {
  row.req.once("data", () => {
    row.req.pause();
    row.res.end("done");
  });
  onReply();
}
const count = chunk => (result.received += chunk.length);
// How many bytes a connection takes from a writer whose peer does not read.
function capacity(done) {
  const net = require("node:net");
  const listener = net.createServer(socket => {
    socket.on("error", () => {});
    row.capacity = 0;
    while (socket.write(full)) row.capacity += full.length;
    socket.destroy();
    peer.destroy();
    listener.close(done);
  });
  let peer;
  listener.listen(0, "127.0.0.1", () => {
    peer = net.connect(listener.address().port, "127.0.0.1");
    peer.pause();
    peer.on("error", () => {});
  });
}

// `start` runs when the listener has the request. `stopped` runs when the request has buffered all
// that it takes, which is when it stops the reads of the socket. A row with `own` does not wait for
// that and says itself when it has reached its state (`rest()`). `later` runs the first time
// nothing keeps the process alive, and `last` the second time. `request` takes the requests that
// are not the one of the row, and `before` runs ahead of the server.
const rows = {
  // ---- A request stops the reads and nothing else is left: the process exits. ----
  "the response ended first": { start: endThenStop },
  "the response ended first, the request is piped": {
    start() {
      // It takes one chunk and never asks for the next one.
      row.req.pipe(new Writable({ highWaterMark: 1, write() {} }));
      row.req.once("data", () => row.res.end("done"));
      onReply();
    },
  },
  // The peer of the next two sends `full` and nothing more: the end of the response must leave the reads stopped.
  "the response ends later": {
    start() {
      row.req.once("data", () => {
        row.req.pause();
        row.res.write("part");
      });
      onReply(full);
    },
    stopped: () => after(4, () => row.res.end("done")),
  },
  "the response is written later": {
    start() {
      row.req.once("data", () => row.req.pause());
      row.client.write(full);
    },
    stopped: () => row.res.end("done"),
  },
  "the second request of a connection": {
    head: get("/first"),
    request(req, res) {
      if (req.url !== "/first") return true;
      res.end("first");
      row.client.once("data", () => row.client.write(post(endless) + first));
    },
    start: endThenStop,
  },
  "req.pause() and socket.pause()": {
    own: true,
    start() {
      row.req.once("data", () => {
        row.req.pause();
        row.socket.pause();
        row.res.end("done");
      });
      onReply();
      row.client.once("data", () => after(6, rest));
    },
  },
  // Between two reads: the request has asked for more already and asks no second time.
  "socket.pause() between two reads of a request that has a reader": {
    own: true,
    start() {
      row.req.on("data", count);
      after(2, () => {
        row.socket.pause();
        row.res.end("done");
      });
      onReply();
      row.client.once("data", () => after(6, rest));
    },
  },
  "socket.end() when the reads have stopped": {
    start() {
      row.client.on("end", () => result.events.push("the peer got the FIN"));
      endThenStop();
    },
    stopped: () => row.socket.end(),
  },
  // The second request waits behind the first response. Its body stops the reads, and then both responses end.
  "two pipelined requests, the second one stops the reads": {
    head: get("/first") + post(endless) + first,
    request(req, res) {
      if (req.url !== "/first") return true;
      row.first = res;
    },
    start() {
      row.req.once("data", () => {
        row.req.pause();
        row.client.write(full);
      });
    },
    stopped: () =>
      after(4, () => {
        row.first.end("first");
        row.res.end("done");
      }),
  },
  // The pause comes when both messages are complete, so nothing starts the reads again.
  "two pipelined requests, socket.pause() one turn later and then both responses end": {
    own: true,
    head: get("/first") + get("/second"),
    request(req, res) {
      if (req.url !== "/first") return true;
      row.first = res;
    },
    start() {
      setImmediate(() => {
        row.socket.pause();
        row.first.end("first");
        row.res.end("done");
      });
      row.client.once("data", () => after(6, rest));
    },
  },

  // ---- An Upgrade request whose body still arrives: a body without a response. ----
  "an Upgrade request": {
    upgrade: true,
    start() {
      row.req.once("data", () => {
        row.req.pause();
        row.socket.write(switching);
      });
      onReply();
    },
  },
  "an Upgrade request, socket.pause() and then req.pause()": {
    upgrade: true,
    own: true,
    start() {
      row.socket.pause();
      row.req.pause();
      row.client.write(unread);
      after(8, rest);
    },
  },
  "an Upgrade request, req.pause() and then socket.pause()": {
    upgrade: true,
    own: true,
    start() {
      row.req.pause();
      row.socket.pause();
      row.client.write(unread);
      after(8, rest);
    },
  },
  // The socket that the listener got is not the stream of the body: the request reads on.
  "an Upgrade request that reads, socket.pause() one turn later": {
    upgrade: true,
    own: true,
    length: 3000,
    start() {
      row.req.on("data", count);
      setImmediate(() => {
        row.socket.pause();
        rest();
      });
      ifStillAlive(() => row.client.end(Buffer.alloc(2000, "x")));
    },
  },
  // The last bytes of the body come in the read that fills the request: the tunnel behind them reads.
  "an Upgrade request whose body ends in the read that fills it": {
    upgrade: true,
    own: true,
    length: full.length + 500,
    start() {
      row.req.pause();
      row.socket.write(switching);
      row.client.once("data", () => row.client.write(Buffer.alloc(full.length - first.length - 500, "x")));
      (function untilAlmostFull() {
        if (row.req.readableLength < full.length - 500) return setImmediate(untilAlmostFull);
        row.client.write(Buffer.alloc(1000, "x"));
        rest();
        ifStillAlive(() => row.client.end());
      })();
    },
  },

  // ---- The connection reads, or has bytes left to send: the process stays until that is over. ----
  "a reader comes later": {
    length: first.length + unread.length + tail.length,
    start: endThenStop,
    later() {
      row.req.on("data", chunk => {
        if (count(chunk) === unread.length) row.client.end(tail);
      });
      row.req.resume();
    },
  },
  "bytes left to send": {
    start() {
      row.client.pause();
      row.req.once("data", () => {
        row.req.pause();
        row.res.on("finish", () => result.events.push("finish"));
        // Twice: a socket can take all of one write.
        row.res.write(large);
        row.res.end(large);
      });
      row.client.write(unread);
    },
    stopped: () => setImmediate(() => row.client.resume()),
  },
  "a write to the socket behind the response": {
    start() {
      endThenStop();
      let read = 0;
      row.client.on("data", chunk => {
        if (read < large.length && (read += chunk.length) >= large.length) result.events.push("sent");
      });
    },
    last() {
      row.socket.write(large);
      row.socket.write(large);
    },
  },
  // The reads are stopped and the ended response has a backlog. While it drains, the listener writes to the socket.
  "writes to the socket while the ended response drains": {
    start() {
      row.client.pause();
      row.req.once("data", () => {
        row.req.pause();
        row.res.on("finish", () => result.events.push("finish"));
        row.res.end(large);
      });
      row.client.write(unread);
    },
    stopped() {
      row.client.resume();
      (function write() {
        if (result.events.length) return;
        row.socket.write("x");
        setImmediate(write);
      })();
    },
  },
  // The first response ends with bytes that the socket holds, so the server stops the reads for the
  // second request (flood prevention). That stop ends when the bytes are out: the third request is served.
  "pipelined requests behind bytes that the socket holds": {
    head: get("/first"),
    before: capacity,
    request(req, res) {
      result.events.push(req.url);
      if (req.url === "/first") {
        if (CLOSE !== "after") close();
        row.socket = req.socket;
        row.client.pause();
        res.end("first");
        // A little more than the connection takes.
        row.socket.write(Buffer.alloc(row.capacity + unread.length, "y"));
        row.client.write(get("/second"));
      } else if (req.url === "/second") {
        req.resume();
        res.write("part");
        row.client.write(get("/third"));
        let replies = "";
        row.client.on("data", chunk => {
          if (replies === "") {
            // The socket has room again: this write sends what the server held, and so does any write behind it.
            res.end("done");
            row.socket.write("z");
          }
          replies = (replies + chunk.toString("latin1")).slice(-16);
          if (replies.endsWith("\r\n\r\nthird")) row.client.end();
        });
        setImmediate(() => row.client.resume());
      } else {
        res.end("third");
        rest();
      }
    },
  },
  // Like Node's parser, which starts the reads again behind a complete message: the pause does not hold the next request.
  "socket.pause() in the listener of a request without a body": {
    own: true,
    head: get("/first"),
    request(req, res) {
      result.events.push(req.url);
      if (req.url === "/first") {
        if (CLOSE !== "after") close();
        req.socket.pause();
        res.end("first");
        row.client.once("data", () => row.client.write(get("/second")));
      } else {
        res.end("second");
        row.client.once("data", () => row.client.end());
        rest();
      }
    },
  },
  "a reader all along": {
    own: true,
    length: first.length + tail.length,
    start() {
      row.req.on("data", count);
      row.req.once("data", () => row.res.end("done"));
      row.client.once("data", () => row.client.end(tail));
      rest();
    },
  },
  // Nobody consumes the request: the end of the response dumps it, and the dump reads it to its end.
  "a request that nobody reads": {
    own: true,
    length: first.length + unread.length + tail.length,
    start() {
      row.res.end("done");
      row.client.once("data", () => ifStillAlive(() => row.client.end(Buffer.concat([unread, tail]))));
      rest();
    },
  },
  "socket.pause(), then socket.resume() later": {
    own: true,
    length: first.length + unread.length + tail.length,
    start() {
      row.req.on("data", chunk => {
        if (count(chunk) === first.length + unread.length) row.client.end(tail);
      });
      after(2, () => {
        row.socket.pause();
        row.res.end("done");
      });
      onReply();
      row.client.once("data", () => after(6, rest));
    },
    later: () => row.socket.resume(),
  },
  // A later chunk of the body: the request asks for more one tick later, so the reads go on.
  "socket.pause() inside a later 'data' of a request that has a reader": {
    own: true,
    length: 2 * first.length + unread.length + tail.length,
    start() {
      let chunks = 0;
      row.req.on("data", chunk => {
        if (++chunks === 1) row.client.write(first);
        if (chunks === 2) {
          row.socket.pause();
          row.res.end("done");
        }
        if (count(chunk) === 2 * first.length + unread.length) row.client.end(tail);
      });
      onReply();
      row.client.once("data", () => after(6, rest));
    },
  },
  // The body is complete behind the paused request, so the connection waits for its next request.
  "a paused request whose body completes": {
    own: true,
    length: 3000,
    start() {
      row.req.once("data", () => {
        row.req.pause();
        row.res.end("done");
      });
      onReply(Buffer.alloc(2000, "x"));
      row.client.once("data", () => after(6, rest));
      ifStillAlive(() => row.client.end());
    },
  },

  // ---- The connection closes. ----
  "the request is destroyed when the reads have stopped": { start: endThenStop, stopped: () => row.req.destroy() },
  "the response closes the connection": {
    own: true,
    start() {
      row.req.once("data", () => {
        row.req.pause();
        row.res.setHeader("Connection", "close");
        row.res.end("done");
        rest();
      });
      onReply();
    },
  },

  // ---- States in which Bun does not do what Node.js does. The tests say why. ----
  "the response stays in flight": {
    start() {
      row.req.once("data", () => {
        row.req.pause();
        row.res.write("part");
      });
      onReply();
    },
  },
  // The first response stays open and the second one waits behind it with more than the socket
  // buffers. With the third request the server stops the reads.
  "pipelined requests behind an open response": {
    own: true,
    head: get("/1") + get("/2") + get("/3"),
    request(req, res) {
      if (req.url === "/1") res.write("one");
      if (req.url === "/2") res.end(unread);
      return req.url === "/3";
    },
    start: () => rest(),
  },
  "socket.end() before the reads stop": {
    own: true,
    start() {
      row.client.on("end", () => result.events.push("the peer got the FIN"));
      row.req.once("data", () => {
        row.req.pause();
        row.res.end("done");
        row.socket.end();
      });
      onReply();
      row.client.once("data", () => after(8, rest));
    },
  },
  // The request asks for more one tick later, which starts the reads again in Bun.
  "socket.pause() inside the first 'data' of a request that has a reader": {
    own: true,
    start() {
      row.req.on("data", count);
      row.req.once("data", () => {
        row.socket.pause();
        row.res.end("done");
      });
      onReply();
      row.client.once("data", () => after(6, rest));
    },
  },
  // The reader lets go of the body before its end: the stream is destroyed and the socket is kept.
  "for await (const chunk of req) break": {
    own: true,
    start() {
      (async () => {
        for await (const chunk of row.req) break;
        row.res.end("done");
      })();
      onReply();
      row.client.once("data", () => after(6, rest));
    },
  },
  "pipeline(req, sink) and the sink fails": {
    own: true,
    start() {
      const sink = new Writable({ write: (chunk, encoding, callback) => callback(new Error("too large")) });
      pipeline(row.req, sink, () => {
        row.res.statusCode = 413;
        row.res.end("done");
      });
      onReply();
      row.client.once("data", () => after(6, rest));
    },
  },
  "Readable.toWeb(req) and the reader cancels": {
    own: true,
    start() {
      (async () => {
        const reader = Readable.toWeb(row.req).getReader();
        await reader.read();
        await reader.cancel();
        row.res.end("done");
      })();
      onReply();
      row.client.once("data", () => after(6, rest));
    },
  },
};

const kind = rows[process.argv[2]];
if (!kind) throw new Error(`no such row: ${process.argv[2]}`);

function close() {
  if (CLOSE === "unref") server.unref();
  else server.close(() => (result.server = "close"));
}
let rested = false;
function rest() {
  if (rested) return;
  rested = true;
  if (CLOSE === "after") close();
}

const steps = ["later", "last"].filter(step => kind[step]);
process.on("beforeExit", () => kind[steps.shift()]?.());

function untilReadsStop() {
  if (row.req.readableLength < row.req.readableHighWaterMark) return setImmediate(untilReadsStop);
  kind.stopped?.();
  rest();
}

function onRequest(req, res, socket = req.socket) {
  if (kind.request && !kind.request(req, res)) return;
  Object.assign(row, { req, res, socket });
  req.on("end", () => result.events.push("end"));
  socket.on("close", () => result.events.push("close"));
  if (CLOSE !== "after") close();
  kind.start();
  if (!kind.own) untilReadsStop();
}
server.on("request", onRequest).on("upgrade", (req, socket) => onRequest(req, undefined, socket));

const listen = () => server.listen(0, "127.0.0.1", onListening);
function onListening() {
  const client = (row.client = connect({
    port: server.address().port,
    host: "127.0.0.1",
    allowHalfOpen: true,
    rejectUnauthorized: false,
  }));
  // Only the server's side of the connection may keep this process alive.
  client.unref();
  client.on("error", () => {});
  client.once(secure ? "secureConnect" : "connect", () => {
    if (kind.head) return void client.write(kind.head);
    const upgrade = kind.upgrade ? "Connection: Upgrade\r\nUpgrade: raw\r\n" : "";
    client.write(`POST / HTTP/1.1\r\nHost: a\r\n${upgrade}Content-Length: ${kind.length ?? endless}\r\n\r\n${first}`);
  });
}
if (kind.before) kind.before(listen);
else listen();

process.on("exit", () => console.log(JSON.stringify(result)));
