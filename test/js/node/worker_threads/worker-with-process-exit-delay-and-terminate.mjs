import assert from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread } from "node:worker_threads";

// This test exists so we can test the behaviour from
// https://github.com/oven-sh/bun/blob/f6dc66925e40dfb088c78b9592f832cbddb86519/test/js/web/workers/worker.test.ts#L341-L351

if (isMainThread) {
  const worker = new Worker(fileURLToPath(import.meta.url), { smol: true });
  let exitCode;
  worker.once("exit", code => (exitCode = code));
  await sleep(200);
  assert.strictEqual(await worker.terminate(), undefined);
  assert.strictEqual(exitCode, 2);
} else {
  await sleep(100);
  process.exit(2);
}
