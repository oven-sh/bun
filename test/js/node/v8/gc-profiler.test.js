import { describe, test, expect } from "bun:test";
import { GCProfiler } from "node:v8";

describe("v8.GCProfiler", () => {
  test("should create GCProfiler instance", () => {
    const profiler = new GCProfiler();
    expect(profiler).toBeInstanceOf(GCProfiler);
  });

  test("should have start and stop methods", () => {
    const profiler = new GCProfiler();
    expect(typeof profiler.start).toBe("function");
    expect(typeof profiler.stop).toBe("function");
  });

  test("should start and stop profiling", () => {
    const profiler = new GCProfiler();
    
    // Should not throw when calling start
    expect(() => profiler.start()).not.toThrow();
    
    // Should not throw when calling stop
    expect(() => profiler.stop()).not.toThrow();
  });

  test("should return data when stopping", () => {
    const profiler = new GCProfiler();
    profiler.start();
    
    // Force some garbage collection events (minimal)
    const objects = [];
    for (let i = 0; i < 1000; i++) {
      objects.push({ data: new Array(100).fill(i) });
    }
    objects.length = 0; // Clear to trigger potential GC
    
    const result = profiler.stop();
    
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result.version).toBe(1);
    expect(typeof result.startTime).toBe("number");
    expect(typeof result.endTime).toBe("number");
    expect(Array.isArray(result.statistics)).toBe(true);
    expect(result.endTime).toBeGreaterThan(result.startTime);
  });

  test("should handle multiple start/stop cycles", () => {
    const profiler = new GCProfiler();
    
    // First cycle
    profiler.start();
    const result1 = profiler.stop();
    expect(result1).toBeDefined();
    
    // Add small delay to ensure different timestamps
    const start = Date.now();
    while (Date.now() - start < 2) {
      // Busy wait for at least 2ms
    }
    
    // Second cycle
    profiler.start();
    const result2 = profiler.stop();
    expect(result2).toBeDefined();
    
    // Results should be different (different timestamps) or at least valid
    if (result1 && result2) {
      expect(result1.startTime).toBeGreaterThan(0);
      expect(result2.startTime).toBeGreaterThan(0);
      expect(result1.endTime).toBeGreaterThan(0);
      expect(result2.endTime).toBeGreaterThan(0);
    }
  });

  test("should return undefined when stopping without starting", () => {
    const profiler = new GCProfiler();
    const result = profiler.stop();
    expect(result).toBeUndefined();
  });

  test("should not crash when starting already started profiler", () => {
    const profiler = new GCProfiler();
    profiler.start();
    expect(() => profiler.start()).not.toThrow(); // Should be idempotent
    const result = profiler.stop();
    expect(result).toBeDefined();
  });

  // Additional comprehensive tests
  test("should handle constructor with no arguments", () => {
    expect(() => new GCProfiler()).not.toThrow();
  });

  test("should handle constructor with extra arguments gracefully", () => {
    expect(() => new GCProfiler("extra", "args")).not.toThrow();
  });

  test("should maintain consistent data format", () => {
    const profiler = new GCProfiler();
    profiler.start();
    
    // Create some memory pressure
    const data = Array(500).fill(null).map((_, i) => ({ 
      id: i, 
      payload: new Array(50).fill(Math.random()) 
    }));
    
    const result = profiler.stop();
    
    if (result) {
      expect(result).toHaveProperty("version");
      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("endTime");
      expect(result).toHaveProperty("statistics");
      
      expect(typeof result.version).toBe("number");
      expect(typeof result.startTime).toBe("number");
      expect(typeof result.endTime).toBe("number");
      expect(Array.isArray(result.statistics)).toBe(true);
      
      expect(result.version).toBeGreaterThan(0);
      expect(result.startTime).toBeGreaterThan(0);
      expect(result.endTime).toBeGreaterThan(0);
      expect(result.endTime).toBeGreaterThanOrEqual(result.startTime);
    }
  });

  test("should handle rapid start/stop sequences", () => {
    const profiler = new GCProfiler();
    
    for (let i = 0; i < 5; i++) {
      profiler.start();
      const result = profiler.stop();
      if (result) {
        expect(result.version).toBe(1);
        expect(typeof result.startTime).toBe("number");
        expect(typeof result.endTime).toBe("number");
      }
    }
  });

  test("should handle memory allocation patterns", () => {
    const profiler = new GCProfiler();
    profiler.start();
    
    // Create various allocation patterns
    const smallObjects = Array(1000).fill(null).map(() => ({ small: true }));
    const mediumObjects = Array(100).fill(null).map(() => ({ 
      medium: new Array(100).fill(0) 
    }));
    const largeObjects = Array(10).fill(null).map(() => ({ 
      large: new Array(10000).fill("data") 
    }));
    
    // Clear references to allow GC
    smallObjects.length = 0;
    mediumObjects.length = 0;
    largeObjects.length = 0;
    
    const result = profiler.stop();
    expect(result).toBeDefined();
    if (result) {
      expect(Array.isArray(result.statistics)).toBe(true);
    }
  });

  test("should maintain profiler state correctly", () => {
    const profiler1 = new GCProfiler();
    const profiler2 = new GCProfiler();
    
    // Independent profilers should not interfere
    profiler1.start();
    
    // Add small delay
    const start = Date.now();
    while (Date.now() - start < 1) {
      // Busy wait for at least 1ms
    }
    
    profiler2.start();
    
    const result1 = profiler1.stop();
    const result2 = profiler2.stop();
    
    // Both should return valid results
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    
    // Results should have valid properties
    if (result1 && result2) {
      expect(result1.startTime).toBeGreaterThan(0);
      expect(result2.startTime).toBeGreaterThan(0);
      expect(result1.endTime).toBeGreaterThan(0);
      expect(result2.endTime).toBeGreaterThan(0);
    }
  });

  test("should handle edge case of immediate stop after start", () => {
    const profiler = new GCProfiler();
    profiler.start();
    const result = profiler.stop();
    
    expect(result).toBeDefined();
    if (result) {
      expect(result.endTime).toBeGreaterThanOrEqual(result.startTime);
      expect(result.version).toBe(1);
      expect(Array.isArray(result.statistics)).toBe(true);
    }
  });

  test("should handle nested profiling attempts gracefully", () => {
    const profiler = new GCProfiler();
    
    profiler.start();
    profiler.start(); // Second start should be ignored
    profiler.start(); // Third start should be ignored
    
    const result = profiler.stop();
    expect(result).toBeDefined();
    
    // Subsequent stops should return undefined
    const result2 = profiler.stop();
    expect(result2).toBeUndefined();
  });

  test("should validate statistics array structure", () => {
    const profiler = new GCProfiler();
    profiler.start();
    
    // Generate some activity
    const temp = [];
    for (let i = 0; i < 100; i++) {
      temp.push(new Array(100).fill(i));
    }
    temp.splice(0, temp.length);
    
    const result = profiler.stop();
    
    if (result && result.statistics) {
      expect(Array.isArray(result.statistics)).toBe(true);
      // Each statistic entry (if any) should be an object
      result.statistics.forEach(stat => {
        expect(typeof stat).toBe("object");
        expect(stat).not.toBeNull();
      });
    }
  });
});