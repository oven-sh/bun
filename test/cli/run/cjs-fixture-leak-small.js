const memory = require("./leak-metric.cjs");
const dest = require.resolve("./leak-fixture-small-ast.js");
// bun 1.0.0 retained 10 KB per require here (104 MB at 10k requires), twice
// the limit.
const count = memory.iterations({ release: 10_000 });
// require() appends every new Module to the parent's children list, as in
// Node. That list is not what this fixture measures.
module.children = { indexOf: () => 0 };

Bun.gc(true);
for (let i = 0; i < 5; i++) {
  delete require.cache[dest];
  require(dest);
}
Bun.gc(true);
const baseline = memory.measure();

for (let i = 0; i < count; i++) {
  delete require.cache[dest];
  require(dest);
}
Bun.gc(true);

setTimeout(() => {
  memory.report(memory.measure() - baseline, { count, limitBytesPerIteration: 4800 });
}, 16);
