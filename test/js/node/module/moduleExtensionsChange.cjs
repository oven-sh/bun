const { expect, test } = require("bun:test");
const Module = require("node:module");

test("Module._extensions change", () => {
  const oldCjs = Module._extensions[".cjs"];
  const oldJs = Module._extensions[".js"];
debugger;
  // Test default behavior.
  const defaultResult = require("./moduleExtensionsChange-fixture.cjs");
  expect(defaultResult).toBe("original");

  // Reset.
  delete Module._cache[require.resolve("./moduleExtensionsChange-fixture.cjs")];

  // Test .cjs extension override.
  Module._extensions[".cjs"] = function (mod, filename) {
    mod._compile(`module.exports = "winner";`, filename);
  };
  const changedCjsResult = require("./moduleExtensionsChange-fixture.cjs");
  expect(changedCjsResult).toBe("winner");

  // Reset.
  delete Module._cache[require.resolve("./moduleExtensionsChange-fixture.cjs")];
  if (oldCjs) {
    Module._extensions['.cjs'] = oldCjs;
  } else {
    delete Module._extensions['.cjs'];
  }

  // Test reverted behavior.
  const revertedResult = require("./moduleExtensionsChange-fixture.cjs");
  expect(revertedResult).toBe("original");

  // Reset.
  delete Module._cache[require.resolve("./moduleExtensionsChange-fixture.cjs")];

  // Test fallback to .js.
  Module._extensions[".cjs"] = function (mod, filename) {
    mod._compile(`module.exports = "winner";`, filename);
  };
  const changedJsResult = require("./moduleExtensionsChange-fixture.cjs");
  expect(changedJsResult).toBe("winner");

  // Reset.
  delete Module._cache[require.resolve("./moduleExtensionsChange-fixture.cjs")];
  if (oldJs) {
    Module._extensions['.js'] = oldJs;
  } else {
    delete Module._extensions['.js'];
  }
});