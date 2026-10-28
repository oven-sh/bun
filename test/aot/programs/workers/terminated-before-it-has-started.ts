// A Worker is terminated at once, or a few microtasks or milliseconds behind its start: at any point of its start. COUNT says how often.
class Counter {
  count = 0;
  add(by: number): number {
    return (this.count += by);
  }
}

if (Bun.isMainThread) {
  const count = Number(process.env.COUNT ?? 96);
  let closed = 0;
  for (let round = 0; round < count; round += 8) {
    const all: Promise<void>[] = [];
    for (let i = 0; i < 8; i++) {
      const worker = new Worker(new URL(import.meta.url));
      all.push(new Promise<void>(resolve => worker.addEventListener("close", () => (closed++, resolve()))));
      const kind = (round / 8 + i) % 4;
      if (kind === 0) worker.terminate();
      else if (kind === 1) queueMicrotask(() => worker.terminate());
      else if (kind === 2) setTimeout(() => worker.terminate(), i % 5);
      else setImmediate(() => worker.terminate());
    }
    await Promise.all(all);
  }
  console.log("closed:", closed >= count);
} else {
  const counter = new Counter();
  for (let i = 0; i < 100_000; i++) counter.add(i % 3);
  postMessage(counter.count);
  setInterval(() => counter.add(1), 1);
}
