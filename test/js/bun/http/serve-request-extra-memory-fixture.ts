const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

const server = Bun.serve({
  port: 0,
  fetch(req) {
    if (req.url.endsWith("/report")) {
      return Response.json({
        external: process.memoryUsage().external,
        rss: rss(),
      });
    }
    return new Response("Hello, World!");
  },
});

process.send!({ url: server.url.href });
