import { expect } from "bun:test";
import { isASAN, isDebug, isWindows } from "harness";
import { rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

// Unique per-process path so a stale socket left by an earlier killed run can't EADDRINUSE us.
const listen_path = join(tmpdir(), `test-net-successful-connection-handle-leak-${process.pid}.sock`);
rmSync(listen_path, { force: true });

const { promise, resolve, reject } = Promise.withResolvers();
const server = net
  .createServer()
  .listen(listen_path)
  .on("listening", () => resolve())
  .on("error", e => reject(e));
await promise;
const address = server.address();
console.log("server address", address);

let started;

started = 0;
while (started < 50_000) {
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
  console.log(`Completed ${started} connections. RSS: ${(process.memoryUsage.rss() / 1024 / 1024) | 0} MB`);
}

Bun.gc(true);
const warmup_rss = process.memoryUsage.rss();

started = 0;
while (started < 100_000) {
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
  console.log(`Completed ${started} connections. RSS: ${(process.memoryUsage.rss() / 1024 / 1024) | 0} MB`);
}

// Symmetric with `warmup_rss` (which is post-GC): collect before sampling so the
// comparison isn't inflated by transient garbage. A native/non-JS handle leak
// still survives GC, so this keeps catching what the test is meant to catch.
Bun.gc(true);
const post_rss = process.memoryUsage.rss();

server.close();

let margin = 1024 * 1024 * 15;
if (isWindows) margin = 1024 * 1024 * 40;
if (isASAN) margin = 1024 * 1024 * 60;
// Debug builds legitimately retain more between checkpoints: unoptimized
// allocation churn, debug-allocator metadata, and lazier/less-aggressive GC.
// Same rationale as the Windows/ASAN carve-outs above.
if (isDebug) margin = 1024 * 1024 * 64;
expect(post_rss - warmup_rss).toBeLessThan(margin);
