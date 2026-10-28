// Sixty-four Workers run at once; each makes typed objects, strings, maps and closures of the same compiled code, collects, and answers; all answers are the same as the main thread's own.
interface Shape {
  area(): number;
}
class Circle implements Shape {
  constructor(public radius: number) {}
  area(): number {
    return Math.round(this.radius * this.radius * 3);
  }
}
class Square implements Shape {
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
}
type Entry = { key: string; shape: Shape; tags: string[] };
function work(seed: number): string {
  const byKey = new Map<string, Entry>();
  let total = 0;
  for (let i = 0; i < 10_000; i++) {
    const shape: Shape = (i + seed) % 3 === 0 ? new Circle(i % 17) : new Square(i % 13);
    const entry: Entry = { key: "k" + (i % 500), shape, tags: [`t${i % 7}`, String(i % 5)] };
    byKey.set(entry.key, entry);
    total += shape.area() + entry.tags.join("").length;
  }
  const names = [...byKey.values()].map(entry => entry.key + entry.shape.constructor.name[0]).sort().slice(0, 3);
  return total + " " + byKey.size + " " + names.join();
}

if (Bun.isMainThread) {
  const count = Number(process.env.COUNT ?? 64);
  const expected = work(1);
  const workers = Array.from({ length: count }, () => new Worker(new URL(import.meta.url)));
  const answers = await Promise.all(workers.map(worker => new Promise<string>(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => resolve("error: " + event.message);
    worker.postMessage(1);
  })));
  console.log("as here:", answers.filter(answer => answer === expected).length === count, expected);
  for (const answer of new Set(answers)) if (answer !== expected) console.log("another answer:", answer);
  await Promise.all(workers.map(worker => new Promise<void>(resolve => {
    worker.addEventListener("close", () => resolve());
    worker.terminate();
  })));
  console.log("all closed");
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    let answer = "";
    for (let round = 0; round < 2; round++) {
      answer = work(event.data);
      Bun.gc(true);
    }
    postMessage(answer);
  });
}
