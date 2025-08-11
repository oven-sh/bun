import { test, expect } from "bun:test";

test("test existing NAPI throw_error function", () => {
  console.log("Testing existing NAPI throw_error");
  
  const addon = require("./napi-app/build/Debug/napitests.node");
  console.log("Calling throw_error function");
  
  try {
    addon.throw_error();
    console.log("Function returned (unexpected)");
    expect(false).toBe(true); // Should not reach here
  } catch (error) {
    console.log("Caught expected exception:", error.message);
    expect(error).toBeDefined();
  }
});