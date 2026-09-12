// The tools that patch `Module._load` (proxyquire, mock-require, APM agents)
// usually coexist with patches of `Module.prototype.require` and
// `Module._resolveFilename`. Node runs them in that order for every require():
// prototype.require -> _load -> _resolveFilename. The `_load` check therefore
// has to live inside the builtin `prototype.require`, so that an original
// captured before `_load` was patched still reaches the `_load` patch.
const assert = require("assert");
const Module = require("module");

const order = [];

// Captured before the other two hooks are installed.
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  order.push("require:" + id);
  return originalRequire.apply(this, arguments);
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  order.push("_load:" + request);
  return originalLoad.apply(this, arguments);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain) {
  order.push("_resolveFilename:" + request);
  return originalResolveFilename.apply(this, arguments);
};

assert.strictEqual(require("./moduleLoadOverwrite-nested.cjs"), "nested");
assert.deepStrictEqual(order, [
  "require:./moduleLoadOverwrite-nested.cjs",
  "_load:./moduleLoadOverwrite-nested.cjs",
  "_resolveFilename:./moduleLoadOverwrite-nested.cjs",
]);

// Calling the original prototype.require captured before `_load` was patched
// skips only the prototype.require patch; `_load` and `_resolveFilename` still run.
// (A different file: Node skips `_resolveFilename` for a relative request it has
// already resolved from this directory.)
order.length = 0;
assert.strictEqual(originalRequire.call(module, "./moduleLoadOverwrite-fixture-3.cjs"), "three");
assert.deepStrictEqual(order, [
  "_load:./moduleLoadOverwrite-fixture-3.cjs",
  "_resolveFilename:./moduleLoadOverwrite-fixture-3.cjs",
]);

// A direct `Module._load` with a non-module parent hands that same value to
// `_resolveFilename` (not an internal stand-in) and records it as `module.parent`.
const plainParent = { filename: __filename };
let resolveParent;
Module._resolveFilename = function (request, parent) {
  resolveParent = parent;
  return originalResolveFilename.apply(this, arguments);
};
assert.strictEqual(Module._load("./moduleLoadOverwrite-fixture-4.cjs", plainParent, false), "four");
assert.strictEqual(resolveParent, plainParent);
assert.strictEqual(require.cache[require.resolve("./moduleLoadOverwrite-fixture-4.cjs")].parent, plainParent);

Module._resolveFilename = originalResolveFilename;
Module._load = originalLoad;
Module.prototype.require = originalRequire;

console.log("--pass--");
