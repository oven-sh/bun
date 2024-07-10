import { connect, listen } from "bun";
import { fillRepeating } from "harness";

const huge = Buffer.alloc(1024 * 1024 * 1024);
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
      if (socket.data.sent === huge.length) {
        console.timeEnd("send 1 GB (server)");
        socket.shutdown();
        serverResolve();
      }
    },
    async drain(socket) {
      socket.data.sent += socket.write(huge.subarray(socket.data.sent));
      // console.error("Sent", socket.data.sent, "bytes");

      if (socket.data.sent === huge.length) {
        console.timeEnd("send 1 GB (server)");
        socket.shutdown();
        serverResolve();
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
      console.time("recv 1 GB (client)");
      socket.data.received = 0;
    },

    data(socket, data) {
      socket.data.received += data.length;
      // console.error("Received", data.length, "bytes");
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
server.stop(true);
socket.end();

if (received.digest("hex") !== Bun.SHA256.hash(huge, "hex")) {
  throw new Error("Received data doesn't match sent data");
}

process.exit(0);
