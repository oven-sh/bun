import { test, expect } from "bun:test";

const ms = Bun.ms;

// Comprehensive test cases matching the ms library behavior
// Format: [input, expected output]
const parseTests: [string, number | undefined][] = [
  // Milliseconds - all variations
  ["1ms", 1],
  ["1 ms", 1],
  ["100ms", 100],
  ["100 ms", 100],
  ["1.5ms", 1.5],
  ["1millisecond", 1],
  ["1 millisecond", 1],
  ["100milliseconds", 100],
  ["100 milliseconds", 100],
  ["1msec", 1],
  ["1 msec", 1],
  ["100msecs", 100],
  ["100 msecs", 100],

  // Seconds - all variations
  ["1s", 1000],
  ["1 s", 1000],
  ["1sec", 1000],
  ["1 sec", 1000],
  ["1secs", 1000],
  ["1 secs", 1000],
  ["1second", 1000],
  ["1 second", 1000],
  ["1seconds", 1000],
  ["1 seconds", 1000],
  ["2s", 2000],
  ["5s", 5000],
  ["10s", 10000],
  ["1.5s", 1500],
  ["2.5s", 2500],
  ["0.5s", 500],
  [".5s", 500],

  // Minutes - all variations
  ["1m", 60000],
  ["1 m", 60000],
  ["1min", 60000],
  ["1 min", 60000],
  ["1mins", 60000],
  ["1 mins", 60000],
  ["1minute", 60000],
  ["1 minute", 60000],
  ["1minutes", 60000],
  ["1 minutes", 60000],
  ["2m", 120000],
  ["5m", 300000],
  ["10m", 600000],
  ["0.5m", 30000],
  ["1.5m", 90000],
  [".5m", 30000],

  // Hours - all variations
  ["1h", 3600000],
  ["1 h", 3600000],
  ["1hr", 3600000],
  ["1 hr", 3600000],
  ["1hrs", 3600000],
  ["1 hrs", 3600000],
  ["1hour", 3600000],
  ["1 hour", 3600000],
  ["1hours", 3600000],
  ["1 hours", 3600000],
  ["2h", 7200000],
  ["10h", 36000000],
  ["24h", 86400000],
  ["0.5h", 1800000],
  ["1.5h", 5400000],
  ["2.5h", 9000000],
  [".5h", 1800000],

  // Days - all variations
  ["1d", 86400000],
  ["1 d", 86400000],
  ["1day", 86400000],
  ["1 day", 86400000],
  ["1days", 86400000],
  ["1 days", 86400000],
  ["2d", 172800000],
  ["7d", 604800000],
  ["0.5d", 43200000],
  ["1.5d", 129600000],
  [".5d", 43200000],

  // Weeks - all variations
  ["1w", 604800000],
  ["1 w", 604800000],
  ["1week", 604800000],
  ["1 week", 604800000],
  ["1weeks", 604800000],
  ["1 weeks", 604800000],
  ["2w", 1209600000],
  ["4w", 2419200000],
  ["0.5w", 302400000],
  ["1.5w", 907200000],

  // Years - all variations
  ["1y", 31557600000],
  ["1 y", 31557600000],
  ["1yr", 31557600000],
  ["1 yr", 31557600000],
  ["1yrs", 31557600000],
  ["1 yrs", 31557600000],
  ["1year", 31557600000],
  ["1 year", 31557600000],
  ["1years", 31557600000],
  ["1 years", 31557600000],
  ["2y", 63115200000],
  ["0.5y", 15778800000],
  ["1.5y", 47336400000],

  // Numbers without units (treated as ms)
  ["1", 1],
  ["100", 100],
  ["1000", 1000],
  ["0", 0],
  ["53", 53],

  // Negative values - all units
  ["-1ms", -1],
  ["-100ms", -100],
  ["-1s", -1000],
  ["-10s", -10000],
  ["-1m", -60000],
  ["-5m", -300000],
  ["-1h", -3600000],
  ["-2h", -7200000],
  ["-1d", -86400000],
  ["-2d", -172800000],
  ["-1w", -604800000],
  ["-1y", -31557600000],
  ["-0.5s", -500],
  ["-0.5m", -30000],
  ["-1.5h", -5400000],
  ["-100", -100],

  // Case insensitive - all units
  ["1MS", 1],
  ["1Ms", 1],
  ["1mS", 1],
  ["1S", 1000],
  ["1Sec", 1000],
  ["1SECOND", 1000],
  ["1M", 60000],
  ["1Min", 60000],
  ["1MINUTE", 60000],
  ["1H", 3600000],
  ["1Hr", 3600000],
  ["1HOUR", 3600000],
  ["1D", 86400000],
  ["1Day", 86400000],
  ["1DAY", 86400000],
  ["1W", 604800000],
  ["1Week", 604800000],
  ["1WEEK", 604800000],
  ["1Y", 31557600000],
  ["1Yr", 31557600000],
  ["1YEAR", 31557600000],

  // Edge cases with whitespace
  ["  1s", 1000],
  ["1s  ", 1000],
  ["  1s  ", 1000],
  ["1  s", 1000],
  ["1   s", 1000],

  // Invalid inputs - should return undefined
  ["", undefined],
  [" ", undefined],
  ["   ", undefined],
  ["invalid", undefined],
  ["hello world", undefined],
  ["s", undefined],
  ["m", undefined],
  ["h", undefined],
  ["ms", undefined],
  ["1x", undefined],
  ["1xs", undefined],
  ["1sm", undefined],
  ["1s2m", undefined],
  ["1 s 2 m", undefined],
  ["s1", undefined],
  ["1.2.3s", undefined],
  ["NaN", undefined],
  ["Infinity", undefined],
  ["-", undefined],
  [".", undefined],
  ["-.5s", -500], // This should work
  ["abc123", undefined],
  ["123abc", undefined],
  ["1.s", 1000], // Should parse as "1" with unit "s"
];

test.each(parseTests)("parse: ms(%p) === %p", (input, expected) => {
  expect(ms(input)).toBe(expected);
});

// Test format (number -> string)
const formatTests: [number, { long?: boolean } | undefined, string][] = [
  // Milliseconds
  [0, undefined, "0ms"],
  [1, undefined, "1ms"],
  [100, undefined, "100ms"],
  [999, undefined, "999ms"],

  // Seconds
  [1000, undefined, "1s"],
  [1500, undefined, "2s"],
  [2000, undefined, "2s"],
  [10000, undefined, "10s"],
  [59000, undefined, "59s"],
  [59999, undefined, "60s"],

  // Minutes
  [60000, undefined, "1m"],
  [90000, undefined, "2m"],
  [120000, undefined, "2m"],
  [300000, undefined, "5m"],
  [3540000, undefined, "59m"],
  [3599999, undefined, "60m"],

  // Hours
  [3600000, undefined, "1h"],
  [5400000, undefined, "2h"],
  [7200000, undefined, "2h"],
  [36000000, undefined, "10h"],
  [82800000, undefined, "23h"],
  [86399999, undefined, "24h"],

  // Days
  [86400000, undefined, "1d"],
  [129600000, undefined, "2d"],
  [172800000, undefined, "2d"],
  [604800000, undefined, "7d"],

  // Negative values
  [-1, undefined, "-1ms"],
  [-1000, undefined, "-1s"],
  [-60000, undefined, "-1m"],
  [-3600000, undefined, "-1h"],
  [-86400000, undefined, "-1d"],

  // Long format - milliseconds
  [0, { long: true }, "0 ms"],
  [1, { long: true }, "1 ms"],
  [100, { long: true }, "100 ms"],
  [999, { long: true }, "999 ms"],

  // Long format - seconds
  [1000, { long: true }, "1 second"],
  [1500, { long: true }, "2 seconds"],
  [2000, { long: true }, "2 seconds"],
  [10000, { long: true }, "10 seconds"],

  // Long format - minutes
  [60000, { long: true }, "1 minute"],
  [90000, { long: true }, "2 minutes"],
  [120000, { long: true }, "2 minutes"],
  [300000, { long: true }, "5 minutes"],

  // Long format - hours
  [3600000, { long: true }, "1 hour"],
  [5400000, { long: true }, "2 hours"],
  [7200000, { long: true }, "2 hours"],
  [36000000, { long: true }, "10 hours"],

  // Long format - days
  [86400000, { long: true }, "1 day"],
  [129600000, { long: true }, "2 days"],
  [172800000, { long: true }, "2 days"],

  // Long format - negative
  [-1000, { long: true }, "-1 second"],
  [-60000, { long: true }, "-1 minute"],
  [-3600000, { long: true }, "-1 hour"],
  [-86400000, { long: true }, "-1 day"],
];

test.each(formatTests)("format: ms(%p, %p) === %p", (input, options, expected) => {
  expect(ms(input, options)).toBe(expected);
});

// Test errors
test("throws on NaN", () => {
  expect(() => ms(NaN)).toThrow("Value must be a finite number");
});

test("throws on Infinity", () => {
  expect(() => ms(Infinity)).toThrow("Value must be a finite number");
});

test("throws on -Infinity", () => {
  expect(() => ms(-Infinity)).toThrow("Value must be a finite number");
});

// Test that it's available on Bun global
test("Bun.ms is available", () => {
  expect(typeof Bun.ms).toBe("function");
  expect(Bun.ms("1s")).toBe(1000);
  expect(Bun.ms(1000)).toBe("1s");
});
