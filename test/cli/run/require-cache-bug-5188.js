const { strictEqual, ok } = require("assert");

// The synthetic "manually insert an unevaluated entry via Loader.registry.set"
// case was removed: the JSC module loader is now pure C++ and no longer exposes
// a writable JS registry. The msgpackr-extract path below covers the original
// bug (#5188) end-to-end.

// hard to simplify this test case, but importing this would cause require.cache.extract to be set
require("msgpackr-extract");

strictEqual(require.cache["extract"], undefined);
ok(!("extract" in require.cache)); // https://github.com/oven-sh/bun/issues/5898
ok(!Object.hasOwnProperty.call(require.cache, "extract"));
ok(!Object.getOwnPropertyNames(require.cache).includes("extract"));

for (const key of Object.keys(require.cache)) {
  if (!require.cache[key]) {
    throw new Error("require.cache has an undefined value that was in it's keys");
  }
}

console.log("--pass--");
