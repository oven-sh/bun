const memory = require("./leak-metric.cjs");
const dest = require.resolve("./require-cache-bug-leak-fixture-large-ast.js");
// bun 1.0.0 retained 20 MB per load here, eight times the limit. Each load
// parses a 200 KB file, so ASAN runs fewer.
const count = memory.iterations({ release: 50, asan: 10 });
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
  memory.report(memory.measure() - baseline, { count, limitBytesPerIteration: 2.4 * 1024 * 1024 });
}, 16);
