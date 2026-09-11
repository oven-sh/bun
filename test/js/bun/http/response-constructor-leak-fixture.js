// This test is meant to cause OOM if either:
//
// - the response body leaks
// - the headers leak
//

const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
const buf = new Uint8Array(1024 * 1024 * 32);
// Buffer.alloc(n, fill).toString() instead of "...".repeat(n): repeat() is
// very slow on debug JavaScriptCore builds (see test/CLAUDE.md).
const longContentType = Buffer.alloc(64 * 1024, "yo de lay ").toString();

for (var i = 0; i < 1000; i++) {
  try {
    new Response(buf, {
      // This causes the response constructor to throw an error
      statusText: Symbol("leaky-error"),

      status: 200,
      headers: {
        // That means the string needs to be long enough to otherwise show up with a 0-length body.
        ["Content-Type"]: longContentType + Math.random(),
      },
    });
  } catch (e) {}
}
Bun.gc(true);
console.log("RSS:", (rss() / 1024 / 1024) | 0, "MB");
if (rss() > 1024 * 1024 * 1024) {
  process.exit(1);
}
