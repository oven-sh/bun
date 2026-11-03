import { expect } from "bun:test";
import { isASAN, isWindows, rss } from "harness";
import { rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use a per-process path so a stale socket from a killed run can't fail the listen with EADDRINUSE.
const listen_path = join(tmpdir(), `test-net-successful-connection-handle-leak-${process.pid}.sock`);

const { promise: listening, resolve, reject } = Promise.withResolvers<void>();
const server = net
  .createServer()
  .listen(listen_path)
  .on("listening", () => resolve())
  .on("error", reject);
await listening;
const address = server.address();
console.log("server address", address);

// ASAN is ~8x slower per connection and its RSS margin (256 MB, below) is far
// wider per connection than the native 15 MB one, so a smaller count still has
// plenty of sensitivity there while keeping full 150k coverage on other lanes.
const warmup_total = isASAN ? 10_000 : 50_000;
const measured_total = isASAN ? 20_000 : 100_000;

async function run(total: number) {
  let started = 0;
  while (started < total) {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const socket = net
        .connect({ path: listen_path })
        .on("connect", () => {
          socket.on("close", () => resolve());
          socket.end();
        })
        .on("error", reject);

      promises.push(promise);
      started++;
    }
    await Promise.all(promises);
    if (started % 10_000 === 0) {
      console.log(`Completed ${started} connections. RSS: ${(rss() / 1024 / 1024) | 0} MB`);
    }
  }
}

let warmup_rss: number, post_rss: number;
try {
  await run(warmup_total);
  Bun.gc(true);
  warmup_rss = rss();

  await run(measured_total);
  // Mirror the warmup sample: collect before measuring so the assertion compares
  // like-for-like and isn't sensitive to garbage still in flight from the last batch.
  Bun.gc(true);
  post_rss = rss();
} finally {
  server.close();
  rmSync(listen_path, { force: true });
}

// Per-Socket fields added for onread/tls bookkeeping raise steady-state RSS a
// few MB across ~30k iterations; a real per-connection leak would blow past 24.
let margin = 1024 * 1024 * 24;
if (isWindows) margin = 1024 * 1024 * 40;
// Under ASAN we use the system allocator so the interceptor sees every
// allocation. The ASAN free-quarantine (default 256 MB) plus glibc malloc
// retaining freed pages causes RSS to grow well past the native margin above
// even with no real leak. Observed ~130 MB on linux x64-asan; allow up to the
// default quarantine size.
if (isASAN) margin = 1024 * 1024 * 256;
expect(post_rss - warmup_rss).toBeLessThan(margin);
