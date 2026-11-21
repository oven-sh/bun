// Server fixture for the "idle event loop" tests in serve-http2.test.ts. One unref'd
// Bun.serve({ http2: true }) and nothing else: from the first pull() on, no timer and no handle
// keeps the event loop alive or wakes it, so the process lives only while the loop has work.
// Prints its port as JSON on stdout once it listens, and what the body did as JSON on stdout
// when it exits.
//
//   bun serve-http2-idle-loop-fixture.ts --body <bytes|default|direct|rewriter> --chunks <n> [--probe] [--cross]
import { serve } from "bun";
import { writeSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    body: { type: "string", default: "bytes" },
    chunks: { type: "string", default: "16" },
    // Each pull() logs itself, a nextTick, a microtask and a 0 ms timer.
    probe: { type: "boolean", default: false },
    // Each pull() of the body also writes to the open response of GET /other.
    cross: { type: "boolean", default: false },
  },
});
const chunks = Number(args.chunks);
// 4 chunks fill the 256 KiB that the transport frames before it waits for the socket.
const chunk = new Uint8Array(64 * 1024).fill(97);
const part = new TextEncoder().encode("<b>x</b>" + Buffer.alloc(chunk.length - 8, "a").toString());

// Held until the body starts. It never fires.
const untilTheBodyStarts = setInterval(() => {}, 2 ** 30);
let pulls = 0;
const order: string[] = [];
let other: Bun.DirectStreamController | undefined;

function pulled(controller: ReadableStreamDefaultController | ReadableByteStreamController, data: Uint8Array) {
  if (pulls++ === 0) clearInterval(untilTheBodyStarts);
  if (args.probe) {
    const n = pulls;
    order.push("pull" + n);
    setTimeout(() => order.push("timer" + n), 0);
    process.nextTick(() => order.push("tick" + n));
    queueMicrotask(() => order.push("microtask" + n));
  }
  if (args.cross) other!.write(new Uint8Array(4096));
  // A byte stream takes the buffer of what it is given.
  controller.enqueue(data.slice());
  if (pulls === chunks) controller.close();
}

function body(): BodyInit {
  switch (args.body) {
    case "bytes":
      return new ReadableStream({ type: "bytes", pull: c => pulled(c, chunk) });
    case "default":
      return new ReadableStream({ pull: c => pulled(c, chunk) });
    case "direct":
      return new ReadableStream({
        type: "direct",
        async pull(controller) {
          while (pulls < chunks) {
            if (pulls++ === 0) clearInterval(untilTheBodyStarts);
            await controller.write(chunk);
          }
          controller.close();
        },
      });
    case "rewriter":
      return new HTMLRewriter()
        .on("b", { element: element => void element.setAttribute("n", "1") })
        .transform(new Response(new ReadableStream({ pull: c => pulled(c, part) }))).body!;
  }
  throw new Error("unknown --body " + args.body);
}

const server = serve({
  port: 0,
  hostname: "127.0.0.1",
  http2: true,
  async fetch(req) {
    if (new URL(req.url).pathname === "/other") {
      return new Response(
        new ReadableStream({
          type: "direct",
          pull(controller) {
            other = controller;
            controller.write("open");
            controller.flush();
            return new Promise<void>(() => {});
          },
        }),
      );
    }
    // The body starts in a later turn of the loop, so no write of it is inside the socket event of the request.
    await new Promise(resolve => setImmediate(resolve));
    return new Response(body());
  },
});
server.unref();

process.on("exit", () => writeSync(1, JSON.stringify({ pulls, order }) + "\n"));
console.log(JSON.stringify({ port: server.port }));
