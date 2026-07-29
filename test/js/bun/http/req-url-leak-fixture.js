let existingPromise = null;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    // Route by method so the long-URL GET path (the leak scenario from #16787)
    // stays byte-for-byte the same as before: no req.url access, only the
    // await-a-microtask + rss reply.
    if (req.method === "POST") {
      Bun.gc(true);
      await Bun.sleep(10);
      Bun.gc(true);
      return new Response(process.memoryUsage.rss().toString());
    }
    if (!existingPromise) {
      existingPromise = Bun.sleep(0);
    }
    let waitedUpon = existingPromise;
    await existingPromise;
    if (existingPromise === waitedUpon) {
      existingPromise = null;
    }
    return new Response(process.memoryUsage.rss().toString());
  },
});

console.log("Server started on", server.url.href);

process.send?.({ url: server.url.href });
