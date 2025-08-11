import { test, expect } from "bun:test";
import { join } from "path";

test("test NAPI exception state functions", () => {
  console.log("Testing NAPI exception state checking functions");
  
  const addonPath = join(import.meta.dir, "napi-app", "build", "Debug", "exception_check_addon.node");
  const addon = require(addonPath);
  
  console.log("Exception check addon loaded successfully");
  console.log("Available methods:", Object.keys(addon));
  
  // Test that initially no exception is pending
  console.log("Testing initial exception state");
  const noPendingInitially = addon.testExceptionPendingInitially();
  console.log("No exception pending initially:", noPendingInitially);
  expect(noPendingInitially).toBe(true);
  
  // Test that NAPI_PREAMBLE check function can be called
  console.log("Testing multiple preamble check function");
  const preambleCheckResult = addon.testMultiplePreambleCheck();
  console.log("Preamble check result:", preambleCheckResult);
  expect(preambleCheckResult).toBe(true);
});