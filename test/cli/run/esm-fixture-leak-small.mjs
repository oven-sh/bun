import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const memory = require("./leak-fixture-memory.cjs");
const dest = require.resolve("./leak-fixture-small-ast.js");
const count = memory.iterations(100_000);

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
  // bun 1.0.0 retained about 1 KB per import here:
  //
  // ❯ bunx bun@1.0.0 --smol test/cli/run/esm-fixture-leak-small.mjs
  // { leaked: "100 MB" }
  // ❯ bunx bun@1.1.0 --smol test/cli/run/esm-fixture-leak-small.mjs
  // { leaked: "38 MB" }
  memory.report(memory.measure() - baseline, { count, limitBytesPerIteration: 1024 });
}, 24);
