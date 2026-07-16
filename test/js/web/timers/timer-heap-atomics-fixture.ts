declare var self: Worker;

const DURATION_MS = Number(process.argv[2] ?? 3000);
const WORKERS = Number(process.argv[3] ?? 3);

function noop() {}

if (!Bun.isMainThread) {
  self.onmessage = (e: MessageEvent) => {
    const { sab, durationMs } = e.data as { sab: SharedArrayBuffer; durationMs: number };
    const i32 = new Int32Array(sab);
    const deadline = Date.now() + durationMs;

    function pump() {
      for (let i = 0; i < 48; i++) {
        const w = Atomics.waitAsync(i32, 0, 0, 1 + (i % 7));
        if (w.async) w.value.then(noop);
      }
      for (let i = 0; i < 8; i++) setTimeout(noop, i % 4);
      Atomics.notify(i32, 0, 8);
      if (Date.now() < deadline) {
        setTimeout(pump, 0);
      } else {
        postMessage("done");
      }
    }
    pump();
  };
} else {
  const sab = new SharedArrayBuffer(64);
  const i32 = new Int32Array(sab);
  const workers: Worker[] = [];
  let done = 0;

  for (let w = 0; w < WORKERS; w++) {
    const worker = new Worker(import.meta.url);
    worker.onmessage = () => {
      if (++done === WORKERS) {
        for (const other of workers) other.terminate();
        console.log("OK");
        process.exit(0);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      console.error("worker error:", e.message);
      process.exit(3);
    };
    worker.postMessage({ sab, durationMs: DURATION_MS });
    workers.push(worker);
  }

  const deadline = Date.now() + DURATION_MS + 1000;
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
    if (Date.now() < deadline && done < WORKERS) setTimeout(hammer, 0);
  }
  hammer();
}
