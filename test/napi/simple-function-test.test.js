import { test, expect } from "bun:test";
import { join } from "path";

test("call simple NAPI function without exceptions", () => {
  console.log("Testing simple NAPI function");
  
  const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "simple_test_addon.node");
  const addon = require(addonPath);
  
  console.log("Available methods:", Object.keys(addon));
  
  // Call the simple function that doesn't throw
  console.log("About to call testSimpleReturn");
  const result = addon.testSimpleReturn();
  console.log("Result:", result);
  
  expect(result).toBe("Hello from simple function!");
});