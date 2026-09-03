import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const memory = require("./leak-metric.cjs");
// require.cache uses the resolved path as its key, not the file:// URL that
// import.meta.resolve returns.
const dest = require.resolve("./esm-leak-fixture-large-ast.mjs");
// The require() sibling of this fixture retained 20 MB per load on bun 1.0.0,
// eight times the limit. Each load parses a 200 KB file, so ASAN runs fewer.
const count = memory.iterations({ release: 50, asan: 10 });

Bun.gc(true);
for (let i = 0; i < 5; i++) {
  delete require.cache[dest];
  await import(dest);
}
// Under any other key the delete does nothing, and the module loads only once.
if (!(dest in require.cache)) throw new Error(`require.cache has no entry for ${dest}`);
Bun.gc(true);
const baseline = memory.measure();

for (let i = 0; i < count; i++) {
  delete require.cache[dest];
  await import(dest);
}
Bun.gc(true);

setTimeout(() => {
  memory.report(memory.measure() - baseline, { count, limitBytesPerIteration: 2.4 * 1024 * 1024 });
}, 16);
