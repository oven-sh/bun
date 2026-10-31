import { rss, tls } from "harness";

// Bun.gc(true) leaves returning freed pages to the OS to background scavengers, which run up to
// hundreds of ms later. Bun.shrink() scavenges synchronously as soon as the VM goes idle.
async function memoryUsage(): Promise<number> {
  Bun.gc(true);
  Bun.shrink();
  await new Promise(resolve => setImmediate(resolve));
  return rss();
}

// Positive control for the test's leak detection.
const retainedBodies: Uint8Array[] = [];

const http2 = process.argv.includes("--http2");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  ...(http2 ? { tls, http2: true } : {}),
  async fetch(req: Request) {
    const url = req.url;
    if (url.endsWith("/report")) {
      return Response.json(await memoryUsage());
    } else if (url.endsWith("/heap-snapshot")) {
      await memoryUsage();
      require("v8").writeHeapSnapshot("/tmp/heap.heapsnapshot");
      console.log("Wrote heap snapshot to /tmp/heap.heapsnapshot");
      return Response.json(await memoryUsage());
    }
    if (url.endsWith("/json-buffering")) {
      await req.json();
    } else if (url.endsWith("/buffering")) {
      await req.text();
    } else if (url.endsWith("/buffering+body-getter")) {
      req.body;
      await req.text();
    } else if (url.endsWith("/streaming")) {
      const reader = req.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) {
          break;
        }
      }
    } else if (url.endsWith("/incomplete-streaming")) {
      await req.body!.getReader().read();
    } else if (url.endsWith("/streaming-echo")) {
      return new Response(req.body, {
        headers: {
          "Content-Type": "application/octet-stream",
        },
      });
    } else if (url.endsWith("/retain")) {
      retainedBodies.push(await req.bytes());
    }
    return new Response("Ok");
  },
});
console.log(server.url.href);
process.send?.(server.url.href);

if (!process.send) {
  setInterval(async () => {
    const rssMB = ((await memoryUsage()) / 1024 / 1024) | 0;
    console.log("RSS", rssMB, "MB");
    console.log("Active requests", server.pendingRequests);

    if (rssMB > 1024) {
      require("v8").writeHeapSnapshot("/tmp/heap.heapsnapshot");
    }
  }, 5000);
}
