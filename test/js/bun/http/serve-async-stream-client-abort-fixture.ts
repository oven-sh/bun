// Repro for https://github.com/oven-sh/bun/issues/32111
//
// The fetch handler returns a ReadableStream whose async pull() yields to the
// event loop. When the client aborts mid-pull, the stream sink's tryEnd()
// fails on the dying socket and arms uWS onWritable with the sink as user
// data. uWS kept a single shared userData slot for all per-socket callbacks,
// so the socket-close abort callback then fired with the *sink* pointer
// instead of the RequestContext it was registered with — a type-confused
// read that segfaulted (ASAN: heap-buffer-overflow in onAbort).
//
// The sink ends a body through tryEnd() only while the response head is not
// sent, and a stream that is still parked when the handler's microtasks are
// done has its head sent. So the requests take turns between two bodies:
//   most of them:  pull() waits for a task, then ends. The stream is parked
//                  when the abort arrives, and the sink ends a chunked body
//                  on the dying socket.
//   every tenth:   pull() ends a body that the socket does not take whole,
//                  then waits for a task. The one tryEnd() of that body is
//                  parked on the drain when the abort arrives.

const large = new Uint8Array(8 * 1024 * 1024);
let requests = 0;

const server = Bun.serve({
  port: 0,
  fetch() {
    if (++requests % 10 === 0) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller: any) {
            // Above the payload, so write() only buffers and end() sends it all.
            controller.start({ highWaterMark: large.length + 1 });
            controller.write(large);
            controller.end();
            await Bun.sleep(0);
          },
        } as any),
      );
    }
    return new Response(
      new ReadableStream({
        async pull(controller) {
          // The await is load-bearing: it parks the stream so the abort can
          // interleave between stream completion and teardown.
          await Bun.sleep(0);
          controller.enqueue(new Uint8Array(8));
          controller.close();
        },
      }),
    );
  },
});

let completed = 0;
let aborted = 0;

async function worker(iterations: number) {
  for (let i = 0; i < iterations; i++) {
    const controller = new AbortController();
    // Random abort point so the aborts straddle every phase of the request:
    // pre-connect, mid-headers, mid-pull, and post-completion.
    const timer = setTimeout(() => controller.abort(), Math.random() * 10);
    try {
      await (await fetch(`http://127.0.0.1:${server.port}/`, { signal: controller.signal })).text();
      completed++;
    } catch {
      aborted++;
    } finally {
      clearTimeout(timer);
    }
  }
}

const WORKERS = 20;
const ITERATIONS = 30;
await Promise.all(Array.from({ length: WORKERS }, () => worker(ITERATIONS)));

server.stop(true);

if (aborted === 0 || completed + aborted !== WORKERS * ITERATIONS) {
  console.error(`expected some aborted requests, got completed=${completed} aborted=${aborted}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, completed, aborted }));
