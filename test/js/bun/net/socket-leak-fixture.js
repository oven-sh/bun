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

const fd_before = openSync("/dev/null", "w");
closeSync(fd_before);

// start 100 connections
let connected = 0;
for (let i = 0; i < 100; i++) {
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

expect(connected).toBe(100);

const fd = openSync("/dev/null", "w");
closeSync(fd);

// ensure that we don't leak sockets when we initiate multiple connections
expect(fd - fd_before).toBeLessThan(5);

server.stop();
