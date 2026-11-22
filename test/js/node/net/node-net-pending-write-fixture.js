// A server socket writes a 24 MiB Buffer to a client that starts to read only after write() returned, so the
// kernel takes a part of it and the rest is pending. Runs on Bun and on Node.js, and prints one JSON line.
//
//   <runtime> node-net-pending-write-fixture.js <net|tls> <deliver|mutate>
//
// deliver: the caller leaves the Buffer alone.
// mutate: the caller fills the Buffer with "b" while the rest is pending.
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const net = require("node:net");
const tls = require("node:tls");

const [transport, scenario] = process.argv.slice(2);
const SIZE = 24 * 1024 * 1024;

function filled() {
  const chunk = Buffer.alloc(SIZE, "a");
  if (scenario !== "mutate") {
    for (let i = 0; i < SIZE; i += 4096) chunk.writeUInt32LE(i, i);
  }
  return chunk;
}

const result = { writes: 0, callbacks: 0, callbackError: null, error: null };
const written = createHash("sha1");

function onConnection(socket) {
  socket.on("error", error => (result.error = error.code ?? error.message));
  // On Windows the first send of a socket can take a whole Buffer of this size. The send after it does not.
  let chunk;
  do {
    chunk = filled();
    written.update(chunk);
    result.writes++;
    result.flushed = socket.write(chunk, error => {
      result.callbacks++;
      if (error) result.callbackError ??= error.code ?? error.message;
    });
  } while (result.flushed && result.writes < 4);
  result.writableLength = socket.writableLength;
  result.bytesWritten = socket.bytesWritten;
  if (scenario === "mutate") chunk.fill("b");
  socket.end();
}

(async () => {
  const options = transport === "tls" ? JSON.parse(process.env.PENDING_WRITE_TLS) : {};
  const server =
    transport === "tls" ? tls.createServer(options, onConnection) : net.createServer(options, onConnection);
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address();
  const client =
    transport === "tls"
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
      : net.connect(port, "127.0.0.1");

  const received = createHash("sha1");
  let length = 0;
  // Where the first "b" is: the bytes before it left the Buffer before the caller filled it.
  let sentAtWrite = -1;
  client.on("data", data => {
    if (sentAtWrite < 0) {
      const index = data.indexOf(0x62);
      if (index >= 0) sentAtWrite = length + index;
    }
    length += data.length;
    received.update(data);
  });
  client.on("error", error => (result.error ??= error.code ?? error.message));
  await once(client, "close");
  server.close();

  result.received = length;
  if (scenario === "mutate") {
    if (sentAtWrite < 0) sentAtWrite = length;
    result.fromCallerAfterWrite = length - sentAtWrite;
    const expected = createHash("sha1");
    for (let at = 0; at < length; at += SIZE) {
      const piece = Buffer.alloc(Math.min(SIZE, length - at), "b");
      if (at < sentAtWrite) piece.fill("a", 0, Math.min(sentAtWrite - at, piece.length));
      expected.update(piece);
    }
    result.intact = received.digest("hex") === expected.digest("hex");
  } else {
    result.intact = received.digest("hex") === written.digest("hex");
  }
  console.log(JSON.stringify(result));
})();
