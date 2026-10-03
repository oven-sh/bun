const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const [mode, spelling, root] = process.argv.slice(2);
const filename = path.join(root, "target.mjs");
fs.writeFileSync(
  filename,
  'globalThis.aliasLoads = (globalThis.aliasLoads || 0) + 1; export const value = "loaded"; export const marker = {};',
);
const target =
  spelling === "forward" ? filename.replaceAll("\\", "/") : root + path.sep + "." + path.sep + "target.mjs";
const requireFromRoot = Module.createRequire(path.join(root, "entry.cjs"));
if (mode === "override") {
  const original = Module._resolveFilename;
  Module._resolveFilename = function (specifier, ...args) {
    return specifier === "resolved-key-alias" ? target : original.call(this, specifier, ...args);
  };
} else {
  Bun.plugin({
    name: "resolved-key",
    setup(builder) {
      builder.onResolve({ filter: /^resolved-key-alias$/ }, () => ({ path: target, namespace: "file" }));
    },
  });
}
async function main() {
  const loaded = requireFromRoot("resolved-key-alias");
  assert.equal(loaded.value, "loaded");
  assert.equal(requireFromRoot("resolved-key-alias"), loaded);
  assert.equal(globalThis.aliasLoads, 1);
  if (mode === "plugin") {
    const imported = await import("resolved-key-alias");
    assert.equal(imported.marker, loaded.marker);
    assert.equal(globalThis.aliasLoads, 1);
  }
  console.log("ok");
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
