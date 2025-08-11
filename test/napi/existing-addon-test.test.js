import { test, expect } from "bun:test";

test("use existing napitests addon", () => {
  console.log("Testing existing NAPI addon");
  
  try {
    const addon = require("./napi-app/build/Debug/napitests.node");
    console.log("Existing addon loaded successfully");
    console.log("Available methods:", Object.keys(addon));
    
    // Try calling a simple method if available
    if (addon.hello) {
      console.log("About to call hello");
      const result = addon.hello();
      console.log("Result:", result);
    }
  } catch (error) {
    console.log("Error with existing addon:", error.message);
    throw error;
  }
});