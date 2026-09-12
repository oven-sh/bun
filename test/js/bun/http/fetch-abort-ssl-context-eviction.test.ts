import { blackholeListener } from "blackhole";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// Evicting a custom SSL context while it still has in-flight sockets closes
// those sockets via no-op callbacks (cleanCallbacks runs first in
// HTTPContext.deinit), so unregisterAbortTracker() never runs and
// socket_async_http_abort_tracker is left pointing at freed sockets. The next
// drainQueuedShutdowns then UAF'd. Fix: skip eviction when the context has
// active (non-pooled) sockets.
//
// This test fills the cache past ssl_context_cache_max_size (60) with distinct
// TLS configs whose connects never complete (a blackhole listener), so every
// cache entry has an active connecting socket. The 61st distinct config
// triggers evictOldestSslContext. Aborting all requests then drains the
// tracker.
//
// In debug+ASAN builds the existing assertUnpoisoned check at
// HTTPThread.processEvents catches the freed socket deterministically, so one
// run is enough. In release builds the UAF only crashes when the freed slot is
// reused; the fixture spams same-size-class allocations to make that likely
// (~30% per run before the fix), so loop a few times.
test("aborting fetches whose custom SSL context was evicted does not crash", async () => {
  // The fixture relies on its connects staying in-flight; strip any ambient
  // HTTP(S) proxy so those connects aren't intercepted. Raise the per-process
  // request cap so all 65+200 requests plus both barriers start in one FIFO
  // drain pass (default cap is 256; 65+200+1 would defer the second barrier
  // behind async .invalid DNS failures).
  const env: Record<string, string | undefined> = { ...bunEnv, BUN_CONFIG_MAX_HTTP_REQUESTS: "512" };
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) delete env[k];

  using blackhole = await blackholeListener();
  const fixture = fixtureFor(`https://${blackhole.hostname}:${blackhole.port}/`);

  const runs = isASAN ? 1 : 5;
  const results = await Promise.all(
    Array.from({ length: runs }, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }),
  );

  expect(results).toEqual(Array.from({ length: runs }, () => ({ stdout: "ok\n", stderr: "", exitCode: 0 })));
});

// The HTTP client thread's queued_tasks are popped FIFO and each task's
// start_queued_task → start_() creates its custom SSL context and runs the
// cache-size eviction check synchronously before returning. A plain HTTP
// fetch queued after the 65 SSL fetches therefore cannot start until every
// SSL context exists and eviction has fired for indices 60..64, so awaiting
// that barrier fetch replaces the 5s/0.5s sleeps the original fixture used.
const fixtureFor = (blackholeUrl: string) => /* js */ `
const N = 65; // > ssl_context_cache_max_size (60)
const controllers = [];
const promises = [];

await using server = Bun.serve({ port: 0, fetch: () => new Response("sync") });
const barrier = () => fetch(server.url).then(r => r.arrayBuffer());

// Phase 1: 65 distinct TLS configs to a hung target. The 61st+ trigger
// evictOldestSslContext, which (before the fix) closed the oldest context's
// socket via no-op callbacks and left the tracker entry dangling.
for (let i = 0; i < N; i++) {
  const ac = new AbortController();
  controllers.push(ac);
  promises.push(
    fetch(${JSON.stringify(blackholeUrl)}, {
      signal: ac.signal,
      tls: { serverName: "host" + i + ".test" },
    }).catch(() => {})
  );
}
await barrier();

// Phase 2: spam non-SSL us_connecting_socket_t allocs (same mimalloc size
// class as the evicted SSL semi-socket) so the freed slots are reused with
// closed==0 instead of the stale closed==1 — that's what makes the dangling
// tracker entry actually fault in release builds.
for (let i = 0; i < 200; i++) {
  const ac = new AbortController();
  controllers.push(ac);
  promises.push(
    fetch("http://does-not-resolve-" + i + ".invalid/", { signal: ac.signal }).catch(() => {})
  );
}
await barrier();

// Abort everything — drainQueuedShutdowns walks the tracker.
for (const ac of controllers) ac.abort();
await Promise.all(promises);

console.log("ok");
`;
