// A Worker is started, answers once and is terminated, many times in a row. COUNT says how often.
type Point = { x: number; y: number };
function length(point: Point): number {
  return Math.sqrt(point.x * point.x + point.y * point.y);
}

if (Bun.isMainThread) {
  const count = Number(process.env.COUNT ?? 100);
  let sum = 0;
  for (let round = 0; round < count; round++) {
    const worker = new Worker(new URL(import.meta.url));
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    sum += await new Promise<number>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage({ x: 3, y: 4 });
    });
    worker.terminate();
    await closed;
  }
  console.log("answers:", sum / 5 === count);
} else {
  addEventListener("message", (event: MessageEvent<Point>) => postMessage(length(event.data)));
}
