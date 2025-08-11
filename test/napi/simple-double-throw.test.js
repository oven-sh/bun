import { test, expect } from "bun:test";
import { join } from "path";

const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "multiple_exceptions_addon.node");

let addon;
try {
  addon = require(addonPath);
  console.log("Addon loaded successfully");
} catch (error) {
  console.warn("Could not load addon:", error.message);
  addon = null;
}

// Test just one simple function at a time 
test.skipIf(!addon)("simple exception test", () => {
  console.log("About to call throwMultiple...");
  expect(() => {
    const result = addon.throwMultiple();
    console.log("throwMultiple returned:", result);
  }).toThrow();
});