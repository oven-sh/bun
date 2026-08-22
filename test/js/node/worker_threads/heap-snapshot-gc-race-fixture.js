// Exercise getHeapSnapshot() round-trips against parent-thread full GCs.
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
// The original fix (#30185) heap-allocated the Strong on the parent thread
// and passed only a raw pointer across. Since #31216 the promise is held in
// a parent-side map keyed by reqId (Worker::m_pendingCrossVMRequests) and
// only the id crosses threads, so the worker thread never touches the
// parent VM's HandleSet.

import { Worker } from "node:worker_threads";

const src = `import { parentPort } from "node:worker_threads"; parentPort.on("message", () => {});`;

async function makeWorker() {
  const w = new Worker(src, { eval: true });
  await new Promise(resolve => w.once("online", resolve));
  return w;
}

const iters = Number(process.env.ITERS);
if (!Number.isSafeInteger(iters) || iters <= 0)
  throw new Error(`invalid ITERS (expected a positive integer): ${JSON.stringify(process.env.ITERS)}`);

let worker = await makeWorker();

let completed = 0;
let firstPayloadChecked = false;
for (let i = 0; i < iters; i++) {
  let stream;
  try {
    stream = await worker.getHeapSnapshot();
  } catch (e) {
    // On some CI platforms the worker has been observed to exit on its own
    // after a few hundred heap snapshots — that surfaces here as a clean
    // ERR_WORKER_NOT_RUNNING rejection, not the process-level corruption this
    // fixture is looking for. Recreate the worker and keep going so the
    // overall round-trip count is preserved.
    if (e?.code === "ERR_WORKER_NOT_RUNNING") {
      await worker.terminate().catch(() => {});
      worker = await makeWorker();
      i--;
      continue;
    }
    throw e;
  }
  // Kept from the original repro shape: a synchronous full GC right after
  // the round-trip resolves, where the pre-fix worker thread might still be
  // tearing down its task. Post-#35356 GC cadence this almost never
  // coincides with the worker-side teardown (see the test header), so it is
  // an interleaving exercise, not a reliable race trigger.
  Bun.gc(true);
  let bytes = 0;
  const chunks = firstPayloadChecked ? null : [];
  stream.on("data", chunk => {
    bytes += chunk.length;
    chunks?.push(chunk);
  });
  await new Promise(resolve => stream.once("end", resolve));
  if (bytes === 0) throw new Error(`empty heap snapshot stream on iteration ${i}`);
  if (chunks) {
    // Parse one payload per process to prove the round-trip carries a real
    // snapshot; later iterations only need the cheap non-empty check.
    JSON.parse(Buffer.concat(chunks).toString());
    firstPayloadChecked = true;
  }
  completed++;
}

await worker.terminate();
// The completed count lets the test reject a fixture that silently exited
// early (e.g. ITERS lost in env plumbing would otherwise skip the loop and
// still print a bare "ok").
console.log(`ok ${completed}`);
