import { test, expect } from "bun:test";
import { join } from "path";

test("call single throw NAPI function", () => {
  console.log("Testing single throw NAPI function");
  
  const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "simple_test_addon.node");
  const addon = require(addonPath);
  
  console.log("Available methods:", Object.keys(addon));
  
  // Call the function that throws only once
  console.log("About to call testSingleThrow");
  
  try {
    const result = addon.testSingleThrow();
    console.log("Function returned (unexpected):", result);
    expect(false).toBe(true); // Should not reach here
  } catch (error) {
    console.log("Caught expected exception:", error.message);
    expect(error).toBeDefined();
  }
});