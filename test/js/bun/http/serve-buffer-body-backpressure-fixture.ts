// Server fixture for serve-buffer-body-backpressure.test.ts.
// Returns a large shared buffer from the fetch handler and from a static
// route so the test can compare the per-connection memory cost of each path.

const bodyMB = Number(process.argv[2] ?? 16);
const buf = new Uint8Array(bodyMB * 1024 * 1024).fill(65);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  routes: {
    "/static": new Response(buf),
  },
  fetch() {
    return new Response(buf);
  },
});

console.log(JSON.stringify({ port: server.port }));

process.on("message", msg => {
  if (msg === "rss") {
    Bun.gc(true);
    process.send?.({ rss: process.memoryUsage.rss() });
  }
});

setInterval(() => {}, 1 << 30);
