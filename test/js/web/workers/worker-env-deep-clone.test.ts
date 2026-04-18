import { expect, test } from "bun:test";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

// Regression test: a worker's env map must be a deep copy of its parent's.
// Previously the clone was shallow — key/value bytes were borrowed from the
// parent's map — so a nested worker whose parent exited (freeing its arena)
// or whose parent concurrently mutated its env map could read poisoned
// memory during configureDefines → env.get("BUN_DISABLE_TRANSPILER").
//
// The test spawns a worker that itself spawns a nested worker and is then
// immediately terminated, so the grandchild's start() races against the
// parent worker's arena teardown. With ASAN this used to trip
// use-after-poison.
test("worker env map is deep-cloned from parent", async () => {
  const fixture = join(import.meta.dir, "worker-env-nested-fixture.js");

  const { promise, resolve, reject } = Promise.withResolvers();
  const w = new Worker(fixture, { workerData: { depth: 0 } });
  w.on("message", msg => {
    resolve(msg);
  });
  w.on("error", reject);

  const msg = await promise;
  expect(msg).toEqual({ depth: 0, sum: expect.any(Number), ok: true });

  await w.terminate();
});
