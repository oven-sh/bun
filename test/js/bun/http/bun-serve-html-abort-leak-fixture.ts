// Fixture for bun-serve-html-abort-leak.test.ts.
//
// Serves an HTML bundle route whose build is held open by a plugin gate,
// fires HTTP requests at it, then closes the sockets while the route is
// still `.building` so HTMLBundle.PendingResponse.onAborted runs.
//
// Run with BUN_DEBUG_alloc=1 and BUN_DEBUG=<log file>. The fixture polls that
// file for `[alloc] new(PendingResponse)` / `[alloc] destroy(PendingResponse)`
// lines so every ordering constraint is a real condition wait, not a
// tick-count sleep. The parent test reads the same file after exit to do the
// final balance check.
//
// Invoked with cwd = a temp dir containing index.html, app.js, plugin.js
// and bunfig.toml (`[serve.static] plugins = ["./plugin.js"]`).

import { readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";

declare global {
  var __gateStarted: PromiseWithResolvers<void> | undefined;
  var __gateRelease: PromiseWithResolvers<void> | undefined;
}

const allocLog = process.env.ALLOC_LOG;
if (!allocLog) throw new Error("ALLOC_LOG env var is required");

function countAlloc(verb: "new" | "destroy"): number {
  let text: string;
  try {
    text = readFileSync(allocLog!, "utf8");
  } catch {
    return 0;
  }
  let n = 0;
  const needle = `[alloc] ${verb}(PendingResponse)`;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

// Poll `cond` once per event-loop turn. The wall-clock bound is a safety
// net so a regressed build fails with a clear message instead of hanging
// until the parent test times out; on a fixed build every condition is met
// in well under a second.
async function until(cond: () => boolean, what: string, deadlineMs = 20_000) {
  const start = performance.now();
  while (performance.now() - start < deadlineMs) {
    if (cond()) return;
    await new Promise(r => setImmediate(r));
  }
  throw new Error(`gave up waiting for: ${what}`);
}

// plugin.js awaits __gateRelease.promise and resolves __gateStarted when
// setup() begins, so create them before anything can trigger plugin load.
globalThis.__gateStarted = Promise.withResolvers();
globalThis.__gateRelease = Promise.withResolvers();

const html = (await import(path.join(process.cwd(), "index.html"))).default;

const server = Bun.serve({
  port: 0,
  development: false,
  static: {
    "/": html,
  },
  fetch() {
    return new Response("not found", { status: 404 });
  },
});

// Fire the first request to kick the route from `pending` → `building`
// (triggers plugin load; plugin.setup() blocks on __gateRelease).
const first = fetch(`http://127.0.0.1:${server.port}/`)
  .then(r => r.text())
  .catch(() => {});

// Wait until the plugin's setup() has actually started. From this point the
// route stays in `.building` until we resolve __gateRelease.
await globalThis.__gateStarted!.promise;

// Open raw TCP connections, send an HTTP request on each (queued as a
// PendingResponse), then close the socket before the build completes.
// Connect in parallel — debug+ASAN node:net is slow per-socket.
const ABORTED = 5;
const sockets: import("node:net").Socket[] = await Promise.all(
  Array.from({ length: ABORTED }, () => {
    const sock = connect({ port: server.port, host: "127.0.0.1" });
    return new Promise<import("node:net").Socket>((resolve, reject) => {
      sock.once("connect", () => {
        sock.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
        resolve(sock);
      });
      sock.once("error", reject);
    });
  }),
);

// Wait until every request has been routed and queued (first fetch + the
// ABORTED raw sockets). Without this the destroy() below could race the
// server reading the request line.
await until(() => countAlloc("new") >= ABORTED + 1, `${ABORTED + 1}x new(PendingResponse)`);

for (const sock of sockets) sock.destroy();

// Wait until onAborted has fired (and, with the fix, freed the allocation)
// for every closed socket *before* releasing the build. If we released the
// gate first, resumePendingResponses() would clearAborted()+deinit() the
// still-queued entries itself and the test would pass even without the fix.
await until(() => countAlloc("destroy") >= ABORTED, `${ABORTED}x destroy(PendingResponse) via onAborted`);

// Release the build so the first (non-aborted) request completes and
// resumePendingResponses() runs on whatever is left in the list.
globalThis.__gateRelease!.resolve();
await first;

await server.stop(true);
process.exit(0);
