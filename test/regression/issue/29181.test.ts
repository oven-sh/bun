// https://github.com/oven-sh/bun/issues/29181
import { expect, test } from "bun:test";
import { getFDCount, isPosix, tempDir } from "harness";
import { join } from "node:path";

// getFDCount reads /proc/self/fd (Linux) or /dev/fd (macOS). On Windows
// we don't have a stable way to query per-process fds, so skip there.
test.skipIf(!isPosix)("Bun.serve static file route does not leak fds on 304 / HEAD", async () => {
  using dir = tempDir("issue-29181-fds", { "file.txt": "Hello, world!\n" });
  const tmpFile = join(String(dir), "file.txt");

  await using server = Bun.serve({
    port: 0,
    static: { "/test": new Response(Bun.file(tmpFile)) },
    fetch() {
      return new Response("fallback");
    },
  });

  const url = `http://localhost:${server.port}/test`;

  // Prime the route once so Last-Modified is known and any one-time
  // allocations (sockets, hash tables, etc.) don't inflate the baseline.
  {
    const r = await fetch(url);
    await r.text();
  }

  // Baseline AFTER the first request — anything steady-state in the
  // runtime is already accounted for.
  const before = getFDCount();

  // A date in the future guarantees 304 Not Modified.
  const ifModifiedSince = new Date(Date.now() + 86_400_000).toUTCString();

  const iterations = 200;

  // 200 requests that trigger 304 Not Modified.
  for (let i = 0; i < iterations; i++) {
    const r = await fetch(url, { headers: { "If-Modified-Since": ifModifiedSince } });
    expect(r.status).toBe(304);
    await r.text();
  }

  // 200 HEAD requests.
  for (let i = 0; i < iterations; i++) {
    const r = await fetch(url, { method: "HEAD" });
    expect(r.status).toBe(200);
    await r.text();
  }

  const after = getFDCount();

  // Pre-fix: delta would be 400 (one fd leaked per request).
  // Post-fix: delta is bounded by HTTP keep-alive sockets (typically a
  // small constant). 16 is comfortably above that and still catches the
  // old 400-fd leak.
  const delta = after - before;
  expect(delta).toBeLessThan(16);
});

// FileRoute.on() calls server.onPendingRequest() at the top but the
// 304 / HEAD / bodiless early-return paths used to call `deref()`
// directly instead of `onResponseComplete(resp)`, so pending_requests
// was never decremented. graceful `server.stop()` awaits
// pending_requests == 0 and hung forever after any 304 or HEAD on a
// static file route.
test("Bun.serve static file route: graceful stop resolves after 304 / HEAD", async () => {
  using dir = tempDir("issue-29181-stop", { "file.txt": "Hello, world!\n" });
  const tmpFile = join(String(dir), "file.txt");

  await using server = Bun.serve({
    port: 0,
    static: { "/test": new Response(Bun.file(tmpFile)) },
    fetch() {
      return new Response("fallback");
    },
  });

  const url = `http://localhost:${server.port}/test`;

  // Prime Last-Modified.
  await (await fetch(url)).text();

  const ifModifiedSince = new Date(Date.now() + 86_400_000).toUTCString();
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { headers: { "If-Modified-Since": ifModifiedSince } });
    expect(r.status).toBe(304);
    await r.text();
  }
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { method: "HEAD" });
    expect(r.status).toBe(200);
    await r.text();
  }

  // Graceful stop must resolve. Pre-fix this hangs forever because
  // pending_requests was stuck at 10.
  await server.stop();
});
