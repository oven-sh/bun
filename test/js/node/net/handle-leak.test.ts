// Regression test for #22913: every successful net.connect({ path }) retained a
// ref on the native socket, so RSS grew per connection. The test opens many
// short-lived IPC (unix-socket / named-pipe) connections and asserts RSS is flat
// between a warmup sample and a post sample.
import { expect } from "bun:test";
import { isASAN, isWindows } from "harness";
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
expect(server.address()).toBe(listen_path);

// A per-connection handle leak (#22913) retains >= ~1.5 KB/conn (JS Socket alone,
// measured), so 40k measured connections produces >= 60 MB of growth and is caught
// by the 24/40 MB margins below with ~1.5-2x headroom. ASAN is ~90x slower per
// connection and its 256 MB margin (quarantine-sized) makes it a sanity check
// rather than a fine-grained detector, so it runs a quarter as many.
const warmup_total = isASAN ? 5_000 : 20_000;
const measured_total = isASAN ? 10_000 : 40_000;

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

await run(warmup_total);
Bun.gc(true);
const warmup_rss = process.memoryUsage.rss();

await run(measured_total);
// Mirror the warmup sample: collect before measuring so the comparison isn't
// inflated by transient garbage from the last batch. A native handle leak
// survives GC, so this keeps catching what the test is for.
Bun.gc(true);
const post_rss = process.memoryUsage.rss();

server.close();
rmSync(listen_path, { force: true });

const delta = post_rss - warmup_rss;
console.log(
  `RSS delta over ${measured_total} connections: ${(delta / 1024 / 1024).toFixed(1)} MB ` +
    `(warmup ${(warmup_rss / 1024 / 1024) | 0} MB -> ${(post_rss / 1024 / 1024) | 0} MB)`,
);

// Per-Socket fields added for onread/tls bookkeeping raise steady-state RSS a
// few MB across the measured run; a real per-connection leak produces >= 60 MB
// at 40k connections (verified by retaining the JS Socket on each iteration).
let margin = 1024 * 1024 * 24;
if (isWindows) margin = 1024 * 1024 * 40;
// Under ASAN we use the system allocator so the interceptor sees every
// allocation. The ASAN free-quarantine (default 256 MB) plus glibc malloc
// retaining freed pages causes RSS to grow well past the native margin above
// even with no real leak. Observed ~30-45 MB on linux x64-asan at 10k measured;
// allow up to the default quarantine size.
if (isASAN) margin = 1024 * 1024 * 256;
expect(delta).toBeLessThan(margin);
