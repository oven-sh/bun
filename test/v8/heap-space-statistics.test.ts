import { test, expect } from "bun:test";
import v8 from "node:v8";

test("getHeapSpaceStatistics returns an array", () => {
  const stats = v8.getHeapSpaceStatistics();
  expect(Array.isArray(stats)).toBe(true);
  expect(stats.length).toBeGreaterThan(0);
});

test("getHeapSpaceStatistics has expected properties", () => {
  const stats = v8.getHeapSpaceStatistics();
  
  for (const space of stats) {
    expect(typeof space.space_name).toBe("string");
    expect(typeof space.space_size).toBe("number");
    expect(typeof space.space_used_size).toBe("number");
    expect(typeof space.space_available_size).toBe("number");
    expect(typeof space.physical_space_size).toBe("number");
    
    // All numeric values should be non-negative
    expect(space.space_size).toBeGreaterThanOrEqual(0);
    expect(space.space_used_size).toBeGreaterThanOrEqual(0);
    expect(space.space_available_size).toBeGreaterThanOrEqual(0);
    expect(space.physical_space_size).toBeGreaterThanOrEqual(0);
  }
});
