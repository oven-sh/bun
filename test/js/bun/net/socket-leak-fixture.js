import { expect } from "bun:test";
import { closeSync, openSync } from "node:fs";

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
  const { promise, resolve } = Promise.withResolvers();
  await Bun.connect({
    port: server.port,
    hostname: server.hostname,
    socket: {
      open(socket) {
        connected += 1;
      },
      data(socket, data) {},
      close() {
        connected -= 1;
        resolve();
      },
    },
  });
  return promise;
}

// warmup
await Promise.all(new Array(10).fill(0).map(callback));

const fd_before = openSync("/dev/null", "w");
closeSync(fd_before);

// start 100 connections
await Promise.all(new Array(100).fill(0).map(callback));

expect(connected).toBe(0);

const fd = openSync("/dev/null", "w");
closeSync(fd);

// ensure that we don't leak sockets when we initiate multiple connections
expect(fd - fd_before).toBeLessThan(5);
server.stop(true);
