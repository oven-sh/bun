// Stress getHeapSnapshot() against a parent-thread full GC.
//
// Each getHeapSnapshot() round-trip used to capture a parent-VM
// Strong<JSPromise> by value in a lambda that ran on the worker thread.
// Strong<T> has no move constructor, so the worker thread would
// copy-construct (HandleSet::allocate + m_strongList.push) and destruct
// (HandleSet::deallocate + m_strongList.remove) the handle without holding
// the parent VM's lock. If the parent VM's GC ran the "Sh" (Strong Handles)
// marking constraint at the same time it would iterate into a torn
// SentinelLinkedList node and fault reading HandleNode::m_value at
// (nullptr + 0x10).
//
// The fix heap-allocates the Strong once on the parent thread and passes
// only the raw pointer across, so the worker thread never touches the
// parent VM's HandleSet.

import { Worker } from "node:worker_threads";

const src = `import { parentPort } from "node:worker_threads"; parentPort.on("message", () => {});`;

async function makeWorker() {
  const w = new Worker(src, { eval: true });
  await new Promise(resolve => w.once("online", resolve));
  return w;
}

let worker = await makeWorker();

const iters = Number(process.env.ITERS);
for (let i = 0; i < iters; i++) {
  let stream;
  try {
    stream = await worker.getHeapSnapshot();
  } catch (e) {
    // On some CI platforms the worker has been observed to exit on its own
    // after a few hundred heap snapshots — that surfaces here as a clean
    // ERR_WORKER_NOT_RUNNING rejection, not the process-level segfault this
    // fixture is looking for. Recreate the worker and keep going so the
    // overall round-trip count (and thus the number of race opportunities
    // against the parent VM's HandleSet) is preserved.
    if (e?.code === "ERR_WORKER_NOT_RUNNING") {
      await worker.terminate().catch(() => {});
      worker = await makeWorker();
      i--;
      continue;
    }
    throw e;
  }
  // Right now the worker thread has posted the result (resolving the await
  // above) but may still be destroying its outer EventLoopTask. Force a
  // synchronous full GC so the "Sh" constraint walks m_strongList while
  // the worker would have been removing a node from it.
  Bun.gc(true);
  stream.on("data", () => {});
  await new Promise(resolve => stream.once("end", resolve));
}

await worker.terminate();
console.log("ok");
