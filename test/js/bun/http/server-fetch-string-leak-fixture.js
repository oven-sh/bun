// This test is meant to cause large RSS growth if server.fetch("<string url>")
// leaks the intermediate URL buffer it heap-allocates before cloning into a
// bun.String. Both code paths are exercised:
//   - absolute URL with a hostname (dupe branch)
//   - relative path with no hostname (append-to-base-url branch)
using server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("ok");
  },
});

const longPath = "/" + Buffer.alloc(32 * 1024, "p").toString();
const absolute = `http://${server.hostname}:${server.port}${longPath}`;

// Warm up so RSS baseline stabilizes before we measure.
for (let i = 0; i < 64; i++) {
  await server.fetch(absolute);
  await server.fetch(longPath);
}
Bun.gc(true);
const before = process.memoryUsage.rss();

for (let i = 0; i < 4096; i++) {
  await server.fetch(absolute);
  await server.fetch(longPath);
}
Bun.gc(true);
const after = process.memoryUsage.rss();

const deltaMB = (after - before) / 1024 / 1024;
console.log("RSS delta:", deltaMB.toFixed(1), "MB");

// 4096 iterations * 2 calls * ~32 KiB = ~256 MiB leaked when broken.
// With the fix, growth is a few MiB of allocator jitter at most.
if (deltaMB > 64) {
  console.error("server.fetch(string) leaked URL buffers");
  process.exit(1);
}
