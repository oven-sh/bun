import { test, expect } from "bun:test";
import * as v8 from "node:v8";

test("v8.getHeapSpaceStatistics returns standard V8 space names", () => {
  const spaces = v8.getHeapSpaceStatistics();

  // Verify the result is an array
  expect(Array.isArray(spaces)).toBe(true);

  // Verify we have the expected standard V8 spaces (not the deprecated "heap" entry)
  const spaceNames = spaces.map(s => s.space_name);

  // Expected standard V8 heap space names (not including non-standard "heap")
  const expectedSpaces = [
    "read_only_space",
    "new_space",
    "old_space",
    "code_space",
    "shared_space",
    "new_large_object_space",
    "large_object_space",
    "code_large_object_space",
    "shared_large_object_space",
  ];

  // All expected spaces should be present
  for (const expectedSpace of expectedSpaces) {
    expect(spaceNames).toContain(expectedSpace);
  }

  // Should NOT have the non-standard "heap" entry
  expect(spaceNames).not.toContain("heap");
  expect(spaces.length).toBe(expectedSpaces.length);
});

test("v8.getHeapSpaceStatistics returns non-zero metrics for meaningful spaces", () => {
  const spaces = v8.getHeapSpaceStatistics();

  // Find old_space which should have the most heap usage
  const oldSpace = spaces.find(s => s.space_name === "old_space");
  const newSpace = spaces.find(s => s.space_name === "new_space");
  const codeSpace = spaces.find(s => s.space_name === "code_space");

  expect(oldSpace).toBeDefined();
  expect(newSpace).toBeDefined();
  expect(codeSpace).toBeDefined();

  if (oldSpace) {
    // old_space should have non-zero metrics (or at least be realistic)
    expect(oldSpace.space_size).toBeGreaterThan(0);
    expect(oldSpace.space_used_size).toBeGreaterThanOrEqual(0);
    expect(oldSpace.space_available_size).toBeGreaterThanOrEqual(0);
  }

  if (newSpace) {
    // new_space should have non-zero metrics
    expect(newSpace.space_size).toBeGreaterThan(0);
    expect(newSpace.space_used_size).toBeGreaterThanOrEqual(0);
  }
});

test("v8.getHeapSpaceStatistics metrics are consistent", () => {
  const spaces = v8.getHeapSpaceStatistics();

  for (const space of spaces) {
    // Each space should have required properties
    expect(space).toHaveProperty("space_name");
    expect(space).toHaveProperty("space_size");
    expect(space).toHaveProperty("space_used_size");
    expect(space).toHaveProperty("space_available_size");
    expect(space).toHaveProperty("physical_space_size");

    // All metrics should be non-negative numbers
    expect(typeof space.space_size).toBe("number");
    expect(typeof space.space_used_size).toBe("number");
    expect(typeof space.space_available_size).toBe("number");
    expect(typeof space.physical_space_size).toBe("number");

    expect(space.space_size).toBeGreaterThanOrEqual(0);
    expect(space.space_used_size).toBeGreaterThanOrEqual(0);
    expect(space.space_available_size).toBeGreaterThanOrEqual(0);
    expect(space.physical_space_size).toBeGreaterThanOrEqual(0);

    // Space used size should not exceed space size
    expect(space.space_used_size).toBeLessThanOrEqual(space.space_size);

    // available = size - used
    const expectedAvailable = space.space_size - space.space_used_size;
    expect(space.space_available_size).toBe(expectedAvailable);
  }
});