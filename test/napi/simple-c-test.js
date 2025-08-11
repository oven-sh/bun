import { test, expect } from "bun:test";
import { join } from "path";

const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "simple_test_addon.node");

let addon;
try {
  addon = require(addonPath);
  console.log("Simple C addon loaded successfully");
} catch (error) {
  console.warn("Could not load addon:", error.message);
  addon = null;
}

// Test the simple C function that throws two exceptions
test.skipIf(!addon)("C API double throw test", () => {
  console.log("About to call testDoubleThrow...");
  expect(() => {
    const result = addon.testDoubleThrow();
    console.log("testDoubleThrow returned:", result);
  }).toThrow();
});