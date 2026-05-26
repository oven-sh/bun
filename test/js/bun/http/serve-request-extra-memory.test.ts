import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

// Serving a request creates native per-request state (the pooled request
// context, the Request/Response boxes, the AbortSignal) that is only released
// once the GC collects the JS wrappers. The server reports that memory to the
// GC per request (server.zig reportExtraMemory(@sizeOf(Ctx))) — without the
// report, sustained HTTP load lets the garbage pile up between collections
// and steady-state RSS balloons.
//
// The accounting is observable as process.memoryUsage().external (JSC's
// extraMemorySize): it must grow by roughly sizeof(RequestContext) per request
// served since the last full GC.
test("Bun.serve reports per-request context memory to the GC", async () => {
  const { promise, resolve } = Promise.withResolvers<string>();
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "serve-request-extra-memory-fixture.ts")],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
    ipc(message) {
      if (message?.url) resolve(message.url);
    },
  });

  const origin = new URL(await promise).origin;
  const report = async (): Promise<{ external: number; rss: number }> =>
    await fetch(`${origin}/report`).then(r => r.json());

  const baseline = (await report()).external;

  // Fire keep-alive requests at the hello-world route in concurrent batches,
  // sampling the server's extra-memory accounting as we go. A full GC in the
  // server resets the counter, so track the maximum delta seen rather than
  // only the final value.
  let maxDelta = 0;
  const batchSize = 50;
  const batches = 40; // 2000 requests total
  for (let i = 0; i < batches; i++) {
    const batch: Promise<unknown>[] = [];
    for (let j = 0; j < batchSize; j++) {
      batch.push(fetch(`${origin}/`).then(r => r.text()));
    }
    await Promise.all(batch);
    if (i % 5 === 4) {
      const { external } = await report();
      maxDelta = Math.max(maxDelta, external - baseline);
    }
  }

  // 2000 requests × sizeof(RequestContext) (hundreds of bytes each) is well
  // over 512 KiB of reported extra memory. Without the per-request
  // accounting, the counter stays within allocator noise (a few KiB).
  expect(maxDelta).toBeGreaterThan(256 * 1024);
});
