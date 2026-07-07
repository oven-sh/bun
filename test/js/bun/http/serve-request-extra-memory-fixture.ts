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
