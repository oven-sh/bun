// This test is meant to cause large RSS growth if server.fetch("<string url>")
// leaks the intermediate URL buffer it heap-allocates before cloning into a
// bun.String. Both code paths are exercised:
//   - absolute URL with a hostname (dupe branch)
//   - relative path with no hostname (append-to-base-url branch)
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
// Detect ASAN from the runtime, not the binary name. A local `bun bd` debug
// build is ASAN-instrumented but named `bun-debug`, so the name check alone
// picks the wrong branch and trips the non-ASAN threshold.
let isASAN;
try {
  isASAN = require("bun:internal-for-testing").isASANEnabled();
} catch {
  isASAN = process.execPath.includes("bun-asan");
}
using server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("ok");
  },
});

const longPath = "/" + Buffer.alloc(64 * 1024, "p").toString();
const absolute = `http://${server.hostname}:${server.port}${longPath}`;

// Warm up so RSS baseline stabilizes before we measure.
for (let i = 0; i < 64; i++) {
  await server.fetch(absolute);
  await server.fetch(longPath);
}
Bun.gc(true);
const before = rss();

// Under ASAN the quarantine (default 256 MB) retains freed URL buffers, so the
// no-leak baseline alone is a few hundred MB. Run enough iterations so the
// leak signature (~72 KB/call, never freed → never quarantined) clears the
// quarantine ceiling.
const iterations = isASAN ? 4096 : 2048;
for (let i = 0; i < iterations; i++) {
  await server.fetch(absolute);
  await server.fetch(longPath);
}
Bun.gc(true);
const after = rss();

const deltaMB = (after - before) / 1024 / 1024;
console.log("RSS delta:", deltaMB.toFixed(1), "MB");

// 2048 iterations * 2 calls * ~64 KiB = ~256 MiB leaked when broken.
// With the fix, growth is a few MiB of allocator jitter at most.
// ASAN: ~649 MB leaked (measured with the Cow->Box::leak regression
// reintroduced) vs ~325 MB quarantine no-leak baseline.
if (deltaMB > (isASAN ? 450 : 64)) {
  console.error("server.fetch(string) leaked URL buffers");
  process.exit(1);
}
