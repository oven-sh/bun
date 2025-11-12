/**
 * Regression test for segmentation fault in JSArray allocation
 * 
 * Issue: Segmentation fault occurs when JSArray::tryCreate uses a freed
 *        or invalid MarkedBlock during array allocation.
 * 
 * Related: #24357, #24194, #24509
 * Labels: crash, macOS, runtime, needs triage
 * 
 * This test attempts to reproduce the crash by:
 * 1. Creating large arrays that trigger GC
 * 2. Concurrent allocations to create race conditions
 * 3. Stress testing allocator with rapid allocations
 */

import { test, expect, describe } from "bun:test";

describe("Segmentation Fault: JSArray Allocator", () => {
  test("large array allocation", () => {
    // Test case 1: Large array allocation that may trigger GC
    const arrays: any[] = [];
    const arraySize = 1000000;
    const numArrays = 100;

    for (let i = 0; i < numArrays; i++) {
      try {
        const arr = Array(arraySize).fill(1);
        arrays.push(arr);
        
        // Log progress to help identify crash point
        if (i % 10 === 0) {
          console.log(`[Test] Allocated ${i}/${numArrays} arrays`);
        }
      } catch (error) {
        // If we get an error (not a crash), that's actually better than a segfault
        console.error(`[Test] Error at iteration ${i}:`, error);
        throw error;
      }
    }

    // Verify arrays were created
    expect(arrays.length).toBe(numArrays);
    expect(arrays[0].length).toBe(arraySize);
  });

  test("concurrent array allocations", async () => {
    // Test case 2: Concurrent allocations to trigger race conditions
    const numConcurrent = 10;
    const arraySize = 500000;

    const promises = Array.from({ length: numConcurrent }, (_, i) => {
      return Promise.resolve().then(() => {
        try {
          const arr = Array(arraySize).fill(Math.random());
          return { index: i, length: arr.length, success: true };
        } catch (error) {
          return { index: i, error: String(error), success: false };
        }
      });
    });

    const results = await Promise.all(promises);
    
    // All should succeed
    const failures = results.filter(r => !r.success);
    expect(failures.length).toBe(0);
    
    // Verify all arrays have correct length
    results.forEach((result, i) => {
      if (result.success) {
        expect(result.length).toBe(arraySize);
      }
    });
  });

  test("rapid small array allocations", () => {
    // Test case 3: Rapid small allocations to stress allocator
    const numIterations = 10000;
    const arraySize = 1000;

    for (let i = 0; i < numIterations; i++) {
      try {
        const arr = Array(arraySize).fill(i);
        
        // Verify array is valid
        expect(arr.length).toBe(arraySize);
        expect(arr[0]).toBe(i);
        
        // Force some GC pressure by creating and discarding
        if (i % 1000 === 0) {
          // Create temporary arrays to trigger GC
          const temp = Array(10000).fill(0);
          // Let temp go out of scope to be collected
        }
      } catch (error) {
        console.error(`[Test] Error at iteration ${i}:`, error);
        throw error;
      }
    }
  });

  test("array allocation with GC pressure", () => {
    // Test case 4: Allocate arrays while forcing GC
    const arrays: any[] = [];
    const arraySize = 200000;

    for (let i = 0; i < 50; i++) {
      try {
        // Create array
        const arr = Array(arraySize).fill(i);
        arrays.push(arr);
        
        // Periodically trigger GC (if available)
        if (i % 10 === 0 && typeof bun !== "undefined" && bun.gc) {
          bun.gc(true);
        }
      } catch (error) {
        console.error(`[Test] Error at iteration ${i}:`, error);
        throw error;
      }
    }

    expect(arrays.length).toBe(50);
  });

  test("nested array allocations", () => {
    // Test case 5: Nested arrays to test complex allocation patterns
    const outerSize = 100;
    const innerSize = 10000;

    try {
      const nested: any[][] = [];
      
      for (let i = 0; i < outerSize; i++) {
        const inner = Array(innerSize).fill(i);
        nested.push(inner);
        
        if (i % 20 === 0) {
          console.log(`[Test] Created ${i}/${outerSize} nested arrays`);
        }
      }

      expect(nested.length).toBe(outerSize);
      expect(nested[0].length).toBe(innerSize);
    } catch (error) {
      console.error(`[Test] Error in nested allocation:`, error);
      throw error;
    }
  });

  test("array allocation edge cases", () => {
    // Test case 6: Edge cases that might trigger the bug
    const testCases = [
      { size: 0, desc: "empty array" },
      { size: 1, desc: "single element" },
      { size: 100, desc: "small array" },
      { size: 1000000, desc: "large array" },
      { size: 10000000, desc: "very large array" },
    ];

    for (const testCase of testCases) {
      try {
        const arr = Array(testCase.size).fill(0);
        expect(arr.length).toBe(testCase.size);
        console.log(`[Test] ✓ ${testCase.desc} (size: ${testCase.size})`);
      } catch (error) {
        console.error(`[Test] ✗ Failed ${testCase.desc}:`, error);
        throw error;
      }
    }
  });
});

// Manual reproduction script (not run as part of test suite)
if (import.meta.main) {
  console.log("Running manual reproduction test...");
  console.log("This may crash with a segmentation fault if the bug exists.");
  
  const arrays: any[] = [];
  const arraySize = 1000000;
  
  try {
    for (let i = 0; i < 1000; i++) {
      arrays.push(Array(arraySize).fill(1));
      if (i % 100 === 0) {
        console.log(`Allocated ${i} arrays`);
      }
    }
    console.log("✓ Test completed successfully");
  } catch (error) {
    console.error("✗ Test failed with error:", error);
    process.exit(1);
  }
}

