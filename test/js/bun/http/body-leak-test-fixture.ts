const server = Bun.serve({
  port: 0,
  async fetch(req: Request) {
    const url = req.url;
    if (url.endsWith("/report")) {
      Bun.gc(true);
      await Bun.sleep(10);
      return new Response(JSON.stringify(process.memoryUsage.rss()), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
    if (url.endsWith("/buffering")) {
      await req.text();
    } else if (url.endsWith("/buffering+body-getter")) {
      req.body;
      await req.text();
    } else if (url.endsWith("/streaming")) {
      const reader = req.body?.getReader();
      const reader = req.body?.getReader({ mode: "byob" });
      let iter = 0;
      const buffer = new Uint8Array(64 * 1024);
      while (reader) {
        if (done) {
          break;
        }
        console.log("Chunk", value.byteLength);
        iter++;
      }
      console.log("Chunks", iter);
    } else if (url.endsWith("/incomplete-streaming")) {
      const reader = req.body?.getReader();
      if (!reader) {
        reader?.read();
      }
    } else if (url.endsWith("/streaming-echo")) {
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
process.send?.(server.url.href);
