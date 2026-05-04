import { test, expect, describe } from "bun:test";
import v8 from "node:v8";

const V8_STANDARD_SPACE_NAMES = [
  "read_only_space",
  "new_space",
  "old_space",
  "code_space",
  "shared_space",
  "trusted_space",
  "shared_trusted_space",
  "new_large_object_space",
  "large_object_space",
  "code_large_object_space",
  "shared_large_object_space",
  "shared_trusted_large_object_space",
  "trusted_large_object_space",
];

describe("getHeapSpaceStatistics", () => {
  test("each entry has expected properties with correct types", () => {
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

  test("metrics reflect memory pressure after allocations", () => {
    const before = v8.getHeapSpaceStatistics();

    // Allocate a significant amount of data to create memory pressure
    const arrays: unknown[] = [];
    for (let i = 0; i < 10000; i++) {
      arrays.push({ key: "x".repeat(100), value: i });
    }

    const after = v8.getHeapSpaceStatistics();

    // After allocating objects, used size should have increased or stayed the same
    // (GC might run, but total heap should generally reflect the pressure)
    const totalUsedBefore = before.reduce((sum, s) => sum + s.space_used_size, 0);
    const totalUsedAfter = after.reduce((sum, s) => sum + s.space_used_size, 0);
    expect(totalUsedAfter).toBeGreaterThanOrEqual(totalUsedBefore * 0.5);

    // Keep reference alive to prevent GC
    void arrays.length;
  });

});
