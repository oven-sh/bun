// Test for NAPI GC crash fix
// This test reproduces the crash where napi_create_object was called during GC from a finalizer
// https://github.com/oven-sh/bun/issues/...

const { test, expect } = require("bun:test");
const napitests = require("../../napi/napi-app/build/Debug/napitests.node");

test("NAPI functions should not crash when called during GC from finalizer", async () => {
  // Create an object with a finalizer that misbehaves by calling napi_create_object during GC
  const obj = napitests.createObjectWithBadFinalizer();
  
  // Make sure the object exists
  expect(obj).toBeDefined();
  expect(typeof obj).toBe("object");
  
  // Force GC to trigger the finalizer
  // In the original code, this would crash with SIGTRAP
  // With the fix, it should complete without crashing and return an error
  if (global.gc) {
    global.gc();
    global.gc(); // Call twice to be sure
  } else {
    // If gc is not exposed, try to trigger it by creating memory pressure
    for (let i = 0; i < 1000; i++) {
      new Array(1000).fill(new Date());
    }
  }
  
  // If we reach this point, the process didn't crash
  expect(true).toBe(true);
});