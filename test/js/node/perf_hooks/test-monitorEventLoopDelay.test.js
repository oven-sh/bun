import { describe, expect, test } from "bun:test";
import { monitorEventLoopDelay } from "perf_hooks";

describe("monitorEventLoopDelay", () => {
  test("should create histogram with default resolution", () => {
    const histogram = monitorEventLoopDelay();
    expect(histogram).toBeDefined();
    expect(histogram.enable).toBeFunction();
    expect(histogram.disable).toBeFunction();
    expect(histogram.reset).toBeFunction();
    expect(histogram.percentile).toBeFunction();
    expect(histogram.percentiles).toBeDefined();
    expect(histogram.min).toBeNumber();
    expect(histogram.max).toBeNumber();
    expect(histogram.mean).toBeNumber();
    expect(histogram.stddev).toBeNumber();
    expect(histogram.exceeds).toBeNumber();
  });

  test("should create histogram with custom resolution", () => {
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    expect(histogram).toBeDefined();
  });

  test("should enable and disable monitoring", () => {
    const histogram = monitorEventLoopDelay();
    expect(histogram.enable()).toBe(true);
    expect(histogram.enable()).toBe(false); // Already enabled
    expect(histogram.disable()).toBe(true);
    expect(histogram.disable()).toBe(false); // Already disabled
  });

  test("should reset histogram", () => {
    const histogram = monitorEventLoopDelay();
    histogram.enable();
    histogram.reset();
    expect(histogram.min).toBeGreaterThanOrEqual(0);
    expect(histogram.max).toBeGreaterThanOrEqual(0);
    histogram.disable();
  });

  test("should record delays when enabled", async () => {
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();

    // Create some event loop delay
    const start = Date.now();
    while (Date.now() - start < 50) {
      // Busy loop to create delay
    }

    // Wait for a timer tick
    await new Promise(resolve => setTimeout(resolve, 20));

    // Check that we recorded some delays
    expect(histogram.min).toBeGreaterThanOrEqual(0);
    expect(histogram.max).toBeGreaterThan(0);
    expect(histogram.mean).toBeGreaterThan(0);

    histogram.disable();
  });

  test("should calculate percentiles", async () => {
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();

    // Create some delays
    await new Promise(resolve => setTimeout(resolve, 50));

    const p50 = histogram.percentile(50);
    const p99 = histogram.percentile(99);

    expect(p50).toBeNumber();
    expect(p99).toBeNumber();
    expect(p99).toBeGreaterThanOrEqual(p50);

    histogram.disable();
  });

  test("should throw on invalid resolution", () => {
    expect(() => monitorEventLoopDelay({ resolution: 0 })).toThrow();
    expect(() => monitorEventLoopDelay({ resolution: -1 })).toThrow();
  });

  test("should handle multiple histograms", () => {
    const h1 = monitorEventLoopDelay({ resolution: 10 });
    const h2 = monitorEventLoopDelay({ resolution: 20 });

    h1.enable();
    h2.enable();

    expect(h1.disable()).toBe(true);
    expect(h2.disable()).toBe(true);
  });
});
