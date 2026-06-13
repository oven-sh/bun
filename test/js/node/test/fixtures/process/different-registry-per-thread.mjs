import { isMainThread, Worker } from 'node:worker_threads';

// Bun note: the registry holds the target weakly (same as Node). Bun's GC is
// eager enough to collect an otherwise-unreferenced literal before exit, so
// keep module-level references; this test is about per-thread registries,
// not collection timing.
if (isMainThread) {
  const obj = { foo: 'foo' };
  process.finalization.register(obj, () => {
    // Referencing `obj` from the callback keeps it reachable; the registry
    // itself only holds it weakly.
    if (obj.foo === 'foo') process.stdout.write('shutdown on main thread\n');
  });

  const worker = new Worker(import.meta.filename);

  worker.postMessage('ping');
} else {
  const obj = { foo: 'bar' };
  process.finalization.register(obj, () => {
    if (obj.foo === 'bar') process.stdout.write('shutdown on worker\n');
  });
}
