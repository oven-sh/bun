// Several APIs give the calling thread a private mimalloc heap and keep it around for the next call:
// Bun.{TOML,YAML,JSON5,JSONC,XML}.parse park one between calls, the module loader keeps one per VM for
// transpiling. mimalloc does not destroy such heaps when their thread exits, so unless the Worker's VM
// teardown frees them, every Worker that used one of these APIs leaks a heap plus whatever pages it
// still holds. heapStats({ dump: true }) lists every live heap in the process, so the count must not
// grow with the number of Workers that have come and gone.
const { Worker, isMainThread } = require("node:worker_threads");

if (!isMainThread) {
  Bun.TOML.parse("a = 1");
  Bun.YAML.parse("a: 1");
  Bun.JSON5.parse("{ a: 1 }");
  Bun.JSONC.parse('{ /* a */ "a": 1 }');
  Bun.XML.parse("<a>1</a>");
  new Bun.Transpiler().transformSync("export const b = 2;");
  await import("data:text/javascript,export default 1");
} else {
  const { heapStats } = require("bun:jsc");
  const liveHeaps = () => heapStats({ dump: true }).mimallocDump.heaps.length;

  const runWorker = () =>
    new Promise((resolve, reject) => {
      const worker = new Worker(__filename);
      worker.on("error", reject);
      worker.on("exit", code => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
    });

  // Whatever the process sets up lazily for its first Worker is part of the baseline.
  await runWorker();
  const before = liveHeaps();
  const workers = 3;
  for (let i = 0; i < workers; i++) await runWorker();
  console.log(JSON.stringify({ workers, leaked: liveHeaps() - before }));
}
