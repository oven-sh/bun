import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun.ms - parse (string to number)", () => {
  test("short strings", () => {
    const cases = [
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
    ] as const;

    for (const [input, expected] of cases) {
      expect(Bun.ms(input)).toBe(expected);
    }
  });

  test("long strings", () => {
    const cases = [
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
    ] as const;

    for (const [input, expected] of cases) {
      expect(Bun.ms(input)).toBe(expected);
    }
  });

  test("case insensitive", () => {
    const cases = [
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
    ] as const;

    for (const [input, expected] of cases) {
      expect(Bun.ms(input)).toBe(expected);
    }
  });

  test("invalid inputs", () => {
    const cases = [
      ["", "empty string"],
      [" ", "whitespace only"],
      ["foo", "invalid unit"],
      ["1x", "unknown unit"],
      ["1.2.3s", "multiple dots"],
    ] as const;

    for (const [input] of cases) {
      expect(Bun.ms(input)).toBeNaN();
    }
  });
});

describe("Bun.ms - format (number to string)", () => {
  test("short format", () => {
    const cases = [
      [0, "0ms"],
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
    ] as const;

    for (const [input, expected] of cases) {
      expect(Bun.ms(input)).toBe(expected);
    }
  });

  test("long format", () => {
    const cases = [
      [0, "0 ms"],
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
    ] as const;

    for (const [input, expected] of cases) {
      expect(Bun.ms(input, { long: true })).toBe(expected);
    }
  });

  test("rounding behavior matches JavaScript Math.round and npm ms", () => {
    // JavaScript Math.round uses "round half toward +∞"
    // Positive ties (X.5) round up (away from zero): 2.5 → 3
    // Negative ties (X.5) round up toward zero: -2.5 → -2
    // This is different from Zig's @round which rounds away from zero
    //  (so we made our own jsMathRound function)
    const cases = [
      // Positive ties - should round up
      [1000, "1s", "1 second"],
      [1500, "2s", "2 seconds"],
      [2500, "3s", "3 seconds"],
      [3500, "4s", "4 seconds"],
      [4500, "5s", "5 seconds"],

      // Negative ties - should round toward zero (toward +∞)
      [-1000, "-1s", "-1 second"],
      [-1500, "-1s", "-1 seconds"],
      [-2500, "-2s", "-2 seconds"],
      [-3500, "-3s", "-3 seconds"],
      [-4500, "-4s", "-4 seconds"],

      [9000000, "3h", "3 hours"],
      [-9000000, "-2h", "-2 hours"],

      [216000000, "3d", "3 days"],
      [-216000000, "-2d", "-2 days"],
    ] as const;

    for (const [input, expectedShort, expectedLong] of cases) {
      expect(Bun.ms(input)).toBe(expectedShort);
      expect(Bun.ms(input, { long: true })).toBe(expectedLong);
    }
  });

  test("invalid number inputs", () => {
    expect(() => Bun.ms(NaN)).toThrow();
    expect(() => Bun.ms(Infinity)).toThrow();
    expect(() => Bun.ms(-Infinity)).toThrow();
  });
});

describe("Bun.ms - comprehensive coverage", () => {
  test("all time units", () => {
    const cases = [
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
    ] as const;

    for (const [input, expected] of cases) {
      expect(Bun.ms(input)).toBe(expected);
    }
  });

  test("decimals and negatives", () => {
    const cases = [
      ["1.5s", 1500],
      ["1.5h", 5400000],
      ["0.5d", 43200000],
      ["-1s", -1000],
      ["-1.5h", -5400000],
      ["-0.5d", -43200000],
      [".5s", 500],
      ["-.5s", -500],
    ] as const;

    for (const [input, expected] of cases) {
      expect(Bun.ms(input)).toBe(expected);
    }
  });

  test("whitespace handling", () => {
    const cases = [
      ["1 s", 1000],
      ["1  s", 1000],
      ["1   s", 1000],
      [" 1s", NaN],
      ["1s ", NaN],
      [" 1s ", NaN],
      ["1 second", 1000],
      ["1  seconds", 1000],
      ["  1 second  ", NaN],
    ] as const;

    for (const [input, expected] of cases) {
      expect(Bun.ms(input)).toBe(expected);
    }
  });
});

test("Bun.ms - dynamic values at runtime", () => {
  {
    function getNumber() {
      return Math.random() > 0.5 ? 1 : 2;
    }
    const days = getNumber();
    const result = Bun.ms(days + "days");

    // Should be either 1 day or 2 days
    expect(result === 86400000 || result === 172800000).toBe(true);
  }

  {
    function getHours() {
      return 5;
    }
    const result = Bun.ms(String(getHours()) + "h");
    expect(result).toBe(18000000); // 5 hours
  }

  {
    const timeStr = "10m";
    const result = Bun.ms(timeStr);
    expect(result).toBe(600000);
  }

  {
    function getMs() {
      return 60000;
    }
    const result = Bun.ms(getMs());
    expect(result).toBe("1m");
  }
});

test("Bun.ms - static string formatting", () => {
  expect(Bun.ms("5s")).toBe(5000);
  expect(Bun.ms(5000, { long: true })).toBe("5 seconds");
  expect(Bun.ms(5000, { long: false })).toBe("5s");
});

test("Bun.ms - bundler output", async () => {
  const dir = tempDirWithFiles("ms-bundler", {
    "entry.ts": `
const dynamic = () => Math.random() > 0.5 ? 1 : 2;

export const values = {
  // Valid strings - should inline to numbers
  oneSecond: Bun.ms("1s"),
  oneMinute: Bun.ms("1m"),
  oneHour: Bun.ms("1h"),
  oneDay: Bun.ms("1d"),
  twoWeeks: Bun.ms("2w"),
  halfYear: Bun.ms("0.5y"),
  withSpaces: Bun.ms("5 minutes"),
  negative: Bun.ms("-10s"),
  decimal: Bun.ms("1.5h"),
  justNumber: Bun.ms("100"),
  caseInsensitive: Bun.ms("2D"),

  // Invalid strings - should inline to NaN
  invalid: Bun.ms("invalid"),
  empty: Bun.ms(""),

  // Number inputs - should inline to strings
  formatShort: Bun.ms(1000),
  formatLong: Bun.ms(60000, { long: true }),

  // dynamic should not inline
  dynamic: Bun.ms(\`\$\{dynamic()\}s\`),

  // test
  dontBeWeird: abc.ms("1s"),
};
    `,
    "bun.ts": `
import { ms, sleep } from "bun";

const dynamic = () => Math.random() > 0.5 ? 1 : 2;

export const values = {
  import: ms("1s"),
  importLong: ms(1000, { long: true }),
  ms: Bun.ms(),
  mss: ms,
  sleep: sleep,
  dynamic: ms(\`\${dynamic()}s\`),
  dontBeWeird: abc.ms("1s"),
};
`,
  });

  const result = await Bun.build({
    entrypoints: [join(dir, "entry.ts")],
    minify: {
      syntax: true,
    },
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  let output = await result.outputs[0].text();
  output = output.replace(/\/\/.*?\/entry\.ts/, "// entry.ts");

  expect(output).toMatchInlineSnapshot(`
    "// entry.ts
    var dynamic = () => Math.random() > 0.5 ? 1 : 2, values = {
      oneSecond: 1000,
      oneMinute: 60000,
      oneHour: 3600000,
      oneDay: 86400000,
      twoWeeks: 1209600000,
      halfYear: 15778800000,
      withSpaces: 300000,
      negative: -1e4,
      decimal: 5400000,
      justNumber: 100,
      caseInsensitive: 172800000,
      invalid: NaN,
      empty: NaN,
      formatShort: "1s",
      formatLong: "1 minute",
      dynamic: Bun.ms(\`\${dynamic()}s\`),
      dontBeWeird: abc.ms("1s")
    };
    export {
      values
    };
    "
  `);

  const bunResult = await Bun.build({
    entrypoints: [join(dir, "bun.ts")],
    minify: {
      syntax: true,
    },
    target: "bun",
  });

  expect(bunResult.success).toBe(true);
  expect(bunResult.outputs).toHaveLength(1);

  let bunOutput = await bunResult.outputs[0].text();
  bunOutput = bunOutput.replace(/\/\/.*?\/bun\.ts/, "// bun.ts");

  expect(bunOutput).toMatchInlineSnapshot(`
    "// @bun
    // bun.ts
    var {ms, sleep } = globalThis.Bun;
    var dynamic = () => Math.random() > 0.5 ? 1 : 2, values = {
      import: 1000,
      importLong: "1 second",
      ms: Bun.ms(),
      mss: ms,
      sleep,
      dynamic: ms(\`\${dynamic()}s\`),
      dontBeWeird: abc.ms("1s")
    };
    export {
      values
    };
    "
  `);
});
