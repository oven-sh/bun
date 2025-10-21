/**
 * Test Bun.telemetry.attach() error handling and validation
 * NO @opentelemetry/* imports allowed - testing ONLY native hooks
 */
import { describe, expect, test } from "bun:test";

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

  test("throws when 'type' property is missing", () => {
    expect(() => {
      Bun.telemetry.attach({
        // @ts-expect-error - testing error case (missing type)
        name: "test",
        version: "1.0.0",
        onOperationStart: () => {},
      });
    }).toThrow(/type/i);
  });

  test("throws when 'type' property is invalid", () => {
    expect(() => {
      Bun.telemetry.attach({
        type: -1, // Invalid negative
        name: "test",
        version: "1.0.0",
        onOperationStart: () => {},
      });
    }).toThrow(/type/i);

    expect(() => {
      Bun.telemetry.attach({
        type: 999, // Out of range
        name: "test",
        version: "1.0.0",
        onOperationStart: () => {},
      });
    }).toThrow(/type/i);

    expect(() => {
      Bun.telemetry.attach({
        // @ts-expect-error - testing error case
        type: "http", // Wrong type (should be number)
        name: "test",
        version: "1.0.0",
        onOperationStart: () => {},
      });
    }).toThrow(/type/i);
  });

  test("throws when no hook functions are provided", () => {
    expect(() => {
      Bun.telemetry.attach({
        type: 1, // Valid type
        name: "test",
        version: "1.0.0",
        // No hook functions!
      });
    }).toThrow(/hook/i);
  });

  test("throws when hook functions are not callable", () => {
    expect(() => {
      Bun.telemetry.attach({
        type: 1,
        name: "test",
        version: "1.0.0",
        // @ts-expect-error - testing error case
        onOperationStart: "not a function",
      });
    }).toThrow(/hook/i);

    expect(() => {
      Bun.telemetry.attach({
        type: 1,
        name: "test",
        version: "1.0.0",
        // @ts-expect-error - testing error case
        onOperationStart: {},
      });
    }).toThrow(/hook/i);

    expect(() => {
      Bun.telemetry.attach({
        type: 1,
        name: "test",
        version: "1.0.0",
        // @ts-expect-error - testing error case
        onOperationStart: null,
      });
    }).toThrow(/hook/i);
  });

  test("accepts valid InstrumentKind values", () => {
    const validKinds = [
      { kind: 0, name: "Custom" },
      { kind: 1, name: "HTTP" },
      { kind: 2, name: "Fetch" },
      { kind: 3, name: "SQL" },
      { kind: 4, name: "Redis" },
      { kind: 5, name: "S3" },
    ];

    const ids: number[] = [];

    validKinds.forEach(({ kind, name }) => {
      const id = Bun.telemetry.attach({
        type: kind,
        name: `test-${name}`,
        version: "1.0.0",
        onOperationStart: () => {},
      });

      expect(id).toBeGreaterThan(0);
      ids.push(id);
    });

    // Cleanup
    ids.forEach(id => Bun.telemetry.detach(id));
  });

  test("optional properties can be omitted", () => {
    // Only name and version might be optional in some implementations
    // But type and at least one hook are required
    const id = Bun.telemetry.attach({
      type: 1,
      name: "minimal",
      version: "1.0.0",
      onOperationStart: () => {},
      // All other hooks omitted
    });

    expect(id).toBeGreaterThan(0);
    Bun.telemetry.detach(id);
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
    const result = Bun.telemetry.detach(-1);
    expect(result).toBe(false);
  });

  test("handles zero ID gracefully", () => {
    const result = Bun.telemetry.detach(0);
    expect(result).toBe(false);
  });
});

describe("Bun.telemetry.isEnabledFor() validation", () => {
  test("returns false for invalid kind types", () => {
    // @ts-expect-error - testing error case
    expect(Bun.telemetry.isEnabledFor("http")).toBe(false);

    // @ts-expect-error - testing error case
    expect(Bun.telemetry.isEnabledFor({})).toBe(false);

    // @ts-expect-error - testing error case
    expect(Bun.telemetry.isEnabledFor(null)).toBe(false);
  });

  test("returns false for out-of-range kind values", () => {
    expect(Bun.telemetry.isEnabledFor(-1)).toBe(false);
    expect(Bun.telemetry.isEnabledFor(999)).toBe(false);
  });

  test("returns false when called with no arguments", () => {
    // @ts-expect-error - testing error case
    expect(Bun.telemetry.isEnabledFor()).toBe(false);
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
    expect(result.length).toBe(0); // Out of range should return empty
  });
});
