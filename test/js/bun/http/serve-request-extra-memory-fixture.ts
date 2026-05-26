// Fixture for serve-request-extra-memory.test.ts: a hello-world Bun.serve
// whose /report endpoint returns this process's GC extra-memory accounting
// (process.memoryUsage().external) so the parent test can verify that serving
// requests reports the per-request native context memory to the GC.
const server = Bun.serve({
  port: 0,
  fetch(req) {
    if (req.url.endsWith("/report")) {
      return Response.json({
        external: process.memoryUsage().external,
        rss: process.memoryUsage.rss(),
      });
    }
    return new Response("Hello, World!");
  },
});

process.send!({ url: server.url.href });
