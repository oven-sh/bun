// Also runs in Node.js (`node --test <file>`), so it uses node:test and imports only Node modules.
import assert from "node:assert";
import { before, test } from "node:test";
import { Worker } from "node:worker_threads";

// A process's first Worker pays one-time costs on both threads. This one pays them, so that the
// workers that the test measures do not.
before(async () => {
  const worker = new Worker("", { eval: true });
  await new Promise(resolve => worker.once("exit", resolve));
});

// Node posts 'online' from the worker's bootstrap, which has received workerData by then, and runs
// the entry next: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/main/worker_thread.js#L148
// No event tells the parent that the worker has its workerData, so this compares two times. With a
// large workerData, most of the time to the entry's first message passes before 'online'. A worker
// that posts 'online' when its thread starts has most of that time still ahead of it.
test("'online' follows the worker's receipt of workerData", async () => {
  const workerData = Array.from({ length: 100_000 }, (_, i) => i);
  const ended: Promise<number>[] = [];

  // The part of the time from the constructor to the entry's first message that passed before 'online'.
  async function shareBeforeOnline() {
    const worker = new Worker(
      'require("node:worker_threads").parentPort.postMessage("first"); setInterval(() => {}, 1000);',
      { eval: true, workerData },
    );
    // The constructor serializes workerData, so the clock starts behind it.
    const start = performance.now();
    let online = NaN;
    worker.once("online", () => {
      online = performance.now() - start;
    });
    const message = await new Promise<number>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`exit ${code} before the entry's first message`)));
      worker.once("message", () => resolve(performance.now() - start));
    });
    ended.push(worker.terminate());
    return online / message;
  }

  // Two workers of three decide, so that one late turn of the parent's loop does not.
  const shares: number[] = [];
  let most = 0;
  let less = 0;
  while (most < 2 && less < 2) {
    const share = await shareBeforeOnline();
    shares.push(share);
    if (share > 0.5) most++;
    else less++;
  }
  await Promise.all(ended);
  assert.strictEqual(
    most,
    2,
    `'online' came after ${shares.map(share => share.toFixed(2)).join(" and ")} of the time to the entry's first message`,
  );
});
