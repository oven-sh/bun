// `require.cache` and `Module._cache` list the entry point, a CommonJS module and an ES module that have run under `bun run`, and none of them in an executable. The expected output is written down.
const path = require("node:path");
require("./a.cjs");
require("./m.mjs");
const listed = name => Object.keys(require.cache).some(key => path.basename(key) === name);
console.log(listed("main.cjs"), listed("a.cjs") && require.resolve("./a.cjs") in require("node:module")._cache, listed("m.mjs"));
