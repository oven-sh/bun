// Fixture for bun-serve-html-abort-leak.test.ts.
//
// Serves an HTML bundle route whose build is held open by a plugin gate,
// fires HTTP requests at it, then closes the sockets while the route is
// still `.building` so HTMLBundle.PendingResponse.onAborted runs.
//
// Run under BUN_DEBUG_alloc=1; the parent test counts
// `[alloc] new(PendingResponse)` vs `[alloc] destroy(PendingResponse)`.
//
// Invoked with cwd = a temp dir containing index.html, app.js, plugin.js
// and bunfig.toml (`[serve.static] plugins = ["./plugin.js"]`).

import { connect } from "node:net";
import path from "node:path";

declare global {
  var __gateStarted: PromiseWithResolvers<void> | undefined;
  var __gateRelease: PromiseWithResolvers<void> | undefined;
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

// Yield to the event loop a fixed number of times. Client and server share
// the same loop, so after a few ticks any locally-written socket data has
// been delivered to uWS and processed.
async function spin(ticks = 8) {
  for (let i = 0; i < ticks; i++) await new Promise(r => setImmediate(r));
}

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
const ABORTED = 5;
const sockets: import("node:net").Socket[] = [];
for (let i = 0; i < ABORTED; i++) {
  const sock = connect({ port: server.port, host: "127.0.0.1" });
  await new Promise<void>((resolve, reject) => {
    sock.once("connect", () => resolve());
    sock.once("error", reject);
  });
  sock.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
  sockets.push(sock);
}

// Let the server read + route every request before we abort.
await spin();

for (const sock of sockets) sock.destroy();

// Let onAborted fire for each closed socket.
await spin();

// Release the build so the first (non-aborted) request completes and
// resumePendingResponses() runs on whatever is left in the list.
globalThis.__gateRelease!.resolve();
await first;

await server.stop(true);

// Give the scoped logger a chance to flush.
await spin(2);
process.exit(0);
