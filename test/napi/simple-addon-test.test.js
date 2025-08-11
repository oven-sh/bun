import { test, expect } from "bun:test";
import { join } from "path";

test("load simple test addon", () => {
  console.log("Trying to load simple_test_addon");
  
  const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "simple_test_addon.node");
  console.log("Addon path:", addonPath);
  
  try {
    const addon = require(addonPath);
    console.log("Simple addon loaded:", typeof addon);
    console.log("Available methods:", Object.keys(addon));
    
    // Don't call the problematic function yet, just test that we can load it
    expect(typeof addon.testDoubleThrow).toBe("function");
  } catch (error) {
    console.log("Error loading simple addon:", error.message);
    throw error;
  }
});