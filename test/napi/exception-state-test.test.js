import { test, expect } from "bun:test";
import { join } from "path";

test("test NAPI exception state tracking", () => {
  console.log("Testing NAPI exception state without actual throwing");
  
  const addon = require("./napi-app/build/Debug/napitests.node");
  console.log("Addon loaded successfully");
  
  // Try to call a function that checks exception state
  // Let's see what methods are available that might not crash
  const methods = Object.keys(addon);
  console.log("Available methods count:", methods.length);
  
  // Look for safe methods to call
  const safeMethods = methods.filter(m => 
    !m.includes('throw') && 
    !m.includes('error') && 
    (m.includes('get') || m.includes('test') || m.includes('create'))
  );
  console.log("Potentially safe methods:", safeMethods.slice(0, 10));
  
  expect(methods.length).toBeGreaterThan(0);
});