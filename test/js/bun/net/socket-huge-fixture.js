import { connect, listen } from "bun";

const huge = Buffer.alloc(1024 * 1024 * 1024);
export function fillRepeating(dstBuffer, start, end) {
  let len = dstBuffer.length, // important: use indices length, not byte-length
    sLen = end - start,
    p = sLen; // set initial position = source sequence length

  // step 2: copy existing data doubling segment length per iteration
  while (p < len) {
    if (p + sLen > len) sLen = len - p; // if not power of 2, truncate last segment
    dstBuffer.copyWithin(p, start, sLen); // internal copy
    p += sLen; // add current length to offset
    sLen <<= 1; // double length for next segment
  }
}
for (let i = 0; i < 1024; i++) {
  huge[i] = (Math.random() * 255) | 0;
}
fillRepeating(huge, 0, 1024);
const received = new Bun.SHA256();

const { promise: clientPromise, resolve: clientResolve } = Promise.withResolvers();
const { promise: serverPromise, resolve: serverResolve } = Promise.withResolvers();

var server = listen({
  port: 0,
  hostname: "localhost",
  data: { sent: 0 },
  socket: {
    open(socket) {
      console.time("send 1 GB (server)");
      socket.data.sent = socket.write(huge);
    },
    async drain(socket) {
      socket.data.sent += socket.write(huge.subarray(socket.data.sent));

      if (socket.data.sent === huge.length) {
        console.timeEnd("send 1 GB (server)");
        socket.shutdown();
        server.stop(true);
        serverResolve();
      }
    },
  },
});

const socket = await connect({
  port: server.port,
  hostname: "localhost",
  data: { received: 0 },
  socket: {
    open(socket) {
      console.time("recv 1 GB (client)");
      socket.data.received = 0;
    },

    data(socket, data) {
      socket.data.received += data.length;
      console.log("Received", data.length, "bytes");
      received.update(data);

      if (socket.data.received === huge.length) {
        console.timeEnd("recv 1 GB (client)");
        socket.end();
        clientResolve();
      }
    },
  },
});

await Promise.all([clientPromise, serverPromise]);
server.stop();
socket.end();

if (received.digest("hex") !== Bun.SHA256.hash(huge, "hex")) {
  throw new Error("Received data doesn't match sent data");
}

process.exit(0);
