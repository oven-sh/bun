// Creates Bun.Transpiler instances whose options allocate into the instance's own
// mimalloc heap (a `define` value that goes through the JSON parser, or an
// `exports.replace` value), lets a hundred of them pile up, then collects them
// in one GC. Prints the RSS growth across three such batches as
// `{"deltaMiB": n}` on the last stdout line for `expectRssDeltaBelow`.
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

const shape = process.argv[2];
const opts =
  shape === "exports"
    ? { loader: "ts", exports: { replace: { foo: "bar" } } }
    : { loader: "ts", define: { "process.env.FOO": '"bar"' } };

const perBatch = 100;

function batch() {
  for (let i = 0; i < perBatch; i++) new Bun.Transpiler(opts as Bun.TranspilerOptions);
  Bun.gc(true);
}

// Warm up: arena reservation, the first batch of finalizers.
batch();
await Bun.sleep(200);
Bun.gc(true);
const before = rss();

for (let b = 0; b < 3; b++) batch();

// Give the allocator's idle sweep the chance it gets in a real server.
await Bun.sleep(300);
Bun.gc(true);
console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1024 / 1024 }));
