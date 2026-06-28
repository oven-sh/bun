// `Module._load` is the documented-by-convention hook that proxyquire,
// mock-require, require-in-the-middle, and friends monkey-patch to intercept
// every `require()`. Node routes `Module.prototype.require` through it.
const assert = require("assert");
const eql = assert.strictEqual;
const path = require("path");
const Module = require("module");

const originalLoad = Module._load;
eql(typeof originalLoad, "function");

const calls = [];
Module._load = function (request, parent, isMain) {
  // Node invokes Module._load as a method of `Module`.
  eql(this, Module);
  calls.push([request, parent && parent.filename, isMain]);
  if (request === "__virtual__") return { virtual: true };
  return originalLoad.apply(this, arguments);
};

// The property round-trips through the accessor.
eql(Module._load !== originalLoad, true);

// `require()` goes through the patch: a fresh file (whose own nested require
// must also be seen, with the nested module as `parent`), a virtual module
// served without touching the filesystem, and a builtin.
eql(require("./moduleLoadOverwrite-fixture.cjs"), "real+nested");
assert.deepStrictEqual(require("__virtual__"), { virtual: true });
eql(typeof require("fs").readFileSync, "function");

const here = __filename;
const fixture = path.join(__dirname, "moduleLoadOverwrite-fixture.cjs");
assert.deepStrictEqual(calls, [
  ["./moduleLoadOverwrite-fixture.cjs", here, false],
  ["./moduleLoadOverwrite-nested.cjs", fixture, false],
  ["__virtual__", here, false],
  ["fs", here, false],
]);

// A module loaded through the forwarded original lands in require.cache.
eql(require.cache[fixture].exports, "real+nested");

// Restoring the original takes require() off the patched path.
Module._load = originalLoad;
eql(Module._load, originalLoad);
require("assert");
eql(calls.length, 4);

// Direct calls to the unpatched Module._load perform a real load. Node also
// accepts a plain `{ filename }` parent or no parent at all.
eql(Module._load("./moduleLoadOverwrite-fixture-2.cjs", module, false), "direct");
eql(Module._load(path.join(__dirname, "moduleLoadOverwrite-fixture-2.cjs")), "direct");
eql(typeof Module._load("fs", { filename: here }).readFileSync, "function");

console.log("--pass--");
