const server = Bun.serve({
  port: 0,
  async fetch(req: Request) {
    if (req.url.endsWith("/report")) {
      Bun.gc(true);
      await Bun.sleep(10);
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
      if (!reader) {
        reader?.read();
      }
    } else if (req.url.endsWith("/streaming-echo")) {
      return new Response(req.body, {
        headers: {
          "Content-Type": "application/octet-stream",
        },
      });
    }
    return new Response("Ok");
  },
});
console.log(server.url.href);
