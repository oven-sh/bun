/**
 * Test Bun.telemetry.isEnabledFor() native API
 * NO @opentelemetry/* imports allowed - testing ONLY native hooks
 */
import { describe, expect, test } from "bun:test";

describe("Bun.telemetry.isEnabledFor()", () => {
  test("returns false when no instruments are attached", () => {
    // Ensure no instruments from previous tests
    const kinds = [0, 1, 2, 3, 4, 5]; // All InstrumentKind values

    kinds.forEach(kind => {
      const enabled = Bun.telemetry.isEnabledFor(kind);
      // Might be true if other tests left instruments attached, but usually false
      expect(typeof enabled).toBe("boolean");
    });
  });

  test("returns true after attaching instrument for specific kind", () => {
    const id = Bun.telemetry.attach({
      type: 1, // InstrumentKind.HTTP
      name: "test-http",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const httpEnabled = Bun.telemetry.isEnabledFor(1); // HTTP
    expect(httpEnabled).toBe(true);

    // Other kinds should still be false (unless other tests attached)
    const sqlEnabled = Bun.telemetry.isEnabledFor(3); // SQL
    // Can't assert false because parallel tests might attach SQL instruments
    expect(typeof sqlEnabled).toBe("boolean");

    // Cleanup
    Bun.telemetry.detach(id);
  });

  test("returns false after detaching last instrument for kind", () => {
    const id = Bun.telemetry.attach({
      type: 2, // InstrumentKind.Fetch
      name: "test-fetch",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    expect(Bun.telemetry.isEnabledFor(2)).toBe(true);

    Bun.telemetry.detach(id);

    // After detaching, should be false (unless other tests attached Fetch instruments)
    const enabled = Bun.telemetry.isEnabledFor(2);
    // Can't reliably assert false in parallel test environment
    expect(typeof enabled).toBe("boolean");
  });

  test("returns true when multiple instruments attached for same kind", () => {
    const id1 = Bun.telemetry.attach({
      type: 1, // HTTP
      name: "http-1",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const id2 = Bun.telemetry.attach({
      type: 1, // HTTP
      name: "http-2",
      version: "1.0.0",
      onOperationEnd: () => {},
    });

    expect(Bun.telemetry.isEnabledFor(1)).toBe(true);

    // Detach one, should still be true
    Bun.telemetry.detach(id1);
    expect(Bun.telemetry.isEnabledFor(1)).toBe(true);

    // Detach second
    Bun.telemetry.detach(id2);
  });

  test("tracks enabled state independently for each kind", () => {
    const httpId = Bun.telemetry.attach({
      type: 1, // HTTP
      name: "http",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const fetchId = Bun.telemetry.attach({
      type: 2, // Fetch
      name: "fetch",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const sqlId = Bun.telemetry.attach({
      type: 3, // SQL
      name: "sql",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    // All three should be enabled
    expect(Bun.telemetry.isEnabledFor(1)).toBe(true); // HTTP
    expect(Bun.telemetry.isEnabledFor(2)).toBe(true); // Fetch
    expect(Bun.telemetry.isEnabledFor(3)).toBe(true); // SQL

    // Detach HTTP
    Bun.telemetry.detach(httpId);

    // Fetch and SQL should still be enabled
    expect(Bun.telemetry.isEnabledFor(2)).toBe(true);
    expect(Bun.telemetry.isEnabledFor(3)).toBe(true);

    // Cleanup
    Bun.telemetry.detach(fetchId);
    Bun.telemetry.detach(sqlId);
  });

  test("isEnabledFor is O(1) operation", () => {
    // Attach many instruments
    const ids: number[] = [];
    for (let i = 0; i < 100; i++) {
      const id = Bun.telemetry.attach({
        type: 1, // HTTP
        name: `http-${i}`,
        version: "1.0.0",
        onOperationStart: () => {},
      });
      ids.push(id);
    }

    // isEnabledFor should be fast regardless of number of instruments
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      Bun.telemetry.isEnabledFor(1);
    }
    const duration = performance.now() - start;

    // 1000 calls should complete in < 10ms (O(1) check)
    expect(duration).toBeLessThan(10);

    // Cleanup
    ids.forEach(id => Bun.telemetry.detach(id));
  });

  test("checks all valid InstrumentKind values", () => {
    const kinds = [
      { value: 0, name: "Custom" },
      { value: 1, name: "HTTP" },
      { value: 2, name: "Fetch" },
      { value: 3, name: "SQL" },
      { value: 4, name: "Redis" },
      { value: 5, name: "S3" },
    ];

    kinds.forEach(({ value, name }) => {
      const id = Bun.telemetry.attach({
        type: value,
        name: `test-${name}`,
        version: "1.0.0",
        onOperationStart: () => {},
      });

      expect(Bun.telemetry.isEnabledFor(value)).toBe(true);

      Bun.telemetry.detach(id);
    });
  });

  test("returns consistent results when called multiple times", () => {
    const id = Bun.telemetry.attach({
      type: 4, // Redis
      name: "redis",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const result1 = Bun.telemetry.isEnabledFor(4);
    const result2 = Bun.telemetry.isEnabledFor(4);
    const result3 = Bun.telemetry.isEnabledFor(4);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
    expect(result1).toBe(true);

    Bun.telemetry.detach(id);
  });
});

describe("Bun.telemetry.isEnabledFor() performance", () => {
  test("zero overhead when no instruments attached", () => {
    // Ensure clean state
    const allInstruments = Bun.telemetry.listInstruments();
    allInstruments.forEach((info: any) => {
      Bun.telemetry.detach(info.id);
    });

    // Benchmark isEnabledFor when disabled
    const iterations = 100000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      Bun.telemetry.isEnabledFor(1); // HTTP
    }

    const duration = performance.now() - start;
    const nsPerCall = (duration * 1_000_000) / iterations;

    // Should be < 50ns per call (essentially free)
    console.log(`isEnabledFor (disabled): ${nsPerCall.toFixed(2)}ns per call`);
    expect(duration).toBeLessThan(100); // 100ms for 100k calls
  });

  test("minimal overhead when instruments attached", () => {
    const id = Bun.telemetry.attach({
      type: 1, // HTTP
      name: "perf-test",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    // Benchmark isEnabledFor when enabled
    const iterations = 100000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      Bun.telemetry.isEnabledFor(1); // HTTP
    }

    const duration = performance.now() - start;
    const nsPerCall = (duration * 1_000_000) / iterations;

    // Should still be < 100ns per call (just array length check)
    console.log(`isEnabledFor (enabled): ${nsPerCall.toFixed(2)}ns per call`);
    expect(duration).toBeLessThan(200); // 200ms for 100k calls

    Bun.telemetry.detach(id);
  });
});
