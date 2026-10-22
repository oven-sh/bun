// `require.cache[path].exports = ..`. Under `bun run` the next require() answers the stored value. `require.cache` of an executable has no entry for a module of the executable. The expected output is written down.
require("./a.cjs");
const entry = require.cache[require.resolve("./a.cjs")];
console.log(typeof entry);
if (entry) entry.exports = { x: 2 };
console.log(require("./a.cjs").x);
