import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// server.reload({ websocket: { close() {} } }) — i.e. a websocket config
// without `open` or `message` — is silently discarded by onReloadFromZig.
// WebSocketServerContext.onCreate has already JSC::gcProtect'd every handler
// by that point, so discarding without a matching unprotect permanently
// roots the callbacks (and anything their closures capture).
test("server.reload() with websocket config lacking open/message does not leak protected handlers", async () => {
  const script = /* js */ `
    const { heapStats } = require("bun:jsc");

    const server = Bun.serve({
      port: 0,
      fetch() { return new Response("ok"); },
      websocket: { open() {}, message() {} },
    });

    const protectedFns = () => heapStats().protectedObjectTypeCounts.Function ?? 0;

    const before = protectedFns();

    const ITERS = 200;
    for (let i = 0; i < ITERS; i++) {
      // Only close/drain/ping/pong — no open/message. onReloadFromZig drops
      // this config; previously the protect() from onCreate was never undone.
      server.reload({
        fetch() { return new Response("ok"); },
        websocket: {
          close() { void i; },
          drain() { void i; },
          ping() { void i; },
          pong() { void i; },
        },
      });
    }

    Bun.gc(true);
    const after = protectedFns();

    server.stop(true);

    // A handful of newly-protected functions is fine (e.g. the last reload's
    // fetch handler). Leaking four handlers per iteration would put the delta
    // near ITERS * 4 = 800.
    console.log(JSON.stringify({ before, after, iters: ITERS }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { before, after, iters } = JSON.parse(stdout.trim());
  // With the leak, `after - before` is ~iters * 4 (one per close/drain/ping/pong).
  // Without it, the delta should be a small constant independent of `iters`.
  expect(after - before).toBeLessThan(iters);
  expect(exitCode).toBe(0);
});
