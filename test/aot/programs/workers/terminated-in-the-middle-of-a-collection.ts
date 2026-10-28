// A Worker makes garbage and collects without a rest, and is terminated at a moment of the main thread's choice. COUNT says how often.
type Node = { id: number; next: Node | null; name: string; list: number[] };
function chain(length: number): Node | null {
  let head: Node | null = null;
  for (let i = 0; i < length; i++) head = { id: i, next: head, name: "n" + i, list: [i, i + 0.5] };
  return head;
}

if (Bun.isMainThread) {
  const count = Number(process.env.COUNT ?? 24);
  let closed = 0;
  for (let round = 0; round < count; round += 4) {
    const all: Promise<void>[] = [];
    for (let i = 0; i < 4; i++) {
      const worker = new Worker(new URL(import.meta.url));
      const started = new Promise<void>(resolve => (worker.onmessage = () => resolve()));
      all.push(
        (async () => {
          await started;
          await new Promise(resolve => setTimeout(resolve, (round * 7 + i * 3) % 23));
          const isClosed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
          worker.terminate();
          await isClosed;
          closed++;
        })(),
      );
    }
    await Promise.all(all);
    chain(1000);
    Bun.gc(true);
  }
  console.log("closed:", closed >= count);
} else {
  postMessage("started");
  const kept: (Node | null)[] = [];
  for (let round = 0; ; round++) {
    kept[round % 16] = chain(2000);
    Bun.gc(round % 2 === 0);
  }
}
