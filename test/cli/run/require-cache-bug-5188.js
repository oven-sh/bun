const { strictEqual, ok } = require("assert");

Loader.registry.set("bad", { evaluated: false });
strictEqual(require.cache.bad, undefined);
ok(!Object.hasOwn(require.cache, "bad"));
ok(!Object.getOwnPropertyNames(require.cache).includes("bad"));

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
