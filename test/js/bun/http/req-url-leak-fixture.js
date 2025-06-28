let existingPromise = null;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
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

setInterval(() => {
  console.log("RSS", (process.memoryUsage.rss() / 1024 / 1024) | 0);
}, 1000);
console.log("Server started on", server.url.href);

if (process.channel) {
  process.send({
    url: server.url.href,
  });
}
