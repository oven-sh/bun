// DeferredTaskQueue::run iterates the auto-flusher map and invokes each
// entry's callback. H2FrameParser::on_auto_flush calls flush -> uncork ->
// unregister_auto_flush, which removes its own entry from the map while
// run() is iterating, and then returns true (keep). The loop must not
// assume the map length is unchanged after the callback returns.
//
// This fixture registers two auto-flushers in the same microtask so they
// share one DeferredTaskQueue::run pass: an H2FrameParser (via
// client.request, which corks) and an HTTPServerWritable (via a small
// controller.write on a Bun.serve direct stream, which buffers and
// registers). The H2 entry is first in the insertion-ordered map; when its
// callback removes it and returns true, run() must re-read the map length
// before indexing the next slot.

const http2 = require("node:http2");
const { once } = require("node:events");

async function main() {
  const h2srv = http2.createServer();
  h2srv.on("stream", s => {
    s.respond({ ":status": 200 });
    s.end("ok");
  });
  h2srv.on("error", () => {});
  h2srv.listen(0, "127.0.0.1");
  await once(h2srv, "listening");
  const h2port = h2srv.address().port;

  const client = http2.connect(`http://127.0.0.1:${h2port}`);
  client.on("error", () => {});
  await once(client, "connect");

  let resolveController;
  const controllerPromise = new Promise(r => (resolveController = r));
  let resolveDone;
  const donePromise = new Promise(r => (resolveDone = r));

  const app = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          pull(controller) {
            resolveController(controller);
            return donePromise;
          },
        }),
      );
    },
  });

  const fetchPromise = fetch(`http://127.0.0.1:${app.port}/`).then(r => r.text());
  const controller = await controllerPromise;

  // Move to a fresh event-loop task so the registrations below land in a
  // microtask whose drain runs DeferredTaskQueue::run directly after.
  await new Promise(r => setImmediate(r));

  queueMicrotask(() => {
    // H2FrameParser::write -> cork -> register_auto_flush (map[0]).
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    req.resume();
    // HTTPServerWritable::write (< highWaterMark) -> register_auto_flusher (map[1]).
    controller.write("x");
  });
  await new Promise(r => setImmediate(r));

  controller.write("y");
  controller.close();
  resolveDone();
  const body = await fetchPromise;
  if (body !== "xy") throw new Error(`unexpected body: ${JSON.stringify(body)}`);

  app.stop(true);
  client.close();
  await new Promise(r => h2srv.close(r));
  console.log("OK");
}

main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  },
);
