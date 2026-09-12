import { connect, listen } from "bun";
import { fillRepeating } from "harness";

// The test passes the transfer size; it is smaller on debug and ASAN builds.
const size = process.argv[2] ? Number.parseInt(process.argv[2], 10) : 1024 * 1024 * 1024;
if (!Number.isInteger(size) || size <= 0) {
  throw new Error(`transfer size must be a positive integer, got ${process.argv[2]}`);
}
const huge = Buffer.alloc(size);
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
      socket.data.sent = socket.write(huge);
      if (socket.data.sent === huge.length) {
        socket.shutdown();
        serverResolve(socket.data.sent);
      }
    },
    async drain(socket) {
      socket.data.sent += socket.write(huge.subarray(socket.data.sent));

      if (socket.data.sent === huge.length) {
        socket.shutdown();
        serverResolve(socket.data.sent);
      }
    },
  },
});

const socket = await connect({
  port: server.port,
  hostname: server.hostname,
  data: { received: 0 },
  socket: {
    open(socket) {
      socket.data.received = 0;
    },

    data(socket, data) {
      socket.data.received += data.length;
      received.update(data);

      if (socket.data.received === huge.length) {
        socket.end();
        clientResolve(socket.data.received);
      }
    },
  },
});

const [receivedBytes, sentBytes] = await Promise.all([clientPromise, serverPromise]);
server.stop(true);
socket.end();

if (received.digest("hex") !== Bun.SHA256.hash(huge, "hex")) {
  throw new Error("Received data doesn't match sent data");
}

console.log(`sent ${sentBytes} bytes, received ${receivedBytes} bytes, digest matches`);
process.exit(0);
