import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Evicting a custom SSL context while it still has in-flight sockets closes
// those sockets via no-op callbacks (cleanCallbacks runs first in
// HTTPContext.deinit), so unregisterAbortTracker() never runs and
// socket_async_http_abort_tracker is left pointing at freed sockets. The next
// drainQueuedShutdowns then UAF'd. Fix: skip eviction when the context has
// active (non-pooled) sockets.
//
// This test fills the cache past ssl_context_cache_max_size (60) with distinct
// TLS configs whose connects never complete (TEST-NET-1), so every cache entry
// has an active connecting socket. The 61st distinct config triggers
// evictOldestSslContext. Aborting all requests then drains the tracker.
//
// In debug+ASAN builds the existing assertUnpoisoned check at
// HTTPThread.processEvents catches the freed socket deterministically. In
// release builds the UAF only crashes when the freed slot is reused; the
// fixture spams same-size-class allocations to make that likely (~30% per
// run before the fix), so loop a few times.
test("aborting fetches whose custom SSL context was evicted does not crash", async () => {
  for (let run = 0; run < 5; run++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Segmentation fault");
    expect(stderr).not.toContain("poisoned");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  }
}, 120_000);

const fixture = /* js */ `
const N = 65; // > ssl_context_cache_max_size (60)
const controllers = [];
const promises = [];

// Phase 1: 65 distinct TLS configs to a hung target. The 61st+ trigger
// evictOldestSslContext, which (before the fix) closed the oldest context's
// socket via no-op callbacks and left the tracker entry dangling.
for (let i = 0; i < N; i++) {
  const ac = new AbortController();
  controllers.push(ac);
  promises.push(
    fetch("https://192.0.2.1/", {
      signal: ac.signal,
      tls: { serverName: "host" + i + ".test" },
    }).catch(() => {})
  );
}

// Creating 60+ SSL contexts is slow in debug+ASAN builds.
await Bun.sleep(5000);

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
await Bun.sleep(500);

// Abort everything — drainQueuedShutdowns walks the tracker.
for (const ac of controllers) ac.abort();
await Promise.all(promises);

console.log("ok");
`;
