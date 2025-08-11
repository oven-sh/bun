import { test, expect } from "bun:test";
import { join } from "path";

// This test reproduces the bug where multiple ThrowAsJavaScriptException calls
// in the same NAPI function cause Bun to crash with an assertion failure

const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "multiple_exceptions_addon.node");

// Build the addon first if needed
import { spawnSync } from "child_process";
const buildResult = spawnSync("node-gyp", ["build"], { 
  cwd: join(import.meta.dir, "napi-app"),
  stdio: "inherit" 
});

let addon;
try {
  addon = require(addonPath);
} catch (error) {
  console.warn("Could not load multiple_exceptions_addon.node - skipping tests");
  console.warn("Run 'cd test/napi/napi-app && node-gyp build' to build the addon");
  addon = null;
}

test.skipIf(!addon)("throwing after catching exception should not crash Bun", () => {
  expect(() => {
    addon.throwAfterCatch();
  }).toThrow("Second exception after catch");
});

test.skipIf(!addon)("multiple exceptions should not crash - second overwrites first", () => {
  expect(() => {
    addon.throwMultiple();
  }).toThrow("Second exception");
});

test.skipIf(!addon)("exception pending check should work", () => {
  expect(() => {
    const result = addon.checkExceptionPending();
    // This should throw before returning the result
  }).toThrow("Test exception");
});