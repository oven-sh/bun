/**
 * Test Bun.telemetry.attach() error handling and validation
 * NO @opentelemetry/* imports allowed - testing ONLY native hooks
 */
import { describe, expect, test } from "bun:test";
import { InstrumentRef } from "./types";

describe("Bun.telemetry.attach() validation", () => {
  test("throws when called with no arguments", () => {
    expect(() => {
      // @ts-expect-error - testing error case
      Bun.telemetry.attach();
    }).toThrow();
  });

  test("throws when instrument is not an object", () => {
    expect(() => {
      // @ts-expect-error - testing error case
      Bun.telemetry.attach("not an object");
    }).toThrow(/must be an object/i);

    expect(() => {
      // @ts-expect-error - testing error case
      Bun.telemetry.attach(123);
    }).toThrow(/must be an object/i);

    expect(() => {
      // @ts-expect-error - testing error case
      Bun.telemetry.attach(null);
    }).toThrow(/must be an object/i);

    expect(() => {
      // @ts-expect-error - testing error case
      Bun.telemetry.attach(undefined);
    }).toThrow(/must be an object/i);
  });

  test("throws when 'kind' property is missing", () => {
    expect(() => {
      // @ts-expect-error - testing error case (missing kind)
      Bun.telemetry.attach({
        name: "test",
        version: "1.0.0",
        onOperationStart: () => {},
      });
    }).toThrow(/kind/i);
  });

  test("throws when 'kind' property is invalid (non-string)", () => {
    expect(() => {
      // @ts-expect-error - numeric kinds not supported
      Bun.telemetry.attach({
        kind: 1,
        name: "test",
        version: "1.0.0",
        onOperationStart: () => {},
      });
    }).toThrow(/kind/i);

    expect(() => {
      // @ts-expect-error - numeric kinds not supported
      Bun.telemetry.attach({
        kind: 999,
        name: "test",
        version: "1.0.0",
        onOperationStart: () => {},
      });
    }).toThrow(/kind/i);

    expect(() => {
      Bun.telemetry.attach({
        // @ts-expect-error - testing error case
        kind: [], // Wrong type
        name: "test",
        version: "1.0.0",
        onOperationStart: () => {},
      });
    }).toThrow(/kind/i);
  });

  test("accepts unknown string kinds and defaults them to 'custom' for forward compatibility", () => {
    // Invalid string kinds should NOT throw - they default to "custom"
    // This allows newer instrumentations to work with older Bun versions
    using instrument1 = new InstrumentRef({
      // @ts-expect-error - testing forward compatibility with unknown kind
      kind: "invalid-kind",
      name: "test-1",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    expect(typeof instrument1.id).toBe("number");
    expect(instrument1.id).toBeGreaterThan(0);

    using instrument2 = new InstrumentRef({
      // @ts-expect-error - testing forward compatibility with unknown kind
      kind: "future-feature",
      name: "test-2",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    expect(typeof instrument2.id).toBe("number");
    expect(instrument2.id).toBeGreaterThan(0);
  });

  test("throws when no hook functions are provided", () => {
    expect(() => {
      Bun.telemetry.attach({
        kind: "http",
        name: "test",
        version: "1.0.0",
        // No hook functions!
      });
    }).toThrow(/hook/i);
  });

  test("throws when hook functions are not callable", () => {
    expect(() => {
      Bun.telemetry.attach({
        kind: "http",
        name: "test",
        version: "1.0.0",
        // @ts-expect-error - testing error case
        onOperationStart: "not a function",
      });
    }).toThrow(/hook/i);

    expect(() => {
      Bun.telemetry.attach({
        kind: "http",
        name: "test",
        version: "1.0.0",
        // @ts-expect-error - testing error case
        onOperationStart: {},
      });
    }).toThrow(/hook/i);

    expect(() => {
      Bun.telemetry.attach({
        kind: "http",
        name: "test",
        version: "1.0.0",
        // @ts-expect-error - testing error case
        onOperationStart: null,
      });
    }).toThrow(/hook/i);
  });

  test("accepts valid instrument kind strings", () => {
    const validKinds = [
      { kind: "custom", name: "Custom" },
      { kind: "http", name: "HTTP" },
      { kind: "fetch", name: "Fetch" },
      { kind: "sql", name: "SQL" },
      { kind: "redis", name: "Redis" },
      { kind: "s3", name: "S3" },
    ];

    validKinds.forEach(({ kind, name }) => {
      using instrument = new InstrumentRef({
        kind: kind,
        name: `test-${name}`,
        version: "1.0.0",
        onOperationStart: () => {},
      });

      expect(typeof instrument.id).toBe("number");
      expect(instrument.id).toBeGreaterThan(0);
    });
  });

  test("optional properties can be omitted", () => {
    // Only name and version might be optional in some implementations
    // But kind and at least one hook are required
    using instrument = new InstrumentRef({
      kind: "http",
      name: "minimal",
      version: "1.0.0",
      onOperationStart: () => {},
      // All other hooks omitted
    });

    expect(typeof instrument.id).toBe("number");
    expect(instrument.id).toBeGreaterThan(0);
  });
});

describe("Bun.telemetry.detach() validation", () => {
  test("handles invalid ID types gracefully", () => {
    // @ts-expect-error - testing error case
    const result1 = Bun.telemetry.detach("not a number");
    expect(result1).toBe(false);

    // @ts-expect-error - testing error case
    const result2 = Bun.telemetry.detach({});
    expect(result2).toBe(false);

    // @ts-expect-error - testing error case
    const result3 = Bun.telemetry.detach(null);
    expect(result3).toBe(false);

    // @ts-expect-error - testing error case
    const result4 = Bun.telemetry.detach(undefined);
    expect(result4).toBe(false);
  });

  test("handles negative IDs gracefully", () => {
    // @ts-expect-error - testing error case
    const result = Bun.telemetry.detach(-1);
    expect(result).toBe(false);
  });

  test("handles zero ID gracefully", () => {
    // @ts-expect-error - testing error case with invalid ID
    const result = Bun.telemetry.detach(0);
    expect(result).toBe(false);
  });
});

describe("Bun.telemetry.nativeHooks()?.isEnabledFor() validation", () => {
  test("returns false for invalid kind types", () => {
    // @ts-expect-error - testing error case
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor("http")).toBe(false);

    // @ts-expect-error - testing error case
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor({})).toBe(false);

    // @ts-expect-error - testing error case
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(null)).toBe(false);
  });

  test("returns false for out-of-range kind values", () => {
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(-1)).toBe(false);
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor(999)).toBe(false);
  });

  test("returns false when called with no arguments", () => {
    // @ts-expect-error - testing error case
    expect(Bun.telemetry.nativeHooks()?.isEnabledFor()).toBe(false);
  });
});

describe("Bun.telemetry.listInstruments() validation", () => {
  test("handles invalid kind filter gracefully", () => {
    // Should return empty array or all instruments (implementation-defined)
    // @ts-expect-error - testing error case
    const result = Bun.telemetry.listInstruments("invalid");
    expect(Array.isArray(result)).toBe(true);
  });

  test("handles out-of-range kind filter gracefully", () => {
    const result = Bun.telemetry.listInstruments(999);
    expect(Array.isArray(result)).toBe(true);
    // Out of range might return empty or all instruments depending on implementation
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
