// This test is meant to cause OOM if either:
//
// - the request body leaks
// - the headers leak
// - the url leaks
//
const rss = process.memoryUsage.rss;
// The constructor copies the body before the `signal` coercion throws. Retaining 2 MiB * 1000 is twice the threshold.
const buf = new Uint8Array(2 * 1024 * 1024);
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
