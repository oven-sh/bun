// A server whose requests do not read their body to its end. A request buffers what the peer sends
// up to its high-water mark and then stops the reads of the socket. From then on it does not keep
// the process alive, unless it reads again or its socket has bytes left to send. The process
// prints what every request saw when it exits, and it must exit by itself: it has no timer and
// calls no process.exit().
//
//   PROTO=http|https (with CERT and KEY)
//   CLOSE=before|after|unref   server.close() before or after the reads of the requests stop, or
//                              server.unref() in place of it
//   KEEPALIVE=<ms>             server.keepAliveTimeout
"use strict";
const { Writable } = require("node:stream");
const { PROTO, CLOSE, KEEPALIVE, CERT, KEY } = process.env;
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

// The peer sends the bytes when it has the first bytes of the reply.
const onReply = ({ client }, bytes = unread) => client.once("data", () => client.write(bytes));

// The request reads one chunk and the response ends. Then the peer sends more than the request buffers.
function endThenStop(row) {
  row.req.once("data", () => {
    row.req.pause();
    row.res.end("done");
  });
  onReply(row);
}

// `start` runs when the listener has the request, and `stopped` when the request has stopped the
// reads of the socket. `later` runs the first time nothing keeps the process alive, and `last`
// the second time.
const kinds = {
  // Behind the first five, nothing keeps the process alive.
  "the response ended first": { start: endThenStop },
  "the response ended first, the request is piped": {
    start(row) {
      // It takes one chunk and never asks for the next one.
      row.req.pipe(new Writable({ highWaterMark: 1, write() {} }));
      row.req.once("data", () => row.res.end("done"));
      onReply(row);
    },
  },
  // The peer of the next two sends `full` and nothing more: the end of the response must leave the reads stopped.
  "the response ends later": {
    start(row) {
      row.req.once("data", () => {
        row.req.pause();
        row.res.write("part");
      });
      onReply(row, full);
    },
    // A few turns of the event loop later, the socket has nothing to report any more.
    stopped(row) {
      let turns = 4;
      setImmediate(function turn() {
        if (--turns) setImmediate(turn);
        else row.res.end("done");
      });
    },
  },
  // Its first byte goes out when the reads have stopped.
  "the response is written later": {
    start(row) {
      row.req.once("data", () => row.req.pause());
      row.client.write(full);
    },
    stopped: row => row.res.end("done"),
  },
  "an Upgrade request": {
    upgrade: true,
    start(row) {
      row.req.once("data", () => {
        row.req.pause();
        row.socket.write(switching);
      });
      onReply(row);
    },
  },

  // The other four keep the process alive for a time: a request that reads, or bytes left to send.
  "a reader comes later": {
    length: first.length + unread.length + tail.length,
    start: endThenStop,
    later(row) {
      // From here on only the reads of this socket keep the process alive.
      row.req.on("data", chunk => {
        row.result.received += chunk.length;
        if (row.result.received === unread.length) row.client.end(tail);
      });
      row.req.resume();
    },
  },
  // The peer does not read them until the reads have stopped.
  "bytes left to send": {
    start(row) {
      row.client.pause();
      row.req.once("data", () => {
        row.req.pause();
        row.res.on("finish", () => row.result.events.push("finish"));
        row.res.end(large);
      });
      row.client.write(unread);
    },
    stopped: row => setImmediate(() => row.client.resume()),
  },
  "a write to the socket behind the response": {
    start(row) {
      endThenStop(row);
      // The send and receive buffers of a loopback socket take less than three quarters of `large`:
      // the peer has read the rest before the last byte leaves the server.
      const most = large.length / 4;
      let read = 0;
      row.client.on("data", chunk => {
        if (read < most && (read += chunk.length) >= most) row.result.events.push("sent");
      });
    },
    // From here on only these bytes keep the process alive.
    last: row => row.socket.write(large),
  },
  // The reads of this request never stop. It starts when the reads of the other requests have stopped.
  "a reader all along": {
    reads: true,
    length: first.length + tail.length,
    start(row) {
      row.req.on("data", chunk => (row.result.received += chunk.length));
      row.req.once("data", () => row.res.end("done"));
      row.client.once("data", () => row.client.end(tail));
    },
  },
};

const rows = Object.entries(kinds).map(([name, kind]) => ({ name, kind, result: { events: [], received: 0 } }));
const results = Object.fromEntries(rows.map(row => [row.name, row.result]));
const readers = rows.filter(row => row.kind.reads);
let dispatched = 0;
let atRest = 0;

function close() {
  if (CLOSE === "unref") return void server.unref();
  server.close(() => (results.server = "close"));
}

// A request whose reads have stopped has done what it does.
function rest() {
  if (++atRest < rows.length - readers.length) return;
  if (CLOSE === "after") close();
  for (const row of readers) row.kind.start(row);
}

// Nothing keeps the process alive here. A step that did not get its time shows in the rows: the
// process exits, and they are as they are.
const steps = ["later", "last"];
process.on("beforeExit", () => {
  const step = steps.shift();
  for (const row of rows) row.kind[step]?.(row);
});

function start(row) {
  const { req, kind } = row;
  if (kind.reads) return;
  kind.start(row);
  (function untilReadsStop() {
    if (req.readableLength < req.readableHighWaterMark) return setImmediate(untilReadsStop);
    kind.stopped?.(row);
    rest();
  })();
}

function onRequest(req, res, socket = req.socket) {
  const row = rows.find(row => row.name === req.headers.row);
  Object.assign(row, { req, res, socket });
  req.on("end", () => row.result.events.push("end"));
  socket.on("error", error => row.result.events.push(error.code));
  socket.on("close", () => row.result.events.push("close"));
  if (++dispatched < rows.length) return;
  if (CLOSE !== "after") close();
  rows.forEach(start);
}
server.on("request", onRequest).on("upgrade", (req, socket) => onRequest(req, undefined, socket));

server.listen(0, "127.0.0.1", () => {
  for (const row of rows) {
    const { name, kind } = row;
    const client = (row.client = connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false }));
    // Only the server's side of a connection may keep this process alive.
    client.unref();
    const lost = event => {
      if (!row.req) results[name] = `the peer got '${event}' before the listener ran`;
    };
    client.on("error", () => lost("error"));
    client.on("close", () => lost("close"));
    client.once(secure ? "secureConnect" : "connect", () => {
      client.write(
        `POST / HTTP/1.1\r\nHost: a\r\nRow: ${name}\r\n` +
          (kind.upgrade ? "Connection: Upgrade\r\nUpgrade: raw\r\n" : "") +
          `Content-Length: ${kind.length ?? endless}\r\n\r\n${first}`,
      );
    });
  }
});

process.on("exit", () => console.log(JSON.stringify(results)));
