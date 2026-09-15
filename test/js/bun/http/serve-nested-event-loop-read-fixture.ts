// Spawned by serve-nested-event-loop-read.test.ts, once per scenario
// (argv[2]: "bun", "node", "body" or "upgrade").
//
// One request handler runs the event loop inside itself: Bun.build waits for an
// async plugin setup() with a blocking wait that ticks the loop. The test sends
// more bytes on the SAME connection while that wait runs.
//
// "bun" and "node": the handler then reads the request's url and headers. Both
// point into the parser's buffer for this connection, which a read parsed
// inside the wait reallocates.
// "body": the bytes that arrive are the rest of the request's own body, and the
// handler then reads the whole body.
// "upgrade": the handler then upgrades the request to a WebSocket, which has to
// keep receiving frames afterwards.
//
// Markers go out with writeSync so they reach the test before the handler
// returns.
import { writeSync } from "node:fs";
import http from "node:http";

const kind = process.argv[2];
const entry = process.argv[3];

/* Run the event loop inside the caller. Returns whether it really ran. */
function holdTheLoop(): boolean {
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
  return ticked;
}

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
    const ticked = holdTheLoop();
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
} else if (kind === "body") {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const ticked = holdTheLoop();
      const body = await req.text();
      writeSync(1, `result ${JSON.stringify({ ticked, body })}\n`);
      return new Response("ok");
    },
  });
  writeSync(1, `port ${server.port}\n`);
} else if (kind === "upgrade") {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch(req, server) {
      const ticked = holdTheLoop();
      writeSync(1, `upgrading ${JSON.stringify({ ticked })}\n`);
      if (!server.upgrade(req)) {
        return new Response("no upgrade", { status: 500 });
      }
    },
    websocket: {
      message(ws, message) {
        writeSync(1, `message ${JSON.stringify(message)}\n`);
      },
    },
  });
  writeSync(1, `port ${server.port}\n`);
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
