// A validating build looks a method up a second time and builds a second collection to compare with. A request to terminate that arrives there ends the Worker like anywhere else.
let sink: unknown;
const works: Record<string, (n: number) => unknown> = {
  "classes made in a loop": n => { for (let i = 0; i < n; i++) sink = new (class Local { static tag = i; value = i; method() { return this.value; } })().method(); },
  "Maps of constants": n => { let s = 0; for (let i = 0; i < n; i++) { const m = new Map([["a", 1], ["b", 2], ["c", 3]]); m.set("d" + (i % 3), i); for (const [k, v] of m) s += k.length + v; const t = new Set(["x", "y", "z"]); t.add("w" + i); s += t.size; } return s; },
  "Sets of numbers": n => { let s = 0; for (let i = 0; i < n; i++) { const t = new Set([1, 2, 3, 4.5]); t.add(i); s += t.size; } return s; },
};

if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 24);
  const names = Object.keys(works);
  let closed = 0;
  const one = async (name: string, round: number) => {
    const worker = new Worker(new URL(import.meta.url));
    worker.onerror = event => (console.log(name, "ERROR", event.message), event.preventDefault());
    const isClosed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    await new Promise<void>(resolve => {
      worker.onmessage = event => event.data === "works" && resolve();
      worker.postMessage(name);
    });
    const delay = [0, 0, 1, 2, 3][round % 5];
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    worker.terminate();
    await isClosed;
    closed++;
  };
  const jobs = names.flatMap(name => Array.from({ length: rounds }, (_, round) => [name, round] as const));
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < jobs.length) await one(...jobs[next++]);
  }));
  console.log("closed:", closed === jobs.length);
} else {
  addEventListener("message", (event: MessageEvent<string>) => {
    postMessage("works");
    for (;;) sink = works[event.data](2000);
  });
}
