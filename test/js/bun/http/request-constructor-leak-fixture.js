// This test is meant to cause OOM if either:
//
// - the request body leaks
// - the headers leak
// - the url leaks
//
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
// 1 MiB body. The Request constructor copies the body before the throwing
// `signal` coercion runs, and under ASAN that copy is O(size). 1 MiB * 1000
// still produces ~1 GiB of leak if the body is retained, which clears the
// threshold below while keeping the loop under ~2s on debug-ASAN.
const buf = new Uint8Array(1024 * 1024);
// Buffer.alloc(n, fill).toString() instead of "...".repeat(n): repeat() is
// very slow on debug JavaScriptCore builds (see test/CLAUDE.md).
const longHost = Buffer.alloc(35 * 1024, "superduperlongurlwowsuchlengthicant").toString();
const longContentType = Buffer.alloc(64 * 1024, "yo de lay ").toString();

for (var i = 0; i < 1000; i++) {
  try {
    new Request("http://" + longHost + ".com/" + i, {
      body: buf,
      signal: Symbol("leaky-error"),
      headers: {
        // That means the string needs to be long enough to otherwise show up with a 0-length body.
        ["Content-Type"]: longContentType + Math.random(),
        "Invalid-Header-Name-☺️": "1",
      },
    });
  } catch (e) {}
}
Bun.gc(true);
console.log("RSS:", (rss() / 1024 / 1024) | 0, "MB");
if (rss() > 1024 * 1024 * 1024) {
  process.exit(1);
}
