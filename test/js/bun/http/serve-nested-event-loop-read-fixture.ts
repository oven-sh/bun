// Spawned by serve-nested-event-loop-read.test.ts, once per server kind
// (argv[2]: "bun" or "node").
//
// One request handler runs the event loop inside itself: Bun.build waits for an
// async plugin setup() with a blocking wait that ticks the loop. The test sends
// more bytes on the SAME connection while that wait runs, then the handler
// reads the request's url and headers. Both point into the parser's buffer for
// this connection, which a read parsed inside the wait reallocates.
//
// Markers go out with writeSync so they reach the test before the handler
// returns.
import { writeSync } from "node:fs";
import http from "node:http";

const kind = process.argv[2];
const entry = process.argv[3];

let requests = 0;

/* Returns the body to answer with. `read` reports the request as the handler
 * sees it, after the nested run of the event loop. */
function handle(read: () => { url: string; authorization: string | null | undefined }): string {
  requests++;

  // Request 1 is the barrier: answering it proves the server read the first
  // half of request 2's head, so that head must arrive over two reads.
  if (requests === 1) {
    return "barrier";
  }

  if (requests === 2) {
    // Nothing reads the request before the nested run of the event loop:
    // reading url or headers here would cache them while they are still valid.
    let ticked = false;
    setTimeout(() => {
      ticked = true;
    }, 1);

    writeSync(1, "holding\n");
    Bun.build({
      entrypoints: [entry],
      plugins: [{ name: "hold-the-loop", setup: () => Bun.sleep(250) }],
    }).then(
      () => {},
      () => {},
    );

    writeSync(1, `result ${JSON.stringify({ ticked, ...read() })}\n`);
    return "r1";
  }

  writeSync(1, `again ${JSON.stringify(read().url)}\n`);
  return "r2";
}

if (kind === "node") {
  const server = http.createServer((req, res) => {
    res.end(handle(() => ({ url: req.url!, authorization: req.headers.authorization ?? null })));
  });
  server.listen(0, "127.0.0.1", () => {
    writeSync(1, `port ${(server.address() as { port: number }).port}\n`);
  });
} else {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch(req) {
      return new Response(handle(() => ({ url: req.url, authorization: req.headers.get("authorization") })));
    },
  });
  writeSync(1, `port ${server.port}\n`);
}
