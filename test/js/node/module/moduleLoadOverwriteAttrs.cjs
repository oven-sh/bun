// Bun extension (not in Node): `require(id, options)` supports `{ type }`
// import attributes and `{ paths }`. Both must survive the `Module._load`
// dispatch. They ride through as a 4th argument, which the universal patch
// idiom `originalLoad.apply(this, arguments)` forwards; a 1-argument
// `require()` still presents Node's exact `(request, parent, isMain)` shape.
const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;

const calls = [];
Module._load = function (request, parent, isMain) {
  calls.push([request, arguments.length]);
  return originalLoad.apply(this, arguments);
};

// Without `{ type: "json" }` a `.txt` file loads as text; with it, as JSON.
assert.deepStrictEqual(require("./moduleLoadOverwrite-attrs.txt", { type: "json" }), { attr: true });
assert.strictEqual(typeof require("fs").readFileSync, "function");

assert.deepStrictEqual(calls, [
  ["./moduleLoadOverwrite-attrs.txt", 4],
  ["fs", 3],
]);

Module._load = originalLoad;
console.log("--pass--");
