import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// When a WebSocket upgrade request is routed through onWebSocketUpgrade's
// catch-all path (id == 0), the RequestContext's AbortSignal must be GC-able
// after the request completes. Previously the catch-all path skipped
// pendingActivityRef() while finalizeWithoutDeinit unconditionally called
// pendingActivityUnref(), underflowing the counter and making
// hasPendingActivity() return true forever — leaking JSAbortSignal.
test("request.signal from WebSocket upgrade catch-all is collectable after the request completes", async () => {
  const script = /* js */ `
    let collected = 0;
    const registry = new FinalizationRegistry(() => {
      collected++;
    });

    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        // Access req.signal to materialize the JSAbortSignal wrapper, and add an
        // abort listener so isReachableFromOpaqueRoots checks hasPendingActivity().
        req.signal.addEventListener("abort", () => {});
        registry.register(req.signal, undefined);
        // Do NOT upgrade — return a plain response so the request finalizes
        // normally (flags.aborted stays false; the signal is never aborted).
        return new Response("no upgrade");
      },
      websocket: {
        message() {},
      },
    });

    const ITERS = 10;
    for (let i = 0; i < ITERS; i++) {
      const { promise, resolve } = Promise.withResolvers();
      const ws = new WebSocket(server.url.href.replace("http", "ws"));
      // The handler returns a non-101 response, so the client sees a failed handshake.
      ws.onerror = resolve;
      ws.onclose = resolve;
      await promise;
    }

    for (let i = 0; i < 10 && collected < ITERS; i++) {
      Bun.gc(true);
      await Bun.sleep(5);
    }

    console.log(JSON.stringify({ collected, iters: ITERS }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { collected, iters } = JSON.parse(stdout.trim());
  if (isWindows) {
    // FinalizationRegistry timing is flakier on Windows; require at least half.
    expect(collected).toBeGreaterThanOrEqual(Math.floor(iters / 2));
  } else {
    expect(collected).toBe(iters);
  }
  expect(exitCode).toBe(0);
});
