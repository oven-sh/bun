const { expect, test } = require("bun:test");
const Module = require("node:module");

// This behavior is required for Next.js to work
test("Module.prototype.require overwrite", () => {
  const old = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === "hook") {
      return "winner";
    }
    return {
      wrap: old.call(this, id),
    };
  };
  // This context has the new require
  const result = require("./modulePrototypeOverwrite-fixture.cjs");
  Module.prototype.require = old;
  expect(result).toEqual({ wrap: "winner" });
});