import { describe, expect, test } from "bun:test";

// `Bun.ms` mirrors the npm `ms` package: a string parses to milliseconds, and
// a number formats to a human-readable string. Expectations below match the
// real `ms` package (note: like `ms`, months are NOT a supported unit, and a
// year is 365.25 days).
describe("Bun.ms", () => {
  describe("parse (string -> number)", () => {
    test("compact units", () => {
      const cases: [string, number][] = [
        ["100", 100],
        ["1ms", 1],
        ["1s", 1000],
        ["1m", 60000],
        ["1h", 3600000],
        ["1d", 86400000],
        ["1w", 604800000],
        ["1y", 31557600000], // 365.25 days
        ["2d", 172800000],
        ["3w", 1814400000],
        ["1.5h", 5400000],
        ["0.5s", 500],
        [".5ms", 0.5],
        ["-1h", -3600000],
        ["-.5h", -1800000],
        ["-200", -200],
        ["1   s", 1000], // whitespace between number and unit
      ];
      for (const [input, expected] of cases) {
        expect(Bun.ms(input)).toBe(expected);
      }
    });

    test("long units", () => {
      const cases: [string, number][] = [
        ["53 milliseconds", 53],
        ["17 msecs", 17],
        ["1 sec", 1000],
        ["1 second", 1000],
        ["10 seconds", 10000],
        ["1 min", 60000],
        ["1 minute", 60000],
        ["5 minutes", 300000],
        ["1 hr", 3600000],
        ["1 hour", 3600000],
        ["2 days", 172800000],
        ["1 week", 604800000],
        ["1 year", 31557600000],
        ["-1.5 hours", -5400000],
        ["-10 minutes", -600000],
      ];
      for (const [input, expected] of cases) {
        expect(Bun.ms(input)).toBe(expected);
      }
    });

    test("unit parsing is case-insensitive", () => {
      expect(Bun.ms("1H")).toBe(3600000);
      expect(Bun.ms("2D")).toBe(172800000);
      expect(Bun.ms("1 HOUR")).toBe(3600000);
      expect(Bun.ms("1 Week")).toBe(604800000);
    });

    test("unparseable non-empty strings return undefined (matches ms)", () => {
      // `ms` returns undefined (not a throw) when the regex doesn't match, so
      // `Bun.ms(input) ?? fallback` works.
      expect(Bun.ms("foo")).toBeUndefined();
      expect(Bun.ms("1 fortnight")).toBeUndefined();
      // Months are not a supported unit (matching the `ms` package).
      expect(Bun.ms("1 month")).toBeUndefined();
      expect(Bun.ms("1mo")).toBeUndefined();
    });

    test("empty string throws (matches ms: requires a non-empty string)", () => {
      expect(() => Bun.ms("")).toThrow();
    });
  });

  describe("format (number -> string)", () => {
    test("compact form", () => {
      const cases: [number, string][] = [
        [500, "500ms"],
        [-500, "-500ms"],
        [1000, "1s"],
        [10000, "10s"],
        [60000, "1m"],
        [-60000, "-1m"],
        [3600000, "1h"],
        [86400000, "1d"],
        [172800000, "2d"],
        [604800000, "7d"], // a week formats as days in the `ms` compact form
        [0, "0ms"],
      ];
      for (const [input, expected] of cases) {
        expect(Bun.ms(input)).toBe(expected);
      }
    });

    test("long form", () => {
      const cases: [number, string][] = [
        [500, "500 ms"],
        [1000, "1 second"],
        [2000, "2 seconds"],
        [60000, "1 minute"],
        [120000, "2 minutes"],
        [3600000, "1 hour"],
        [7200000, "2 hours"],
        [86400000, "1 day"],
        [172800000, "2 days"],
        [-3600000, "-1 hour"],
      ];
      for (const [input, expected] of cases) {
        expect(Bun.ms(input, { long: true })).toBe(expected);
      }
    });

    test("rounds like the ms package (round half toward +Infinity)", () => {
      // 1.5 minutes rounds up to 2m; pluralization kicks in at >= 1.5x.
      expect(Bun.ms(90000)).toBe("2m");
      expect(Bun.ms(90000, { long: true })).toBe("2 minutes");
      // Just under 1.5 minutes stays "1m" / singular "1 minute".
      expect(Bun.ms(89000)).toBe("1m");
      expect(Bun.ms(89000, { long: true })).toBe("1 minute");
    });

    test("round-trips through parse", () => {
      // `!`: the string overload returns `number | undefined`, and these inputs
      // are known-parseable.
      expect(Bun.ms(Bun.ms("2 days")!)).toBe("2d");
      expect(Bun.ms(Bun.ms("1h")!, { long: true })).toBe("1 hour");
    });

    test("sub-second values are not truncated (matches ms: `ms + 'ms'`)", () => {
      expect(Bun.ms(1.5)).toBe("1.5ms");
      expect(Bun.ms(0.5)).toBe("0.5ms");
      expect(Bun.ms(-0.5)).toBe("-0.5ms");
      expect(Bun.ms(1.5, { long: true })).toBe("1.5 ms");
    });

    test("rejects non-finite numbers", () => {
      expect(() => Bun.ms(NaN)).toThrow();
      expect(() => Bun.ms(Infinity)).toThrow();
      expect(() => Bun.ms(-Infinity)).toThrow();
    });
  });

  describe("strict input types (matches ms: string or finite number only)", () => {
    test("throws on non-string / non-number values instead of coercing", () => {
      // npm `ms` does a strict typeof check and throws for all of these.
      expect(() => (Bun.ms as any)(true)).toThrow();
      expect(() => (Bun.ms as any)(null)).toThrow();
      expect(() => (Bun.ms as any)(undefined)).toThrow();
      expect(() => (Bun.ms as any)([])).toThrow();
      expect(() => (Bun.ms as any)({})).toThrow();
      expect(() => (Bun.ms as any)()).toThrow();
    });

    test("boxed String/Number objects throw (typeof is 'object')", () => {
      // `ms` checks `typeof val === "string"/"number"`, which is "object" for
      // boxed primitives, so these hit the throw path.
      expect(() => (Bun.ms as any)(new String("1h"))).toThrow();
      expect(() => (Bun.ms as any)(new Number(60000))).toThrow();
    });
  });
});
