import assert from "node:assert";
import foo from "./foo.yaml";
assert(foo);
assert.equal(typeof foo, "object");
// bun-plugin-yaml only exports a plugin factory (it registers nothing), and
// .yaml imports work natively, so the import above does not prove the preload
// ran. Its presence in the module cache does.
assert(require.resolve("bun-plugin-yaml") in require.cache, "bunfig preload was not loaded");
