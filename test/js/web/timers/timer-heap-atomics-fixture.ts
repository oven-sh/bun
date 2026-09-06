// Each worker runs PUMPS rounds of: arm a batch of short Atomics.waitAsync
// timeouts, queue a few setTimeouts, notify. The main thread spins
// Atomics.notify against the same address the whole time, so every worker's
// RunLoop timers are re-armed from a foreign thread while the worker's own
// loop drains them. The loop is bounded by iterations, not by the clock, so a
// slow build gets the same number of cross-thread collisions as a fast one.
declare var self: Worker;

const PUMPS = Number(process.argv[2] ?? 100);
const WORKERS = Number(process.argv[3] ?? 3);

function noop() {}

if (!Bun.isMainThread) {
  self.onmessage = (e: MessageEvent) => {
    const { sab, pumps: total } = e.data as { sab: SharedArrayBuffer; pumps: number };
    const i32 = new Int32Array(sab);
    let pumps = 0;

    function pump() {
      for (let i = 0; i < 48; i++) {
        const w = Atomics.waitAsync(i32, 0, 0, 1 + (i % 7));
        if (w.async) w.value.then(noop);
      }
      for (let i = 0; i < 8; i++) setTimeout(noop, i % 4);
      Atomics.notify(i32, 0, 8);
      if (++pumps < total) {
        setTimeout(pump, 0);
      } else {
        postMessage(pumps);
      }
    }
    pump();
  };
} else {
  const sab = new SharedArrayBuffer(64);
  const i32 = new Int32Array(sab);
  const workers: Worker[] = [];
  let done = 0;
  let pumps = 0;

  for (let w = 0; w < WORKERS; w++) {
    const worker = new Worker(import.meta.url);
    worker.onmessage = (e: MessageEvent) => {
      pumps += e.data as number;
      if (++done === WORKERS) {
        for (const other of workers) other.terminate();
        console.log(`OK ${done} workers ${pumps} pumps`);
        process.exit(0);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      console.error("worker error:", e.message);
      process.exit(3);
    };
    worker.postMessage({ sab, pumps: PUMPS });
    workers.push(worker);
  }

  function hammer() {
    for (let i = 0; i < 24; i++) {
      const w = Atomics.waitAsync(i32, 0, 0, 1 + (i % 5));
      if (w.async) w.value.then(noop);
    }
    const spinUntil = Date.now() + 2;
    while (Date.now() < spinUntil) {
      Atomics.notify(i32, 0, 1);
      Atomics.notify(i32, 0, 1);
      Atomics.notify(i32, 0, 2);
    }
    for (let i = 0; i < 4; i++) setTimeout(noop, i % 3);
    if (done < WORKERS) setTimeout(hammer, 0);
  }
  hammer();
}
