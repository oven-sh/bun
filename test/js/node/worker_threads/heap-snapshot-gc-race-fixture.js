// Race getHeapSnapshot() round-trips against parent-thread Strong handle churn.
//
// Each getHeapSnapshot() round-trip used to capture a parent-VM
// Strong<JSPromise> by value in a lambda that ran on the worker thread.
// Strong<T> has no move constructor, so the worker thread copy-constructed
// (StrongSet::allocate) and destroyed (StrongSet::deallocate) a handle of the
// parent VM without holding the parent VM's lock. StrongSet is a plain slab
// allocator (bump cursor, free list, per-block used count) with no lock check
// of its own, so a parent-thread allocate or free that overlaps either
// worker-side call tears it: the next parent allocate faults on a bogus slot
// (StrongSet::tryAllocateFromCurrent), a RELEASE_ASSERT fires on the torn
// used count (StrongBlock::decrementUsedCount) or block bookkeeping
// (StrongSet::didFreeSlot), or two handles share one slot and one of them
// silently changes value.
//
// The parent VM's StrongSet only changes when code on the parent thread
// allocates or frees a handle, so a parent that idles while the snapshot is
// built never overlaps the worker's two calls. This fixture keeps the parent
// inside those calls as densely as JS can: convertTransferList
// (JSStructuredSerializeOptions.cpp) turns every entry of a structuredClone()
// transfer list into a Strong<JSObject> before SerializedScriptValue::create
// validates the entries, and a list of plain objects is rejected right after
// that conversion (DataCloneError). Each call is therefore a burst of Strong
// allocate/free pairs and little else. If the transfer list is ever validated
// before it is converted, this churn stops allocating handles and the fixture
// goes blind without failing, so keep that order in mind when changing it.
//
// With the bug reintroduced on a release build (16 cores), a round-trip
// corrupts the parent VM's StrongSet about half of the time and 100 of 100
// processes crashed within 10 round-trips. The overlap needs true
// parallelism: pinned to one core, only 2 of 5 test runs caught it.
//
// The fix (#30185, reshaped by #31216) registers the promise in a parent-side
// map keyed by a request id; only the id crosses threads. This fixture covers
// the getHeapSnapshot() site only. The durable guard, a lock-held assert in
// StrongSet::allocate/deallocate, would catch every cross-VM site on the
// first call in a debug build and is still to be ported (#36958).

import { Worker } from "node:worker_threads";

const iters = Number(process.env.ITERS);
if (!Number.isSafeInteger(iters) || iters <= 0) {
  throw new Error(`invalid ITERS (expected a positive integer): ${JSON.stringify(process.env.ITERS)}`);
}

const worker = new Worker(`import { parentPort } from "node:worker_threads"; parentPort.on("message", () => {});`, {
  eval: true,
});
worker.on("error", error => {
  throw error;
});
const workerExit = new Promise(resolve => worker.once("exit", resolve));
await new Promise(resolve => worker.once("online", resolve));

const transferList = Array.from({ length: 64 }, () => ({}));
function churnStrongHandles() {
  try {
    structuredClone(0, { transfer: transferList });
  } catch (error) {
    if (error?.name === "DataCloneError") return;
    throw error;
  }
  throw new Error("structuredClone() accepted a transfer list of plain objects");
}

let snapshots = 0;
let validated = false;
for (let i = 0; i < iters; i++) {
  let settled = false;
  const pending = worker.getHeapSnapshot();
  pending.then(
    () => (settled = true),
    () => (settled = true),
  );
  // Churn until the worker has posted the result, yielding to the event loop
  // so the completion task can run. The worker thread's two touches of the
  // parent VM's StrongSet happen right after the snapshot JSON is built.
  while (!settled) {
    for (let k = 0; k < 100 && !settled; k++) churnStrongHandles();
    await new Promise(resolve => setImmediate(resolve));
  }
  const stream = await pending;
  snapshots++;
  // Marking walks every StrongSet slot. A full collection right after the
  // round-trip makes a slot left holding garbage fail here, while the handle
  // of this round-trip is still live, instead of at some later collection.
  Bun.gc(true);

  const chunks = [];
  stream.on("data", chunk => chunks.push(chunk));
  await new Promise((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  if (chunks.length === 0) throw new Error(`empty heap snapshot stream on iteration ${i}`);
  if (!validated) {
    // Parse one payload per process to prove the round-trip carries a real
    // V8-format heap snapshot; later iterations only need the non-empty check.
    const snapshot = JSON.parse(Buffer.concat(chunks).toString());
    const nodeCount = snapshot.snapshot.node_count;
    const nodeFields = snapshot.snapshot.meta.node_fields.length;
    if (!(nodeCount > 0) || snapshot.nodes.length !== nodeCount * nodeFields) {
      throw new Error(`malformed heap snapshot: node_count=${nodeCount}, nodes.length=${snapshot.nodes.length}`);
    }
    validated = true;
  }
}

await worker.terminate();
console.log(`ok snapshots=${snapshots} workerExitCode=${await workerExit}`);
