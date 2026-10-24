// That the program names `process.mainModule` changes nothing about the cache: it lists no module of the executable, and `delete` does nothing to one. An ES module that `import()` has loaded is known to
// the engine's own registry of modules, which the cache also shows under `bun run`. The expected text is the executable's.
const path = require("node:path");
console.log(process.mainModule === module);
const listed = name => Object.keys(require.cache).some(key => path.basename(key) === name);
import("./counted.mjs").then(first => {
  const key = require.resolve("./counted.mjs");
  console.log(first.runs, listed("counted.mjs"), key in require.cache, require.cache[key]);
  console.log(delete require.cache[key]);
  return import("./counted.mjs").then(second => console.log(second.runs, second === first, listed("main.cjs")));
});
