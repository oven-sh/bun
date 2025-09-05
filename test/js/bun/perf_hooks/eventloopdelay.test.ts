import { expect, test } from "bun:test";
import { monitorEventLoopDelay } from "perf_hooks";

test("monitorEventLoopDelay basic functionality", async () => {
  const histogram = monitorEventLoopDelay({ resolution: 10 });

  // Test enable/disable
  expect(histogram.enable()).toBe(true);
  expect(histogram.enable()).toBe(false); // Already enabled

  // Wait for some data to accumulate
  await new Promise(resolve => setTimeout(resolve, 100));

  // Create some event loop delay
  const start = Date.now();
  while (Date.now() - start < 50) {
    // Busy loop to create delay
  }

  await new Promise(resolve => setTimeout(resolve, 100));

  // Check properties exist and are numbers
  expect(typeof histogram.min).toBe("number");
  expect(typeof histogram.max).toBe("number");
  expect(typeof histogram.mean).toBe("number");
  expect(typeof histogram.stddev).toBe("number");
  expect(typeof histogram.exceeds).toBe("number");

  // Check percentiles
  expect(histogram.percentiles).toBeInstanceOf(Map);
  expect(typeof histogram.percentile(50)).toBe("number");
  expect(typeof histogram.percentile(99)).toBe("number");

  // Test disable
  expect(histogram.disable()).toBe(true);
  expect(histogram.disable()).toBe(false); // Already disabled

  // Test reset
  histogram.reset();

  // After reset, min should be Infinity-like, max should be 0
  expect(histogram.min).toBeGreaterThan(1e15);
  expect(histogram.max).toBe(0);
  expect(Number.isNaN(histogram.mean)).toBe(true);
  expect(Number.isNaN(histogram.stddev)).toBe(true);
});

test("monitorEventLoopDelay validation", () => {
  // Test invalid options argument types
  [null, "a", 1, false, Infinity].forEach(invalid => {
    expect(() => monitorEventLoopDelay(invalid as any)).toThrow(TypeError);
  });

  // Test invalid resolution types
  [null, "a", false, {}, []].forEach(invalid => {
    expect(() => monitorEventLoopDelay({ resolution: invalid as any })).toThrow(TypeError);
  });

  // Test invalid resolution values
  [-1, 0, 2 ** 53, Infinity].forEach(invalid => {
    expect(() => monitorEventLoopDelay({ resolution: invalid })).toThrow(RangeError);
  });
});

test("monitorEventLoopDelay percentile validation", () => {
  const histogram = monitorEventLoopDelay();
  histogram.enable();

  // Test invalid percentile types
  ["a", false, {}, []].forEach(invalid => {
    expect(() => histogram.percentile(invalid as any)).toThrow(TypeError);
  });

  // Test invalid percentile values
  [-1, 101, NaN].forEach(invalid => {
    expect(() => histogram.percentile(invalid)).toThrow(RangeError);
  });

  histogram.disable();
});

test("monitorEventLoopDelay default resolution", () => {
  const histogram = monitorEventLoopDelay();
  expect(histogram).toBeDefined();

  histogram.enable();
  // Should work with default resolution of 10ms
  expect(histogram.disable()).toBe(true);
});

test("monitorEventLoopDelay custom resolution", () => {
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  expect(histogram).toBeDefined();

  histogram.enable();
  expect(histogram.disable()).toBe(true);
});
