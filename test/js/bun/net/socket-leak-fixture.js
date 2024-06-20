import { openSync, closeSync } from "node:fs";
import { expect } from "bun:test";

const server = Bun.listen({
  port: 0,
  hostname: "localhost",
  socket: {
    open(socket) {
      socket.end();
    },
    data(socket, data) {},
  },
});

let connected = 0;
async function callback() {
  await Bun.connect({
    port: server.port,
    hostname: "localhost",
    socket: {
      open(socket) {
        connected += 1;
      },
      data(socket, data) {},
    },
  });
}

const fd_before = openSync("/dev/null", "w");
closeSync(fd_before);

// start 100 connections
const connections = await Promise.all(new Array(100).fill(0).map(callback));

expect(connected).toBe(100);

const fd = openSync("/dev/null", "w");
closeSync(fd);

// ensure that we don't leak sockets when we initiate multiple connections
expect(fd - fd_before).toBeLessThan(5);

server.stop();
