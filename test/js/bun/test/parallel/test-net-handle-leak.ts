import * as net from "node:net";
import { setTimeout } from "node:timers/promises";
import { expect } from "bun:test";

const { promise, resolve } = Promise.withResolvers();
const server = net
  .createServer()
  .listen("/tmp/test-net-successful-connection-handle-leak.sock")
  .on("listening", () => resolve());
await promise;
const address = server.address();
console.log("server address", address);

let started;

started = 0;
while (started < 50_000) {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = net
      .connect({
        path: String.fromCharCode("/".charCodeAt(0)) + "tmp/test-net-successful-connection-handle-leak.sock".slice(),
      })
      .on("connect", () => {
        socket.on("close", () => resolve());

        socket.end();
      })
      .on("error", e => {
        reject(e);
      });

    promises.push(promise);
    started++;
  }
  await Promise.all(promises);
  await setTimeout(1);
  console.log(`Completed ${started} connections. RSS: ${(process.memoryUsage.rss() / 1024 / 1024) | 0} MB`);
}

Bun.gc(true);
const warmup_rss = process.memoryUsage.rss();

started = 0;
while (started < 100_000) {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = net
      .connect({
        path: String.fromCharCode("/".charCodeAt(0)) + "tmp/test-net-successful-connection-handle-leak.sock".slice(),
      })
      .on("connect", () => {
        socket.on("close", () => resolve());

        socket.end();
      })
      .on("error", e => {
        reject(e);
      });

    promises.push(promise);
    started++;
  }
  await Promise.all(promises);
  await setTimeout(1);
  console.log(`Completed ${started} connections. RSS: ${(process.memoryUsage.rss() / 1024 / 1024) | 0} MB`);
}

const post_rss = process.memoryUsage.rss();

server.close();

expect(post_rss - warmup_rss).toBeLessThan(1024 * 1024 * 15);
