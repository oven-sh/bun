import fs from "fs";
import os from "os";

let resolve;
const promise = new Promise(r => (resolve = r));

const unix = os.tmpdir() + "/bun-connect-unix-socket-test.socket";

const server = Bun.listen({
  unix,
  socket: {
    open(socket) {
      console.log("SERVER OPENED");
    },
    data(socket, buffer) {
      socket.write(buffer);
    },
    error(socket, err) {
      console.log("SERVER ERRED", err);
    },
  },
});

const client = await Bun.connect({
  unix,
  socket: {
    open(socket) {
      console.log("CLIENT OPENED");
      socket.write("Hello, world!");
    },
    data(socket, buffer) {
      console.log("CLIENT RECEIVED", buffer.toString());
      if (buffer.toString().includes("From returned socket")) {
        resolve();
      }
    },
  },
});

console.log(client.localPort);
client.write("From returned socket");

setTimeout(() => {
  console.error("Test Failed");
  process.exit(1);
}, 1000);

await promise;

client.end();
server.stop();

process.exit(0);
