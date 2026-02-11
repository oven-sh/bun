import { describe, expect, it } from "bun:test";
import v8 from "node:v8";

describe("v8.getHeapSpaceStatistics", () => {
  it("returns an array of heap space objects", () => {
    const stats = v8.getHeapSpaceStatistics();

    expect(Array.isArray(stats)).toBe(true);
    expect(stats.length).toBeGreaterThan(0);
  });

  it("each entry has the required properties", () => {
    const stats = v8.getHeapSpaceStatistics();

    for (const space of stats) {
      expect(typeof space.space_name).toBe("string");
      expect(typeof space.space_size).toBe("number");
      expect(typeof space.space_used_size).toBe("number");
      expect(typeof space.space_available_size).toBe("number");
      expect(typeof space.physical_space_size).toBe("number");
    }
  });

  it("includes expected heap space names", () => {
    const stats = v8.getHeapSpaceStatistics();
    const spaceNames = stats.map(s => s.space_name);

    // Check for common V8 heap space names
    expect(spaceNames).toContain("new_space");
    expect(spaceNames).toContain("old_space");
    expect(spaceNames).toContain("code_space");
    expect(spaceNames).toContain("large_object_space");
  });

  it("returns non-negative numeric values", () => {
    const stats = v8.getHeapSpaceStatistics();

    for (const space of stats) {
      expect(space.space_size).toBeGreaterThanOrEqual(0);
      expect(space.space_used_size).toBeGreaterThanOrEqual(0);
      expect(space.space_available_size).toBeGreaterThanOrEqual(0);
      expect(space.physical_space_size).toBeGreaterThanOrEqual(0);
    }
  });

  it("space_used_size does not exceed space_size for non-empty spaces", () => {
    const stats = v8.getHeapSpaceStatistics();

    for (const space of stats) {
      // Only check spaces that have a non-zero size
      if (space.space_size > 0) {
        expect(space.space_used_size).toBeLessThanOrEqual(space.space_size);
      }
    }
  });
});
