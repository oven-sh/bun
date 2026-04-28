import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// Regression: doRenderStream allocates a ResponseStream.JSSink on the heap
// and stores it in RequestContext.sink. When assignToStream() returns
// undefined (a direct stream drained synchronously with no pending promise)
// the fallback branches detached the sink from JS but never called
// sink.destroy(), and neither finalizeWithoutDeinit() nor deinit() touch
// RequestContext.sink, so the allocation plus its pooled buffer leaked on
// every such request.
test("HTTPResponseSink is destroyed on doRenderStream no-promise fallback", async () => {
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
