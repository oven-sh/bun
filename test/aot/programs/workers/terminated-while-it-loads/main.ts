// A Worker is terminated while its modules are still being evaluated: in a long top-level loop, in a top-level await, in an import() of another module, in the initializers of classes and tables. COUNT says how often each.
const entries = ["./long-loop.ts", "./awaits.ts", "./imports-late.ts", "./tables.ts"];
const rounds = Number(process.env.COUNT ?? 6);
for (const entry of entries) {
  let closed = 0;
  const heard = new Set<string>();
  await Promise.all(Array.from({ length: rounds }, async (_, round) => {
    const worker = new Worker(entry);
    worker.onmessage = event => heard.add(event.data);
    worker.onerror = event => (heard.add("error"), event.preventDefault());
    const isClosed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    await new Promise(resolve => setTimeout(resolve, round * 2));
    worker.terminate();
    await isClosed;
    closed++;
  }));
  heard.delete("loading");
  console.log(entry, "closed", closed, [...heard].join());
}
