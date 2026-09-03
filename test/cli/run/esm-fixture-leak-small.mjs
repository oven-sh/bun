import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const memory = require("./leak-metric.cjs");
const dest = require.resolve("./leak-fixture-small-ast.js");
// bun 1.0.0 retained 0.9 KB per import here (92 MB at 100k imports). At 40k
// imports that is twice the limit.
const count = memory.iterations({ release: 40_000 });

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
  memory.report(memory.measure() - baseline, { count, limitBytesPerIteration: 400 });
}, 24);
