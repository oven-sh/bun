import { expect, test } from "bun:test";
import { join } from "path";
import { Worker } from "worker_threads";
import { EXPECTED_PER_HAMMER, hammer } from "./message-channel-concurrent-fixture.js";

// Regression test for the MessagePortChannelRegistry data race: the registry's
// m_openChannels HashMap and per-channel pending-message Vectors were mutated
// from worker threads with no synchronization (the upstream ASSERT(isMainThread())
// guards were commented out). This stresses the registry from several threads at
// once; before the registry was made lock-protected this would crash the process.
test("MessageChannel survives concurrent create/post/transfer/close from many workers", async () => {
  const WORKERS = 6;
  const fixture = join(import.meta.dir, "message-channel-concurrent-fixture.js");

  const workerResults = Array.from({ length: WORKERS }, () => {
    const worker = new Worker(fixture);
    return new Promise<number>((resolve, reject) => {
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", code => {
        if (code !== 0) reject(new Error(`worker exited with code ${code}`));
      });
    });
  });

  // Hammer the registry from the main thread concurrently with the workers.
  const mainResult = hammer();

  const results = await Promise.all(workerResults);

  expect(mainResult).toBe(EXPECTED_PER_HAMMER);
  expect(results).toEqual(Array(WORKERS).fill(EXPECTED_PER_HAMMER));
});
