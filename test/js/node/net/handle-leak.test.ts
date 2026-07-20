import { expect } from "bun:test";
import { isASAN, isWindows } from "harness";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const listen_path = join(tmpdir(), "test-net-successful-connection-handle-leak.sock");

const { promise, resolve } = Promise.withResolvers();
const server = net
  .createServer()
  .listen(listen_path)
  .on("listening", () => resolve());
await promise;
const address = server.address();
console.log("server address", address);

// ASAN is ~8x slower per connection and its RSS margin (256 MB, below) is far
// wider per connection than the native 15 MB one, so a smaller count still has
// plenty of sensitivity there while keeping full 150k coverage on other lanes.
const warmup_total = isASAN ? 10_000 : 50_000;
const measured_total = isASAN ? 20_000 : 100_000;

let started;

started = 0;
while (started < warmup_total) {
  const promises: Promise<void>[] = [];
  for (let i = 0; i < 100; i++) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = net
      .connect({ path: listen_path })
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
  if (started % 10_000 === 0) {
    console.log(`Completed ${started} connections. RSS: ${(process.memoryUsage.rss() / 1024 / 1024) | 0} MB`);
  }
}

Bun.gc(true);
const warmup_rss = process.memoryUsage.rss();

started = 0;
while (started < measured_total) {
  const promises: Promise<void>[] = [];
  for (let i = 0; i < 100; i++) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = net
      .connect({ path: listen_path })
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
  if (started % 10_000 === 0) {
    console.log(`Completed ${started} connections. RSS: ${(process.memoryUsage.rss() / 1024 / 1024) | 0} MB`);
  }
}

// Mirror the warmup sample: collect before measuring so the assertion compares
// like-for-like and isn't sensitive to garbage still in flight from the last batch.
Bun.gc(true);
const post_rss = process.memoryUsage.rss();

server.close();

let margin = 1024 * 1024 * 15;
if (isWindows) margin = 1024 * 1024 * 40;
// Under ASAN we use the system allocator so the interceptor sees every
// allocation. The ASAN free-quarantine (default 256 MB) plus glibc malloc
// retaining freed pages causes RSS to grow well past the 15 MB native margin
// even with no real leak. Observed ~130 MB on linux x64-asan; allow up to the
// default quarantine size.
if (isASAN) margin = 1024 * 1024 * 256;
expect(post_rss - warmup_rss).toBeLessThan(margin);
