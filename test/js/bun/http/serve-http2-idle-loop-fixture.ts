// Server fixture for the "idle event loop" tests in serve-http2.test.ts. One unref'd
// Bun.serve({ http2: true }) and nothing else: from the first pull() on, no timer and no handle
// keeps the event loop alive or wakes it, so the process lives only while the loop has work.
// Prints its port as JSON on stdout once it listens, and what the body did as JSON on stdout
// when it exits.
//
//   bun serve-http2-idle-loop-fixture.ts --body <bytes|default|direct|rewriter|rejects|publish> --chunks <n> [--probe] [--cross] [--reject-at <n>] [--start <immediate|task>] [--rounds <n>] [--redis <port>]
import { RedisClient, serve } from "bun";
import { once } from "node:events";
import { writeSync } from "node:fs";
import { stat } from "node:fs/promises";
import http2 from "node:http2";
import { Duplex } from "node:stream";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    body: { type: "string", default: "bytes" },
    chunks: { type: "string", default: "16" },
    // Each pull() logs itself, a nextTick, a microtask and a 0 ms timer.
    probe: { type: "boolean", default: false },
    // Each pull() of the body also writes to the open response of GET /other.
    cross: { type: "boolean", default: false },
    // The pull() of `--body rejects` that fails.
    "reject-at": { type: "string", default: "0" },
    // What the handler awaits before the body: "immediate", or "task" for a job of the thread pool.
    start: { type: "string", default: "immediate" },
    // For `--body publish`: the server keeps the loop alive for this many requests, and logs each timer that fires before the next one.
    rounds: { type: "string" },
    // A server that answers HELLO and nothing else. `--body publish` closes its client while the deferred queue runs.
    redis: { type: "string" },
  },
});
const chunks = Number(args.chunks);
const rejectAt = Number(args["reject-at"]);
// 4 chunks fill the 256 KiB that the transport frames before it waits for the socket.
const chunk = new Uint8Array(64 * 1024).fill(97);
const part = new TextEncoder().encode("<b>x</b>" + Buffer.alloc(chunk.length - 8, "a").toString());

// Held until the body starts. It never fires.
const untilTheBodyStarts = setInterval(() => {}, 2 ** 30);
let pulls = 0;
const order: string[] = [];
let other: Bun.DirectStreamController | undefined;
const subscribers: ReadableStreamDefaultController[] = [];

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
    case "rejects": {
      // The promise that pull() returns is rejected already. The stream hears of it one microtask later.
      const produce = async (controller: ReadableByteStreamController) => {
        if (pulls + 1 === rejectAt) throw new Error("pull " + ++pulls + " failed");
        pulled(controller, chunk);
      };
      return new ReadableStream({
        type: "bytes",
        async pull(controller) {
          return produce(controller);
        },
      });
    }
    case "rewriter":
      return new HTMLRewriter()
        .on("b", { element: element => void element.setAttribute("n", "1") })
        .transform(new Response(new ReadableStream({ pull: c => pulled(c, part) }))).body!;
  }
  throw new Error("unknown --body " + args.body);
}

let beforePublish = () => {};
if (args.redis) {
  const redis = new RedisClient("redis://127.0.0.1:" + args.redis);
  await redis.connect();
  let onWrite = () => {};
  const transport = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      onWrite();
      callback();
    },
  });
  const session = http2.connect("http://localhost", { createConnection: () => transport });
  await once(session, "connect");
  beforePublish = () => {
    // WATCH waits for the reply to GET, so the client keeps its place in the queue.
    redis.get("a").catch(() => {});
    redis.send("WATCH", ["a"]).catch(() => {});
    // The session flushes second, through script.
    onWrite = () => {
      order.push("close");
      redis.close();
    };
    session.ping(() => {});
    order.push("ping");
  };
}
let timer: Timer | undefined;
let requests = 0;

const server = serve({
  port: 0,
  hostname: "127.0.0.1",
  http2: true,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/events") {
      return new Response(
        new ReadableStream({
          start(controller) {
            subscribers.push(controller);
            controller.enqueue("open");
          },
        }),
      );
    }
    if (pathname === "/other") {
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
    clearTimeout(timer);
    // The body starts in a later turn of the loop, so no write of it is inside the socket event of the request.
    if (args.start === "task") await stat(".");
    else await new Promise(resolve => setImmediate(resolve));
    if (args.body === "publish") {
      if (requests++ === Number(args.rounds)) process.exit(0);
      // One write to each open response of GET /events, and no response whose flush would take them along.
      clearInterval(untilTheBodyStarts);
      beforePublish();
      for (const subscriber of subscribers) subscriber.enqueue("event");
      if (args.rounds) timer = setTimeout(() => order.push("timer"), 100);
      return new Promise<Response>(() => {});
    }
    return new Response(body());
  },
});
if (!args.rounds) server.unref();

const report = () => writeSync(1, JSON.stringify({ pulls, order }) + "\n");
process.on("exit", report);
if (args.body === "publish") {
  // A clean exit flushes, which would send what the loop left behind.
  process.on("beforeExit", () => {
    report();
    process.kill(process.pid, "SIGKILL");
  });
}
console.log(JSON.stringify({ port: server.port }));
