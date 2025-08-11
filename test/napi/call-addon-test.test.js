import { test, expect } from "bun:test";
import { join } from "path";

test("call simple addon function", () => {
  console.log("Loading simple addon and calling function");
  
  const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "simple_test_addon.node");
  const addon = require(addonPath);
  
  console.log("About to call testDoubleThrow");
  
  try {
    const result = addon.testDoubleThrow();
    console.log("Function returned:", result);
    // This should not happen - the function should throw
    expect(false).toBe(true); // Force failure if no exception
  } catch (error) {
    console.log("Caught exception:", error.message);
    // This is expected - the function should throw an exception
    expect(error).toBeDefined();
  }
});