const rss = process.memoryUsage.rss;
let existingPromise = null;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    // Routed by method so the GET handler never touches req.url.
    if (req.method === "POST") {
      Bun.gc(true);
      Bun.shrink();
      await new Promise(resolve => setImmediate(resolve));
      return new Response(rss().toString());
    }
    if (!existingPromise) {
      existingPromise = Bun.sleep(0);
    }
    let waitedUpon = existingPromise;
    await existingPromise;
    if (existingPromise === waitedUpon) {
      existingPromise = null;
    }
    return new Response("ok");
  },
});

process.send?.({ url: server.url.href });
