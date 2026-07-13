import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// Regression: doRenderStream allocates a ResponseStream.JSSink on the heap
// and stores it in RequestContext.sink. A direct stream whose pull() returns
// synchronously without ending the sink keeps the request alive until
// controller.end(); the resolve path must destroy the sink and release the
// request context (neither finalizeWithoutDeinit() nor deinit() touch
// RequestContext.sink), otherwise the allocation plus its pooled buffer
// leaks on every such request.
test("HTTPResponseSink is destroyed after a sync pull() that ends later", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-response-stream-sink-leak-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The fixture prints nothing if it died or timed out; say which, instead of a bare
  // JSON.parse SyntaxError.
  expect({ printedResult: stdout.trim().length > 0, exitCode, stderr }).toMatchObject({
    printedResult: true,
    exitCode: 0,
  });
  const { delta, deltas, iterations } = JSON.parse(stdout);
  console.log({ deltas, iterations, perRequest: (delta / iterations).toFixed(1) });

  // RSS, not mimalloc's currentCommit: a discarded hole stays "committed", so that
  // counter ratchets under hole purging and is not a live-memory metric. A leaked sink
  // keeps its block resident, so RSS sees it. `delta` is the median steady-state growth
  // per 10k requests. Measured on a macOS debug build: 1.0 MB fixed vs 3.5 MB with the
  // leak reintroduced (~350 B/request; on Linux release the original #29877 leak showed
  // +4.1 MB RSS while the fixed build was flat).
  expect(delta).toBeLessThan(2 * 1024 * 1024);
}, 300_000);
