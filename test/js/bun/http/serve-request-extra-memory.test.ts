import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

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

  let maxDelta = 0;
  const batchSize = 50;
  const batches = 40;
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

  expect(maxDelta).toBeGreaterThan(256 * 1024);
});
