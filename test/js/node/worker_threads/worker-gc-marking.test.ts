import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { availableParallelism } from "node:os";

// Worker startup and a few full collections under debug/ASAN do not fit in the 5s default.
setDefaultTimeout(isDebug ? 90_000 : 10_000);

// Every heap in the process marks with one helper thread pool, and a helper serves one heap for
// that heap's whole marking phase. With several workers collecting at once the pool was taken and
// a worker's collector waited for it instead of marking (#44186). A worker heap now marks on its
// own thread, so its GC log lines carry no P1..Pn columns, unless it is large and the collection
// is a full one. The main heap keeps the pool, so its lines have the columns (when the machine has
// more than one core: the pool has one helper per core, less one).
//
// The main thread runs one full collection, the worker three. The heaps are told apart by their
// columns, not by the order they log in: the thread-local bytecode cache VM can log too, and it
// never has a pool.
// The two threads write the log to the same stderr, so one line in many can be cut by the other
// heap's output. A heap is classified by the majority of its lines.
const script = `
  import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
  if (!isMainThread) {
    const keep = [];
    for (let i = 0; i < workerData.live; i++) keep.push({ id: "n" + i, i });
    // The first collection can still run before the live size is known. The next two know it.
    Bun.gc(true);
    Bun.gc(true);
    Bun.gc(true);
    parentPort.postMessage(keep.length);
  } else {
    Bun.gc(true);
    const worker = new Worker(new URL(import.meta.url), { workerData: { live: Number(process.env.LIVE) } });
    worker.once("message", () => worker.terminate());
  }
`;

// Counts the heaps that logged a collection, by whether they mark with the pool.
async function countHeaps(env: Record<string, string>, live = 0) {
  using dir = tempDir("worker-gc-marking", { "main.mjs": script });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: { ...env, BUN_JSC_logGC: "1", LIVE: String(live) },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);

  // A marking line looks like: "[GC<0x5423d380108>: START M 1232kb => FullCollection, ... v=143kb (C:143 M:0 P1:0 ... P7:0) ..."
  const heaps = new Map<string, { withPool: number; withoutPool: number }>();
  for (const match of stderr.matchAll(/\[GC<(0x[0-9a-f]+)>:.*?\(C:\d+ M:\d+([^)]*)\)/g)) {
    const [, heap, parallelColumns] = match;
    const counts = heaps.get(heap) ?? { withPool: 0, withoutPool: 0 };
    parallelColumns.includes("P1:") ? counts.withPool++ : counts.withoutPool++;
    heaps.set(heap, counts);
  }
  let parallel = 0;
  let serial = 0;
  for (const { withPool, withoutPool } of heaps.values()) withPool > withoutPool ? parallel++ : serial++;
  return { parallel, serial };
}

test("a worker heap marks on its own thread and the main heap keeps the helper pool", async () => {
  const { parallel, serial } = await countHeaps(bunEnv);
  expect(serial).toBeGreaterThanOrEqual(1);
  if (availableParallelism() > 1) {
    expect(parallel).toBe(1);
  }
});

test("a large worker heap marks a full collection with the helper pool", async () => {
  // 50k small objects are a few MB live. The threshold is set below that.
  const { parallel } = await countHeaps(
    { ...bunEnv, BUN_JSC_largeHeapSizeForSharedMarking: String(1024 * 1024) },
    50_000,
  );
  if (availableParallelism() > 1) {
    expect(parallel).toBe(2);
  }
});

test("BUN_JSC_numberOfGCMarkers applies to worker heaps too", async () => {
  const { parallel } = await countHeaps({ ...bunEnv, BUN_JSC_numberOfGCMarkers: "4" });
  expect(parallel).toBeGreaterThanOrEqual(2);
});
