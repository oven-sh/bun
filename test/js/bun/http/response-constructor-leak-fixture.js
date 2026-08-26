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

for (var i = 0; i < 1000; i++) {
  try {
    new Response(buf, {
      // This causes the response constructor to throw an error
      statusText: Symbol("leaky-error"),

      status: 200,
      headers: {
        // That means the string needs to be long enough to otherwise show up with a 0-length body.
        ["Content-Type"]:
          "yo de lay  yo de lay  yo de lay  yo de lay  yo de lay  yo de lay  ".repeat(1024) + Math.random(),
      },
    });
  } catch (e) {}
}
Bun.gc(true);
console.log("RSS:", (rss() / 1024 / 1024) | 0, "MB");
if (rss() > 1024 * 1024 * 1024) {
  process.exit(1);
}
