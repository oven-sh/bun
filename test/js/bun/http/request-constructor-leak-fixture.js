// This test is meant to cause OOM if either:
//
// - the request body leaks
// - the headers leak
// - the url leaks
//
const buf = new Uint8Array(1024 * 1024 * 16);

for (var i = 0; i < 1000; i++) {
  try {
    new Request("http://" + "superduperlongurlwowsuchlengthicant".repeat(1024) + ".com/" + i, {
      body: buf,
      signal: Symbol("leaky-error"),
      headers: {
        // That means the string needs to be long enough to otherwise show up with a 0-length body.
        ["Content-Type"]:
          "yo de lay  yo de lay  yo de lay  yo de lay  yo de lay  yo de lay  ".repeat(1024) + Math.random(),
        "Invalid-Header-Name-☺️": "1",
      },
    });
  } catch (e) {}
}
Bun.gc(true);
console.log("RSS:", (process.memoryUsage().rss / 1024 / 1024) | 0, "MB");
if (process.memoryUsage.rss() > 1024 * 1024 * 1024) {
  process.exit(1);
}
