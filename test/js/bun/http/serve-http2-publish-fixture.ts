// Server fixture for the "writes outside a socket event" tests in serve-http2.test.ts. One unref'd
// Bun.serve({ http2: true }) and nothing else: once GET /publish has written, no timer and no handle
// keeps the event loop alive or wakes it, so the process lives only while the loop has work.
// Prints its port as JSON on stdout once it listens.
//
//   GET /events   an open response, which gets "open" at once
//   GET /publish  writes "event" to each open response of GET /events, and never answers
//
// With --rounds <n> the server keeps the loop alive. Each publish arms a timer of 100 ms, and the
// next request clears it. The request after the last round prints how many of those timers fired,
// as JSON on stdout, and ends the process.
import { serve } from "bun";
import { writeSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: { rounds: { type: "string" } } });

// Held until the publish. It never fires.
const untilThePublish = setInterval(() => {}, 2 ** 30);
const subscribers: ReadableStreamDefaultController[] = [];
let timer: Timer | undefined;
let timers = 0;
let publishes = 0;

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
    clearTimeout(timer);
    // The writes happen in a later turn of the loop, so none of them is inside the socket event of this request.
    await new Promise(resolve => setImmediate(resolve));
    if (args.rounds && publishes++ === Number(args.rounds)) {
      writeSync(1, JSON.stringify({ timers }) + "\n");
      process.exit(0);
    }
    clearInterval(untilThePublish);
    // One write to each open response, and no response whose flush would take them along.
    for (const subscriber of subscribers) subscriber.enqueue("event");
    if (args.rounds) timer = setTimeout(() => timers++, 100);
    return new Promise<Response>(() => {});
  },
});
if (!args.rounds) server.unref();

// A clean exit flushes, which would send what the loop left behind.
process.on("beforeExit", () => process.kill(process.pid, "SIGKILL"));
console.log(JSON.stringify({ port: server.port }));
