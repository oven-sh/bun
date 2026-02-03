import { test, expect } from "bun:test";
import os from "node:os";

test("os.loadavg() returns reasonable values on macOS", () => {
  // Issue #16882: os.loadavg() was returning extremely small values on macOS
  const loadavg = os.loadavg();
  
  expect(Array.isArray(loadavg)).toBe(true);
  expect(loadavg).toHaveLength(3);
  
  // Load average values should be reasonable (typically 0-10 on most systems)
  // They should definitely not be in the scientific notation range like 2.7e-10
  for (let i = 0; i < 3; i++) {
    expect(typeof loadavg[i]).toBe("number");
    expect(loadavg[i]).toBeGreaterThanOrEqual(0);
    expect(loadavg[i]).toBeLessThan(100); // Sanity check - load should not exceed 100
    
    // The key test: values should not be in the tiny range that was the bug
    expect(loadavg[i]).toBeGreaterThan(1e-6); // Should be much larger than 1e-10
  }
  
  // Log the values for manual verification during testing
  console.log("Load averages:", loadavg);
});