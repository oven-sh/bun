// Regression test for #22913: every successful net.connect({ path }) retained a
// ref on the native socket, so RSS grew per connection. The test opens many
// short-lived IPC (unix-socket / named-pipe) connections and asserts RSS is flat
// between a warmup sample and a post sample.
import { expect } from "bun:test";
import { isASAN, isMusl, isWindows } from "harness";
import { rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Per-process path so a stale socket from an earlier killed run (or a concurrent
// test process) can't EADDRINUSE this one.
const listen_path = join(tmpdir(), `test-net-handle-leak-${process.pid}.sock`);
rmSync(listen_path, { force: true });

const { promise: listening, resolve, reject } = Promise.withResolvers<void>();
const server = net
  .createServer()
  .listen(listen_path)
  .on("listening", () => resolve())
  .on("error", reject);
await listening;

// Counts and margins are calibrated against bun v1.2.22 (the last release with
// the #22913 bug): at 60k measured connections it produces ~21-31 MB of growth
// on linux and ~28-35 MB on Windows, while a fixed build stays at or below
// ~0 MB (linux) / ~8 MB (Windows) after a 30k warmup settles RSS. ASAN is ~90x
// slower per connection and its 256 MB margin (quarantine-sized) makes it a
// sanity check rather than a fine-grained detector, so it runs a sixth as many.
const warmup_total = isASAN ? 5_000 : 30_000;
const measured_total = isASAN ? 10_000 : 60_000;

async function run(total: number) {
  let done = 0;
  while (done < total) {
    const batch = Math.min(100, total - done);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < batch; i++) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const socket = net
        .connect({ path: listen_path })
        .on("connect", () => {
          socket.on("close", () => resolve());
          socket.end();
        })
        .on("error", reject);
      promises.push(promise);
      done++;
    }
    await Promise.all(promises);
    if (done % 10_000 === 0) {
      console.log(`Completed ${done} connections. RSS: ${(process.memoryUsage.rss() / 1024 / 1024) | 0} MB`);
    }
  }
}

let warmup_rss: number, post_rss: number;
try {
  expect(server.address()).toBe(listen_path);

  await run(warmup_total);
  Bun.gc(true);
  warmup_rss = process.memoryUsage.rss();

  await run(measured_total);
  // Mirror the warmup sample: collect before measuring so the comparison isn't
  // inflated by transient garbage from the last batch. A native handle leak
  // survives GC, so this keeps catching what the test is for.
  Bun.gc(true);
  post_rss = process.memoryUsage.rss();
} finally {
  server.close();
  rmSync(listen_path, { force: true });
}

const delta = post_rss - warmup_rss;
console.log(
  `RSS delta over ${measured_total} connections: ${(delta / 1024 / 1024).toFixed(1)} MB ` +
    `(warmup ${(warmup_rss / 1024 / 1024) | 0} MB -> ${(post_rss / 1024 / 1024) | 0} MB)`,
);

// glibc linux and Windows are the calibrated detectors: bytes/conn sensitivity
// at these margins matches the previous 100k-connection version (~270 bytes/conn
// linux, ~330 bytes/conn Windows) and both were verified to fail against v1.2.22.
let margin = 1024 * 1024 * 16;
if (isWindows) margin = 1024 * 1024 * 20;
// musl mallocng retains freed pages longer than glibc on this workload (alpine
// CI observed ~17 MB at 60k with no leak); widen to clear that retention. Like
// the ASAN lane below this is a secondary check: the calibrated glibc/Windows
// lanes are what guarantee #22913 is caught.
if (isMusl) margin = 1024 * 1024 * 24;
// Under ASAN we use the system allocator so the interceptor sees every
// allocation. The ASAN free-quarantine (default 256 MB) plus glibc malloc
// retaining freed pages causes RSS to grow well past the native margin above
// even with no real leak; allow up to the default quarantine size.
if (isASAN) margin = 1024 * 1024 * 256;
expect(delta).toBeLessThan(margin);
