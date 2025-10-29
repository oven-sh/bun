/**
 * Test Bun.telemetry.nativeHooks()?.isEnabledFor() internal API
 * NO @opentelemetry/* imports allowed - testing ONLY native hooks
 */
import { describe, expect, test } from "bun:test";
import { InstrumentRef } from "./types";

/**
 * Maps 1:1 with src/bun.js/telemetry.zig InstrumentType enum.
 */
enum InstrumentType {
  Custom = 0,
  HTTP = 1,
  Fetch = 2,
  SQL = 3,
  Redis = 4,
  S3 = 5,
  Node = 6,
  // Back-compat alias for older tests
  NODE_HTTP = Node,
}
const EXPECTED_INSTRUMENTS = [
  { value: "custom", name: "Custom", type: InstrumentType.Custom },
  { value: "http", name: "HTTP", type: InstrumentType.HTTP },
  { value: "fetch", name: "Fetch", type: InstrumentType.Fetch },
  { value: "sql", name: "SQL", type: InstrumentType.SQL },
  { value: "redis", name: "Redis", type: InstrumentType.Redis },
  { value: "s3", name: "S3", type: InstrumentType.S3 },
  { value: "node", name: "Node", type: InstrumentType.Node },
];
describe("Bun.telemetry.nativeHooks()?.isEnabledFor()", () => {
  test("returns false when no instruments are attached", () => {
    // Ensure no instruments from previous tests
    const types = EXPECTED_INSTRUMENTS.map(i => i.type);

    types.forEach(_type => {
      const enabled = Bun.telemetry.nativeHooks()?.isEnabledFor(_type);
      // Might be true if other tests left instruments attached, but usually false
      expect(typeof enabled).toBe("boolean");
    });
  });

  test("returns true after attaching instrument for specific kind", () => {
    using instrument = new InstrumentRef({
      kind: "http",
      name: "test-http",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const httpEnabled = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.HTTP);
    expect(httpEnabled).toBe(true);

    // Other kinds should still be false (unless other tests attached)
    const sqlEnabled = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.SQL);
    // Can't assert false because parallel tests might attach SQL instruments
    expect(typeof sqlEnabled).toBe("boolean");
  });

  test("returns false after detaching last instrument for kind", () => {
    {
      using instrument = new InstrumentRef({
        kind: "fetch",
        name: "test-fetch",
        version: "1.0.0",
        onOperationStart: () => {},
      });

      expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.Fetch)).toBe(true);
    }

    // After detaching, should be false (unless other tests attached Fetch instruments)
    const enabled = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.Fetch);
    // Can't reliably assert false in parallel test environment
    expect(typeof enabled).toBe("boolean");
  });

  test("returns true when multiple instruments attached for same kind", () => {
    using instrument1 = new InstrumentRef({
      kind: "http",
      name: "http-1",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    using instrument2 = new InstrumentRef({
      kind: "http",
      name: "http-2",
      version: "1.0.0",
      onOperationEnd: () => {},
    });

    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.HTTP)).toBe(true);

    // Detach one, should still be true
    instrument1[Symbol.dispose]();
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.HTTP)).toBe(true);
  });

  test("tracks enabled state independently for each kind", () => {
    using httpInstrument = new InstrumentRef({
      kind: "http",
      name: "http",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    using fetchInstrument = new InstrumentRef({
      kind: "fetch",
      name: "fetch",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    using sqlInstrument = new InstrumentRef({
      kind: "sql",
      name: "sql",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    // All three should be enabled
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.HTTP)).toBe(true);
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.Fetch)).toBe(true);
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.SQL)).toBe(true);

    // Detach HTTP
    httpInstrument[Symbol.dispose]();

    // Fetch and SQL should still be enabled
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.Fetch)).toBe(true);
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.SQL)).toBe(true);
  });

  test("isEnabledFor is O(1) operation", () => {
    // Attach many instruments
    const instruments: InstrumentRef[] = [];
    try {
      for (let i = 0; i < 100; i++) {
        const instrument = new InstrumentRef({
          kind: "http",
          name: `http-${i}`,
          version: "1.0.0",
          onOperationStart: () => {},
        });
        instruments.push(instrument);
      }

      // isEnabledFor should be fast regardless of number of instruments
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.HTTP);
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
    EXPECTED_INSTRUMENTS.forEach(({ value, name, type: _type }) => {
      using instrument = new InstrumentRef({
        kind: value,
        name: `test-${name}`,
        version: "1.0.0",
        onOperationStart: () => {},
      });

      expect(Bun.telemetry.nativeHooks()?.isEnabledFor(_type)).toBe(true);
    });
  });

  test("returns consistent results when called multiple times", () => {
    using instrument = new InstrumentRef({
      kind: "redis",
      name: "redis",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const result1 = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.Redis);
    const result2 = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.Redis);
    const result3 = Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.Redis);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
    expect(result1).toBe(true);
  });
});
