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

  expect(stderr).toBe("");
  const { before, after, delta, iterations } = JSON.parse(stdout);
  console.log({ before, after, delta, iterations, perRequest: (delta / iterations).toFixed(1) });

  // currentCommit is mimalloc's committed bytes, so it tracks native
  // allocations independent of the JS heap. Before the fix each request
  // leaked the JSSink struct + its buffer, growing commit by ~4 MB (release)
  // to ~10 MB (debug/ASAN) over 10k requests. After the fix it stays flat.
  // Allow 2 MB of slack for allocator noise.
  expect(delta).toBeLessThan(2 * 1024 * 1024);
  expect(exitCode).toBe(0);
}, 120_000);
