// An https server whose 'upgrade' listener ends its socket with bytes, on a connection whose send
// buffer is small: the kernel takes less than one TLS record at a time, so TLS still holds bytes
// when the socket ends. The reads of the tunnel do not keep the process alive, and its peer stays
// connected. The process prints what the tunnel saw when it exits, and it must exit by itself: it
// has no timer and calls no process.exit().
//
//   KIND=unref|stopped   socket.unref(), or reads that stopped for a full buffer
//   CERT, KEY, LIBC (the libc to dlopen)
"use strict";
const { dlopen, ptr } = require("bun:ffi");
const { KIND, CERT, KEY, LIBC } = process.env;
const libc = dlopen(LIBC, {
  getpeername: { args: ["i32", "ptr", "ptr"], returns: "i32" },
  setsockopt: { args: ["i32", "i32", "i32", "ptr", "u32"], returns: "i32" },
}).symbols;
const darwin = process.platform === "darwin";
const AF_INET = 2;
const SOL_SOCKET = darwin ? 0xffff : 1;
const SO_SNDBUF = darwin ? 0x1001 : 7;

// The socket has no descriptor to ask for: it is the one whose peer has this port.
function descriptorOf(socket) {
  // struct sockaddr_in: the family (behind a length byte on macOS), then the port in network order.
  const address = new Uint8Array(16);
  const length = new Uint32Array(1);
  const view = new DataView(address.buffer);
  for (let fd = 3; fd < 1024; fd++) {
    length[0] = address.length;
    if (libc.getpeername(fd, ptr(address), ptr(length)) !== 0) continue;
    const family = darwin ? address[1] : view.getUint16(0, true);
    if (family === AF_INET && view.getUint16(2, false) === socket.remotePort) return fd;
  }
  throw new Error("found no descriptor for the connection");
}

const server = require("node:https").createServer({ cert: CERT, key: KEY });
const result = { events: [] };
// Four TLS records.
const bytes = Buffer.alloc(65536, "y");

server.on("upgrade", (req, socket) => {
  socket.on("error", error => result.events.push(error.code));
  socket.on("end", () => result.events.push("end"));
  socket.on("close", () => result.events.push("close"));
  const size = new Int32Array([4096]);
  if (libc.setsockopt(descriptorOf(socket), SOL_SOCKET, SO_SNDBUF, ptr(size), 4) !== 0) {
    throw new Error("setsockopt(SO_SNDBUF) failed");
  }
  socket.write("HTTP/1.1 200 OK\r\n\r\n");
  server.close(() => result.events.push("server close"));
  const end = () => socket.end(bytes, () => result.events.push("finish"));
  if (KIND === "unref") {
    socket.unref();
    return end();
  }
  (function untilReadsStop() {
    if (socket.readableLength < socket.readableHighWaterMark) return setImmediate(untilReadsStop);
    end();
  })();
});

server.listen(0, "127.0.0.1", () => {
  const client = require("node:tls").connect({
    port: server.address().port,
    host: "127.0.0.1",
    rejectUnauthorized: false,
    allowHalfOpen: true,
  });
  // Only the server's side of the tunnel may keep this process alive.
  client.unref();
  client.on("error", error => result.events.push(`peer: ${error.code}`));
  client.once("secureConnect", () => {
    client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n");
    // The reply: the listener has run, so the socket gets the bytes behind it and not the `head` argument.
    client.once("data", () => {
      // Twice what the socket buffers before it stops its reads.
      if (KIND === "stopped") client.write(Buffer.alloc(2 * 65536, "x"));
      client.resume();
    });
  });
});

process.on("exit", () => console.log(JSON.stringify(result)));
