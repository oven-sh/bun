import { expect, test } from "bun:test";
import { once } from "events";
import { Worker } from "worker_threads";

// The transferList option is converted as a whole before workerData is serialized,
// so an entry that is not an object throws instead of being silently skipped while
// the remaining entries get detached.
test("an invalid transferList entry throws before anything is detached", async () => {
  const buf = new ArrayBuffer(8);
  let worker: Worker | undefined;
  try {
    expect(() => {
      worker = new Worker("", { eval: true, workerData: buf, transferList: [buf, null as any] });
    }).toThrow(TypeError);
    expect(buf.byteLength).toBe(8);
  } finally {
    await worker?.terminate();
  }
});

test("a valid transferList still detaches the transferred buffer", async () => {
  const buf = new ArrayBuffer(8);
  const worker = new Worker("", { eval: true, workerData: buf, transferList: [buf] });
  // Captured before any await: the transfer detaches buf synchronously in the constructor.
  const len = buf.byteLength;
  try {
    // Let startup finish before terminate(): terminate() mid-preload trips
    // JSModuleLoader::continueDynamicImport's scope.assertNoException() on the
    // pending TerminationException (debug/ASAN only).
    await once(worker, "online");
    expect(len).toBe(0);
  } finally {
    await worker.terminate();
  }
});
