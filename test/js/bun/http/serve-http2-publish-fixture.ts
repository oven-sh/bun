// Server fixture for the "writes outside a socket event" tests in serve-http2.test.ts. One unref'd
// Bun.serve({ http2: true }) and nothing else: once GET /publish has written, no timer and no handle
// keeps the event loop alive or wakes it, so the process lives only while the loop has work.
// With --ref the server keeps the loop alive, and the process runs until it is killed.
// Prints its port as JSON on stdout once it listens.
//
//   GET /events   an open response, which gets "open" at once
//   GET /publish  writes "event" to each open response of GET /events, and never answers
import { serve } from "bun";

// Held until the publish. It never fires.
const untilThePublish = setInterval(() => {}, 2 ** 30);
const subscribers: ReadableStreamDefaultController[] = [];

const server = serve({
  port: 0,
  hostname: "127.0.0.1",
  http2: true,
  async fetch(req) {
    if (new URL(req.url).pathname === "/events") {
      return new Response(
        new ReadableStream({
          start(controller) {
            subscribers.push(controller);
            controller.enqueue("open");
          },
        }),
      );
    }
    // The writes happen in a later turn of the loop, so none of them is inside the socket event of this request.
    await new Promise(resolve => setImmediate(resolve));
    clearInterval(untilThePublish);
    // One write to each open response, and no response whose flush would take them along.
    for (const subscriber of subscribers) subscriber.enqueue("event");
    return new Promise<Response>(() => {});
  },
});
if (!process.argv.includes("--ref")) server.unref();

// A clean exit flushes, which would send what the loop left behind.
process.on("beforeExit", () => process.kill(process.pid, "SIGKILL"));
console.log(JSON.stringify({ port: server.port }));
