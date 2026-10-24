// `delete require.cache[path]`. Under `bun run` the next require() runs the module again. A CommonJS module of an executable runs at most once and is not in `require.cache`, as in `bun build --compile` without --aot. The expected output is written down.
const a = require("./a.cjs"),
  key = require.resolve("./a.cjs"),
  had = key in require.cache;
delete require.cache[key];
console.log(a.n, require("./a.cjs").n, had);
function fresh() {
  delete require.cache[require.resolve("./a.cjs")];
  return require("./a.cjs");
}
const held = require("./a.cjs");
console.log(held.n, fresh().n);
