import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const memory = require("./leak-fixture-memory.cjs");
const dest = await import.meta.resolve("./esm-leak-fixture-large-ast.mjs");
const count = memory.iterations(50);

Bun.gc(true);
for (let i = 0; i < 5; i++) {
  delete require.cache[dest];
  await import(dest);
}
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
