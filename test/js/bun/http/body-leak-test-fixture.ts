import { rss, tls } from "harness";

// RSS only drops once the allocators hand freed pages back to the OS. Bun.gc(true) sweeps
// the JS heap but leaves that to background scavengers that run tens to hundreds of ms
// later, so a sample taken right after it still counts the previous batch's garbage.
// Bun.shrink() queues a full GC plus a synchronous scavenge for the moment the VM goes
// idle; yielding to the event loop runs it. Repeat until the reading stops falling.
// Bun.shrink() also deletes all compiled code, so this belongs in a measurement fixture
// like this one and not in the test runner's own VM.
async function settledMemoryUsage(): Promise<number> {
  let previous = Infinity;
  for (let attempt = 0; attempt < 10; attempt++) {
    Bun.gc(true);
    Bun.shrink();
    await new Promise(resolve => setImmediate(resolve));
    const current = rss();
    if (current > previous - 1024 * 1024) {
      return Math.min(current, previous);
    }
    previous = current;
  }
  return previous;
}

// Positive control for the test's leak detection: /retain keeps every body alive.
const retainedBodies: Uint8Array[] = [];

const http2 = process.argv.includes("--http2");
const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  ...(http2 ? { tls, http2: true } : {}),
  async fetch(req: Request) {
    const url = req.url;
    if (url.endsWith("/report")) {
      return Response.json(await settledMemoryUsage());
    } else if (url.endsWith("/heap-snapshot")) {
      await settledMemoryUsage();
      require("v8").writeHeapSnapshot("/tmp/heap.heapsnapshot");
      console.log("Wrote heap snapshot to /tmp/heap.heapsnapshot");
      return Response.json(await settledMemoryUsage());
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

// Run directly (no IPC channel) to watch the server while driving it by hand.
if (!process.send) {
  setInterval(async () => {
    const rssMB = ((await settledMemoryUsage()) / 1024 / 1024) | 0;
    console.log("RSS", rssMB, "MB");
    console.log("Active requests", server.pendingRequests);

    if (rssMB > 1024) {
      require("v8").writeHeapSnapshot("/tmp/heap.heapsnapshot");
    }
  }, 5000);
}
