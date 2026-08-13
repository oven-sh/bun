// `Module._load` is the documented-by-convention hook that proxyquire,
// mock-require, require-in-the-middle, and friends monkey-patch to intercept
// every `require()`. Node routes `Module.prototype.require` through it.
const assert = require("assert");
const eql = assert.strictEqual;
const path = require("path");
const vm = require("vm");
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

// Direct calls to the unpatched Module._load. Each file below is loaded for the
// first time here, so each call exercises a real load and records `parent`.
const fixture2 = path.join(__dirname, "moduleLoadOverwrite-fixture-2.cjs");
const fixture3 = path.join(__dirname, "moduleLoadOverwrite-fixture-3.cjs");
const fixture4 = path.join(__dirname, "moduleLoadOverwrite-fixture-4.cjs");
const fixture5 = path.join(__dirname, "moduleLoadOverwrite-fixture-5.cjs");

// https://github.com/oven-sh/bun/issues/5925: the `eval` npm package (used by
// Docusaurus' SSG) builds its `require` shim as `Module._load(file, parentModule)`
// and evaluates it inside `vm.runInNewContext`.
eql(
  vm.runInNewContext("Module._load(file, parentModule)", {
    Module,
    file: "./moduleLoadOverwrite-fixture-2.cjs",
    parentModule: module,
  }),
  "direct",
);
eql(require.cache[fixture2].parent, module);

// No parent: `module.parent` is undefined.
eql(Module._load(fixture3), "three");
eql(require.cache[fixture3].parent, undefined);

// A plain `{ filename }` parent anchors relative resolution and is recorded as-is.
const plainParent = { filename: here };
eql(Module._load("./moduleLoadOverwrite-fixture-4.cjs", plainParent, false), "four");
eql(require.cache[fixture4].parent, plainParent);
eql(typeof Module._load("fs", plainParent).readFileSync, "function");

// `null` is recorded as-is. `isMain` makes `require.main === module` inside the
// file in Node; Bun keeps `require.main` pointed at the entry point (documented
// in docs/runtime/nodejs-compat.mdx), so this pins the divergence.
const five = Module._load(fixture5, null, true);
eql(five.parent, null);
eql(five.isMain, typeof Bun === "undefined");

console.log("--pass--");
