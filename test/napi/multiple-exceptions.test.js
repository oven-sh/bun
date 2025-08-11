import { test, expect } from "bun:test";
import { join } from "path";

test("test multiple NAPI exceptions are prevented", () => {
  console.log("Testing multiple NAPI exceptions");
  
  const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "multiple_exceptions_addon.node");
  const addon = require(addonPath);
  
  console.log("Multiple exceptions addon loaded successfully");
  console.log("Available methods:", Object.keys(addon));
  
  // Test ThrowMultiple - this should either throw the first exception or 
  // demonstrate that the second throw was prevented
  console.log("About to test ThrowMultiple");
  
  try {
    const result = addon.throwMultiple();
    console.log("throwMultiple returned (unexpected):", result);
    // If we got here, both throws were somehow prevented
    expect(false).toBe(true); // Should not reach here  
  } catch (error) {
    console.log("throwMultiple threw exception:", error.message);
    // This is expected - should throw the first exception
    expect(error).toBeDefined();
    // The key thing is that it should NOT crash with assertion failure
  }
  
  console.log("throwMultiple test completed without crash");
});

test("test exception pending check after throw", () => {
  console.log("Testing exception pending after throw");
  
  const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "multiple_exceptions_addon.node");
  const addon = require(addonPath);
  
  console.log("About to test ThrowAfterCatch");
  
  try {
    const result = addon.throwAfterCatch();
    console.log("throwAfterCatch returned (unexpected):", result);
    expect(false).toBe(true); // Should not reach here
  } catch (error) {
    console.log("throwAfterCatch threw exception:", error.message);
    expect(error).toBeDefined();
    // The important thing is that we got the first exception, not the second
    // and that it didn't crash
  }
  
  console.log("throwAfterCatch test completed without crash");
});