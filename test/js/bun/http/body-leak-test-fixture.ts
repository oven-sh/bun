const server = Bun.serve({
  port: 0,
  async fetch(req: Request) {
    if (req.url.endsWith("/report")) {
      Bun.gc(true);
      return new Response(JSON.stringify(process.memoryUsage.rss()), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
    if (req.url.endsWith("/buffering")) {
      await req.text();
    } else if (req.url.endsWith("/streaming")) {
      const reader = req.body?.getReader();
      while (reader) {
        const { done, value } = await reader?.read();
        if (done) {
          break;
        }
      }
    } else if (req.url.endsWith("/incomplete-streaming")) {
      const reader = req.body?.getReader();
      // we will receve ABORT_ERR here so we just catch it and ignores it
      reader?.read().catch(() => {});
    }
    return new Response("Ok");
  },
});
console.log(server.url.href);
