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
// The main thread runs one full collection before the worker exists, so the first heap in the
// log is the main heap, and the worker's is the only other one. The worker runs three.
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

// Classifies the main heap and the worker heap by whether they mark with the pool.
async function classifyHeaps(env: Record<string, string>, live = 0) {
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
  // Windows prints the heap address in upper case, and may leave out the 0x.
  const heaps = new Map<string, { withPool: number; withoutPool: number }>();
  for (const match of stderr.matchAll(/\[GC<((?:0x)?[0-9a-fA-F]+)>:.*?\(C:\d+ M:\d+([^)]*)\)/g)) {
    const [, heap, parallelColumns] = match;
    const counts = heaps.get(heap) ?? { withPool: 0, withoutPool: 0 };
    parallelColumns.includes("P1:") ? counts.withPool++ : counts.withoutPool++;
    heaps.set(heap, counts);
  }
  const [main, worker, ...rest] = [...heaps.values()].map(({ withPool, withoutPool }) =>
    withPool > withoutPool ? "pool" : "own thread",
  );
  expect(rest).toEqual([]);
  return { main, worker };
}

test.concurrent("a worker heap marks on its own thread and the main heap keeps the helper pool", async () => {
  const { main, worker } = await classifyHeaps(bunEnv);
  expect(worker).toBe("own thread");
  if (availableParallelism() > 1) {
    expect(main).toBe("pool");
  }
});

test.concurrent("a large worker heap marks a full collection with the helper pool", async () => {
  // 50k small objects are a few MB live. The threshold is set below that.
  const { main, worker } = await classifyHeaps(
    { ...bunEnv, BUN_JSC_largeHeapSizeForSharedMarking: String(1024 * 1024) },
    50_000,
  );
  if (availableParallelism() > 1) {
    expect({ main, worker }).toEqual({ main: "pool", worker: "pool" });
  }
});

test.concurrent("BUN_JSC_numberOfGCMarkers applies to worker heaps too", async () => {
  const { main, worker } = await classifyHeaps({ ...bunEnv, BUN_JSC_numberOfGCMarkers: "4" });
  expect({ main, worker }).toEqual({ main: "pool", worker: "pool" });
});
