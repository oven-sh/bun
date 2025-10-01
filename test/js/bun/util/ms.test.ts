import { test, expect, describe } from "bun:test";

describe("Bun.ms - parse (string to number)", () => {
  describe("short strings", () => {
    test.each([
      ["100", 100],
      ["1m", 60000],
      ["1h", 3600000],
      ["2d", 172800000],
      ["3w", 1814400000],
      ["1s", 1000],
      ["100ms", 100],
      ["1y", 31557600000],
      ["1.5h", 5400000],
      ["1   s", 1000],
      ["-.5h", -1800000],
      ["-1h", -3600000],
      ["-200", -200],
      [".5ms", 0.5],
    ])('Bun.ms("%s") should return %d', (input, expected) => {
      expect(Bun.ms(input)).toBe(expected);
    });
  });

  describe("long strings", () => {
    test.each([
      ["53 milliseconds", 53],
      ["17 msecs", 17],
      ["1 sec", 1000],
      ["1 min", 60000],
      ["1 hr", 3600000],
      ["2 days", 172800000],
      ["1 week", 604800000],
      ["1 month", 2629800000],
      ["1 year", 31557600000],
      ["1.5 hours", 5400000],
      ["-100 milliseconds", -100],
      ["-1.5 hours", -5400000],
      ["-10 minutes", -600000],
    ])('Bun.ms("%s") should return %d', (input, expected) => {
      expect(Bun.ms(input)).toBe(expected);
    });
  });

  describe("case insensitive", () => {
    test.each([
      ["1M", 60000],
      ["1H", 3600000],
      ["2D", 172800000],
      ["3W", 1814400000],
      ["1S", 1000],
      ["1MS", 1],
      ["1Y", 31557600000],
      ["1 HOUR", 3600000],
      ["1 DAY", 86400000],
      ["1 WEEK", 604800000],
    ])('Bun.ms("%s") should return %d', (input, expected) => {
      expect(Bun.ms(input)).toBe(expected);
    });
  });

  describe("invalid inputs", () => {
    test.each([
      ["", "empty string"],
      [" ", "whitespace only"],
      ["foo", "invalid unit"],
      ["1x", "unknown unit"],
      ["1.2.3s", "multiple dots"],
    ])('Bun.ms("%s") should return NaN (%s)', (input) => {
      expect(Bun.ms(input)).toBeNaN();
    });
  });
});

describe("Bun.ms - format (number to string)", () => {
  describe("short format", () => {
    test.each([
      [500, "500ms"],
      [-500, "-500ms"],
      [1000, "1s"],
      [10000, "10s"],
      [60000, "1m"],
      [600000, "10m"],
      [3600000, "1h"],
      [86400000, "1d"],
      [604800000, "1w"],
      [2629800000, "1mo"],
      [31557600001, "1y"],
      [234234234, "3d"],
      [-234234234, "-3d"],
    ])("Bun.ms(%d) should return %s", (input, expected) => {
      expect(Bun.ms(input)).toBe(expected);
    });
  });

  describe("long format", () => {
    test.each([
      [500, "500 ms"],
      [-500, "-500 ms"],
      [1000, "1 second"],
      [1001, "1 second"],
      [1499, "1 second"],
      [1500, "2 seconds"],
      [10000, "10 seconds"],
      [60000, "1 minute"],
      [600000, "10 minutes"],
      [3600000, "1 hour"],
      [86400000, "1 day"],
      [172800000, "2 days"],
      [604800000, "1 week"],
      [2629800000, "1 month"],
      [31557600001, "1 year"],
      [234234234, "3 days"],
      [-234234234, "-3 days"],
    ])("Bun.ms(%d, { long: true }) should return %s", (input, expected) => {
      expect(Bun.ms(input, { long: true })).toBe(expected);
    });
  });

  describe("invalid number inputs", () => {
    test("NaN should throw", () => {
      expect(() => Bun.ms(NaN)).toThrow();
    });

    test("Infinity should throw", () => {
      expect(() => Bun.ms(Infinity)).toThrow();
    });

    test("-Infinity should throw", () => {
      expect(() => Bun.ms(-Infinity)).toThrow();
    });
  });
});

describe("Bun.ms - comprehensive coverage", () => {
  describe("all time units", () => {
    test.each([
      // Milliseconds
      ["1ms", 1],
      ["1millisecond", 1],
      ["1milliseconds", 1],
      ["1msec", 1],
      ["1msecs", 1],
      // Seconds
      ["1s", 1000],
      ["1sec", 1000],
      ["1secs", 1000],
      ["1second", 1000],
      ["1seconds", 1000],
      ["2seconds", 2000],
      // Minutes
      ["1m", 60000],
      ["1min", 60000],
      ["1mins", 60000],
      ["1minute", 60000],
      ["1minutes", 60000],
      ["2minutes", 120000],
      // Hours
      ["1h", 3600000],
      ["1hr", 3600000],
      ["1hrs", 3600000],
      ["1hour", 3600000],
      ["1hours", 3600000],
      ["2hours", 7200000],
      // Days
      ["1d", 86400000],
      ["1day", 86400000],
      ["1days", 86400000],
      ["2days", 172800000],
      // Weeks
      ["1w", 604800000],
      ["1week", 604800000],
      ["1weeks", 604800000],
      ["2weeks", 1209600000],
      // Months
      ["1mo", 2629800000],
      ["1month", 2629800000],
      ["1months", 2629800000],
      ["2months", 5259600000],
      // Years
      ["1y", 31557600000],
      ["1yr", 31557600000],
      ["1yrs", 31557600000],
      ["1year", 31557600000],
      ["1years", 31557600000],
      ["2years", 63115200000],
    ])('Bun.ms("%s") should parse correctly', (input, expected) => {
      expect(Bun.ms(input)).toBe(expected);
    });
  });

  describe("decimals and negatives", () => {
    test.each([
      ["1.5s", 1500],
      ["1.5h", 5400000],
      ["0.5d", 43200000],
      ["-1s", -1000],
      ["-1.5h", -5400000],
      ["-0.5d", -43200000],
      [".5s", 500],
      ["-.5s", -500],
    ])('Bun.ms("%s") should handle decimals/negatives', (input, expected) => {
      expect(Bun.ms(input)).toBe(expected);
    });
  });

  describe("whitespace handling", () => {
    test.each([
      ["1 s", 1000],
      ["1  s", 1000],
      ["1   s", 1000],
      [" 1s", 1000],
      ["1s ", 1000],
      [" 1s ", 1000],
      ["1 second", 1000],
      ["1  seconds", 1000],
      ["  1 second  ", 1000],
    ])('Bun.ms("%s") should handle whitespace', (input, expected) => {
      expect(Bun.ms(input)).toBe(expected);
    });
  });
});

describe("Bun.ms - dynamic values at runtime", () => {
  test("dynamic string concatenation", () => {
    function getNumber() {
      return Math.random() > 0.5 ? 1 : 2;
    }
    const days = getNumber();
    const result = Bun.ms(days + "days");

    // Should be either 1 day or 2 days
    expect(result === 86400000 || result === 172800000).toBe(true);
  });

  test("template literal with function call", () => {
    function getHours() {
      return 5;
    }
    const result = Bun.ms(String(getHours()) + "h");
    expect(result).toBe(18000000); // 5 hours
  });

  test("variable string", () => {
    const timeStr = "10m";
    const result = Bun.ms(timeStr);
    expect(result).toBe(600000);
  });

  test("dynamic number formatting", () => {
    function getMs() {
      return 60000;
    }
    const result = Bun.ms(getMs());
    expect(result).toBe("1m");
  });
});
