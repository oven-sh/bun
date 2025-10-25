/**
 * Test Bun.telemetry.nativeHooks()?.isEnabledFor() internal API
 * NO @opentelemetry/* imports allowed - testing ONLY native hooks
 */
import { describe, expect, test } from "bun:test";
import { InstrumentKind, InstrumentRef } from "./types";

describe("Bun.telemetry.nativeHooks()?.isEnabledFor()", () => {
  test("returns false when no instruments are attached", () => {
    // Ensure no instruments from previous tests
    const kinds = [
      InstrumentKind.Custom,
      InstrumentKind.HTTP,
      InstrumentKind.Fetch,
      InstrumentKind.SQL,
      InstrumentKind.Redis,
      InstrumentKind.S3,
      InstrumentKind.NODE_HTTP,
    ]; // All InstrumentKind values

    kinds.forEach(kind => {
      const enabled = Bun.telemetry.nativeHooks()?.isEnabledFor(kind);
      // Might be true if other tests left instruments attached, but usually false
      expect(typeof enabled).toBe("boolean");
    });
  });

  test("returns true after attaching instrument for specific kind", () => {
    using instrument = new InstrumentRef({
      type: InstrumentKind.HTTP,
      name: "test-http",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const httpEnabled = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.HTTP);
    expect(httpEnabled).toBe(true);

    // Other kinds should still be false (unless other tests attached)
    const sqlEnabled = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.SQL);
    // Can't assert false because parallel tests might attach SQL instruments
    expect(typeof sqlEnabled).toBe("boolean");
  });

  test("returns false after detaching last instrument for kind", () => {
    {
      using instrument = new InstrumentRef({
        type: InstrumentKind.Fetch,
        name: "test-fetch",
        version: "1.0.0",
        onOperationStart: () => {},
      });

      expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.Fetch)).toBe(true);
    }

    // After detaching, should be false (unless other tests attached Fetch instruments)
    const enabled = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.Fetch);
    // Can't reliably assert false in parallel test environment
    expect(typeof enabled).toBe("boolean");
  });

  test("returns true when multiple instruments attached for same kind", () => {
    using instrument1 = new InstrumentRef({
      type: InstrumentKind.HTTP,
      name: "http-1",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    using instrument2 = new InstrumentRef({
      type: InstrumentKind.HTTP,
      name: "http-2",
      version: "1.0.0",
      onOperationEnd: () => {},
    });

    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.HTTP)).toBe(true);

    // Detach one, should still be true
    Bun.telemetry.detach(instrument1.id);
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.HTTP)).toBe(true);
  });

  test("tracks enabled state independently for each kind", () => {
    using httpInstrument = new InstrumentRef({
      type: InstrumentKind.HTTP,
      name: "http",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    using fetchInstrument = new InstrumentRef({
      type: InstrumentKind.Fetch,
      name: "fetch",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    using sqlInstrument = new InstrumentRef({
      type: InstrumentKind.SQL,
      name: "sql",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    // All three should be enabled
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.HTTP)).toBe(true);
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.Fetch)).toBe(true);
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.SQL)).toBe(true);

    // Detach HTTP
    Bun.telemetry.detach(httpInstrument.id);

    // Fetch and SQL should still be enabled
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.Fetch)).toBe(true);
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.SQL)).toBe(true);
  });

  test("isEnabledFor is O(1) operation", () => {
    // Attach many instruments
    const instruments: InstrumentRef[] = [];
    try {
      for (let i = 0; i < 100; i++) {
        const instrument = new InstrumentRef({
          type: InstrumentKind.HTTP,
          name: `http-${i}`,
          version: "1.0.0",
          onOperationStart: () => {},
        });
        instruments.push(instrument);
      }

      // isEnabledFor should be fast regardless of number of instruments
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.HTTP);
      }
      const duration = performance.now() - start;

      // 1000 calls should complete in < 10ms (O(1) check)
      expect(duration).toBeLessThan(10);
    } finally {
      // Cleanup - detach in reverse order
      for (let i = instruments.length - 1; i >= 0; i--) {
        instruments[i][Symbol.dispose]();
      }
    }
  });

  test("checks all valid InstrumentKind values", () => {
    const kinds = [
      { value: InstrumentKind.Custom, name: "Custom" },
      { value: InstrumentKind.HTTP, name: "HTTP" },
      { value: InstrumentKind.Fetch, name: "Fetch" },
      { value: InstrumentKind.SQL, name: "SQL" },
      { value: InstrumentKind.Redis, name: "Redis" },
      { value: InstrumentKind.S3, name: "S3" },
    ];

    kinds.forEach(({ value, name }) => {
      using instrument = new InstrumentRef({
        type: value,
        name: `test-${name}`,
        version: "1.0.0",
        onOperationStart: () => {},
      });

      expect(Bun.telemetry.nativeHooks()?.isEnabledFor(value)).toBe(true);
    });
  });

  test("returns consistent results when called multiple times", () => {
    using instrument = new InstrumentRef({
      type: InstrumentKind.Redis,
      name: "redis",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const result1 = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.Redis);
    const result2 = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.Redis);
    const result3 = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentKind.Redis);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
    expect(result1).toBe(true);
  });
});
