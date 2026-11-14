// Bun.serve runs script from the socket's writable callback while it writes a streamed
// body: the content handlers of an HTMLRewriter, the pull() of a ReadableStream, the code
// after an awaited write. This server runs a probe in that script, once, and prints the
// order in which the callbacks of the probe ran.
//
//   bun serve-body-jobs-fixture.ts <body> <probe> [page] [h2]
//
// The client reads nothing until this prints "backpressured". The dispatch of the request
// has then returned, with the socket full, so every later write comes from the writable
// callback.
//
// A request with a body is dispatched before its body. This prints "waiting" when the
// socket is full, and "backpressured" when the client says that it has sent the rest.
//
// The server is a process of its own, so that the callbacks of the probe are the only ones
// on its loop. Any other callback that the loop enters runs the checkpoint that the
// writable callback did not run.
import type { ServerWebSocket } from "bun";
import { AsyncLocalStorage } from "node:async_hooks";

const [body, probe, page, transport] = process.argv.slice(2);

const store = new AsyncLocalStorage<string>();
const order: string[] = [];
// The socket is full, and the callback that filled it has returned.
let backpressured = false;
let probed = false;
let ws: ServerWebSocket<unknown> | undefined;
// For the "turn" probe: the turn of the loop that arm() last armed a timer in, and the
// last turn whose timer ran.
let armed = 0;
let fired = 0;
// The test has closed stdin.
let ended = false;

const probes: Record<string, { entries: number; run(): void }> = {
  // ws.close() runs close() before it returns, between the event loop's enter() and exit().
  // If the callback that runs the script has not entered the loop, that exit() is a
  // checkpoint, and the jobs run before "rest of script".
  statement: {
    entries: 5,
    run() {
      record("script");
      process.nextTick(() => record("nextTick"));
      queueMicrotask(() => record("microtask"));
      ws!.close();
      record("rest of script");
    },
  },
  // The timer is due before the script returns, so it is the next callback of the loop
  // after the one that runs the script.
  timer: {
    entries: 3,
    run() {
      setTimeout(() => record("timer"), 0);
      process.nextTick(() => record("nextTick"));
      queueMicrotask(() => record("microtask"));
      Bun.sleepSync(5);
    },
  },
  // A store that script enters with enterWith() ends with the callback that ran the script.
  store: {
    entries: 2,
    run() {
      setTimeout(() => record("timer sees " + store.getStore()), 0);
      setImmediate(() => record("immediate sees " + store.getStore()));
      store.enterWith("script");
      Bun.sleepSync(5);
    },
  },
  // For script that is itself a job of the writable callback (the code after an await):
  // it has nothing to run a timer probe in. arm() gives each turn of the loop a timer that
  // is due before the loop polls, and the script says whether the timer of its turn ran.
  turn: {
    entries: 1,
    run() {
      record(fired < armed ? "before the timer of its turn" : "after the timer of its turn");
    },
  },
};
const { entries, run } = probes[probe];

function record(entry: string) {
  order.push(entry);
  if (order.length === entries) console.log(JSON.stringify(order));
}

function script() {
  if (!backpressured || probed) return;
  probed = true;
  run();
}

function release() {
  backpressured = true;
  console.log("backpressured");
  if (probe === "turn") arm();
}

function arm() {
  if (probed || ended) return;
  const turn = ++armed;
  setTimeout(() => {
    fired = turn;
  }, 0);
  Bun.sleepSync(2);
  setImmediate(arm);
}

const chunk = new Uint8Array(256 * 1024).fill(97);
// What a stream feeds to an HTMLRewriter: one <b> in each 256 KiB.
const block = Buffer.from("<p>" + Buffer.alloc(256 * 1024 - 15, "a").toString() + "</p><b></b>\n");
// More than a socket takes from a server whose client reads nothing.
const large = 16 * 1024 * 1024;

const bodies: Record<string, (request: Request) => Response> = {
  // The content handlers are the script. `page` has one <b> in each chunk that the file is
  // read in. Its size is `large`.
  rewriter: () => new HTMLRewriter().on("b", { element: script }).transform(new Response(Bun.file(page))),
  // The code after an await in a content handler is the script. The rewriter runs a
  // checkpoint for a handler that returns a pending promise, so only the order inside a
  // statement depends on the writable callback.
  "rewriter with an async handler": () =>
    new HTMLRewriter()
      .on("b", {
        async element() {
          await null;
          script();
        },
      })
      .transform(new Response(Bun.file(page))),
  // The content handler runs the probe, then throws: the response is cut off.
  "rewriter that throws": () =>
    new HTMLRewriter()
      .on("b", {
        element() {
          if (!backpressured || probed) return;
          script();
          throw new Error("thrown by the content handler");
        },
      })
      .transform(new Response(Bun.file(page))),
  // The content handlers are the script, and the input is the body of the request. The
  // first <b> answers with one write of more than the socket takes: the rewriter waits for
  // the socket, and the rest of the body, with the second <b>, waits in the server for the
  // rewriter. The handler of the second <b> then runs when the socket has drained. If the
  // socket took the write whole, that handler runs when the rest arrives, before "sent".
  "rewriter over the request body": request => {
    let elements = 0;
    return new HTMLRewriter()
      .on("b", {
        element(element) {
          if (++elements === 1) {
            element.after(Buffer.alloc(large, "a").toString(), { html: true });
            console.log("waiting");
          } else if (backpressured) script();
          else console.log(JSON.stringify(["the socket did not fill"]));
        },
      })
      .transform(new Response(request.body));
  },
  // The content handlers are the script, and no file is read: the input is a direct stream.
  "rewriter over a direct stream": () =>
    new HTMLRewriter().on("b", { element: script }).transform(
      new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            // Nothing reads the output inside transform(): the rewriter takes one block and waits.
            controller.write(block);
            await controller.flush(true);
            // The server reads now. A write that reached the socket returns its length.
            for (let blocks = 0; blocks < 64 && controller.write(block) > 0; blocks++);
            // The socket is full: the rewriter holds this block until the writable callback.
            controller.write(block);
            await controller.flush(true);
            if (!probed) console.log(JSON.stringify(["the socket did not fill"]));
            controller.close();
          },
        } as any),
      ),
    ),
  // pull() of the rewriter's input is the script.
  "rewriter over a stream": () =>
    new HTMLRewriter().on("b", { element() {} }).transform(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (probed) return controller.close();
            script();
            controller.enqueue(block);
          },
        }),
      ),
    ),
  // The code after a flush(true) into the rewriter is the script.
  "rewriter over a direct stream that awaits flush(true)": () =>
    new HTMLRewriter().on("b", { element() {} }).transform(
      new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            while (!probed) {
              controller.write(block);
              await controller.flush(true);
              script();
            }
            controller.close();
          },
        } as any),
      ),
    ),
  // pull() is the script. The stream lasts until the probe has run. It is made with no
  // store active: a stream that is made under a store puts that store back after pull().
  stream: () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          if (probed) return controller.close();
          script();
          controller.enqueue(chunk);
        },
      }),
    ),
  // pull() runs the probe, then throws: the response is cut off.
  "stream that throws": () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          if (backpressured && !probed) {
            script();
            throw new Error("thrown by pull()");
          }
          controller.enqueue(chunk);
        },
      }),
    ),
  // The code after write() is the script. A write that finds the socket full returns a
  // promise, and the writable callback settles it.
  "direct stream that awaits write()": () =>
    new Response(
      new ReadableStream({
        type: "direct",
        async pull(controller) {
          while (!probed) {
            await controller.write(chunk);
            script();
          }
          controller.close();
        },
      } as any),
    ),
  // The code after flush(true) is the script. Each write is under the high water mark and
  // stays in the sink's buffer, so only a flush finds the socket full, and only its promise
  // waits for the writable callback.
  "direct stream that awaits flush(true)": () =>
    new Response(
      new ReadableStream(
        {
          type: "direct",
          async pull(controller) {
            while (!probed) {
              controller.write(chunk.subarray(0, 64 * 1024));
              await controller.flush(true);
              script();
            }
            controller.close();
          },
        } as any,
        { highWaterMark: chunk.length },
      ),
    ),
  // The code after end() is the script. The write is under the high water mark, so end()
  // sends the whole body, and its promise waits for the writable callback that sends the
  // last of it.
  "direct stream that awaits end()": () =>
    new Response(
      new ReadableStream(
        {
          type: "direct",
          async pull(controller) {
            controller.write(new Uint8Array(large));
            await controller.end();
            script();
          },
        } as any,
        { highWaterMark: large + 1 },
      ),
    ),
};

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  http2: transport === "h2",
  websocket: {
    open(socket) {
      ws = socket;
    },
    message() {},
    close() {
      record("close");
    },
  },
  fetch(request, server) {
    if (request.url.endsWith("/websocket")) {
      return server.upgrade(request) ? undefined : new Response(null, { status: 400 });
    }
    // Runs after the dispatch of this request, so after the render stopped at a full socket.
    // A request with a body fills the socket after its dispatch: see "waiting".
    if (request.method === "GET") setImmediate(release);
    return bodies[body](request);
  },
});

if (probe === "statement") {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const client = new WebSocket(`ws://127.0.0.1:${server.port}/websocket`);
  client.onopen = resolve;
  client.onerror = reject;
  await promise;
}
console.log(server.port);

// The test writes "sent" when it has sent the rest of a request body. It closes stdin when
// the response has ended.
for await (const line of console) if (line === "sent") release();
ended = true;
server.stop(true);
