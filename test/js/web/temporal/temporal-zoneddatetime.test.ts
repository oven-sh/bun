import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Temporal is behind a JSC flag (BUN_JSC_useTemporal=1). These tests validate
// the Temporal.ZonedDateTime foundation and the Temporal.Now additions that
// depend on it. Algorithms were ported from the temporal_rs reference
// implementation that V8 / Node.js use.
// Tracking: https://github.com/oven-sh/bun/issues/15853
const env = { ...bunEnv, BUN_JSC_useTemporal: "1", TZ: "UTC" };

async function run(code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("Temporal.ZonedDateTime exists", async () => {
  const { stdout, stderr, exitCode } = await run(`
    console.log(typeof Temporal.ZonedDateTime);
    console.log(Temporal.ZonedDateTime.prototype[Symbol.toStringTag]);
  `);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["function", "Temporal.ZonedDateTime"]);
  expect(exitCode).toBe(0);
});

test("Temporal.ZonedDateTime constructor + getters at Unix epoch in UTC", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const z = new Temporal.ZonedDateTime(0n, "UTC");
    console.log(JSON.stringify({
      epochNs: z.epochNanoseconds.toString(),
      epochMs: z.epochMilliseconds,
      tz: z.timeZoneId,
      cal: z.calendarId,
      offset: z.offset,
      offsetNs: z.offsetNanoseconds,
      y: z.year, m: z.month, mc: z.monthCode, d: z.day,
      h: z.hour, min: z.minute, s: z.second,
      ms: z.millisecond, us: z.microsecond, ns: z.nanosecond,
      dow: z.dayOfWeek, doy: z.dayOfYear,
      diw: z.daysInWeek, dim: z.daysInMonth, diy: z.daysInYear,
      miy: z.monthsInYear, leap: z.inLeapYear,
      str: z.toString(),
    }));
  `);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    epochNs: "0",
    epochMs: 0,
    tz: "UTC",
    cal: "iso8601",
    offset: "+00:00",
    offsetNs: 0,
    y: 1970,
    m: 1,
    mc: "M01",
    d: 1,
    h: 0,
    min: 0,
    s: 0,
    ms: 0,
    us: 0,
    ns: 0,
    dow: 4,
    doy: 1,
    diw: 7,
    dim: 31,
    diy: 365,
    miy: 12,
    leap: false,
    str: "1970-01-01T00:00:00+00:00[UTC]",
  });
  expect(exitCode).toBe(0);
});

test("Temporal.ZonedDateTime offset time zone", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const z = new Temporal.ZonedDateTime(0n, "+05:30");
    console.log(z.timeZoneId, z.offset, z.hour, z.minute, z.toString());
  `);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("+05:30 +05:30 5 30 1970-01-01T05:30:00+05:30[+05:30]");
  expect(exitCode).toBe(0);
});

test("Temporal.ZonedDateTime named IANA zone honors DST", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const summer = new Temporal.ZonedDateTime(BigInt(Date.UTC(2024, 6, 1, 12)) * 1000000n, "America/New_York");
    const winter = new Temporal.ZonedDateTime(BigInt(Date.UTC(2024, 0, 1, 12)) * 1000000n, "America/New_York");
    console.log(summer.offset, summer.hour, winter.offset, winter.hour);
  `);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("-04:00 8 -05:00 7");
  expect(exitCode).toBe(0);
});

test("Temporal.ZonedDateTime conversions", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const z = new Temporal.ZonedDateTime(0n, "+05:00");
    console.log(z.toInstant().epochNanoseconds.toString());
    console.log(z.toPlainDate().toString());
    console.log(z.toPlainTime().toString());
    console.log(z.toPlainDateTime().toString());
    console.log(z.withTimeZone("UTC").toString());
  `);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual([
    "0",
    "1970-01-01",
    "05:00:00",
    "1970-01-01T05:00:00",
    "1970-01-01T00:00:00+00:00[UTC]",
  ]);
  expect(exitCode).toBe(0);
});

test("Temporal.ZonedDateTime negative epoch (sub-nanosecond boundary)", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const z = new Temporal.ZonedDateTime(-1n, "UTC");
    console.log(z.year, z.month, z.day, z.hour, z.minute, z.second, z.millisecond, z.microsecond, z.nanosecond);
    console.log(z.toString());
  `);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual([
    "1969 12 31 23 59 59 999 999 999",
    "1969-12-31T23:59:59.999999999+00:00[UTC]",
  ]);
  expect(exitCode).toBe(0);
});

test("Temporal.ZonedDateTime.compare and equals", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const a = new Temporal.ZonedDateTime(0n, "UTC");
    const b = new Temporal.ZonedDateTime(1n, "UTC");
    const c = new Temporal.ZonedDateTime(0n, "+01:00");
    console.log(Temporal.ZonedDateTime.compare(a, b));
    console.log(Temporal.ZonedDateTime.compare(b, a));
    console.log(Temporal.ZonedDateTime.compare(a, c));
    console.log(a.equals(new Temporal.ZonedDateTime(0n, "UTC")));
    console.log(a.equals(c));
  `);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["-1", "1", "0", "true", "false"]);
  expect(exitCode).toBe(0);
});

test("Temporal.ZonedDateTime error handling", async () => {
  const { stdout, stderr, exitCode } = await run(`
    function errName(fn) { try { fn(); return "no-throw"; } catch(e) { return e.constructor.name; } }
    console.log(errName(() => new Temporal.ZonedDateTime(0n, "Not/AZone")));
    console.log(errName(() => new Temporal.ZonedDateTime(0n, 42)));
    console.log(errName(() => Temporal.ZonedDateTime(0n, "UTC")));
    console.log(errName(() => +new Temporal.ZonedDateTime(0n, "UTC")));
  `);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["RangeError", "TypeError", "TypeError", "TypeError"]);
  expect(exitCode).toBe(0);
});

test("Temporal.Now additions (zonedDateTimeISO/plainDateISO/plainTimeISO/plainDateTimeISO)", async () => {
  const { stdout, stderr, exitCode } = await run(`
    console.log(typeof Temporal.Now.zonedDateTimeISO);
    console.log(typeof Temporal.Now.plainDateISO);
    console.log(typeof Temporal.Now.plainTimeISO);
    console.log(typeof Temporal.Now.plainDateTimeISO);
    console.log(Temporal.Now.zonedDateTimeISO("UTC") instanceof Temporal.ZonedDateTime);
    console.log(Temporal.Now.plainDateISO("UTC") instanceof Temporal.PlainDate);
    console.log(Temporal.Now.plainTimeISO("UTC") instanceof Temporal.PlainTime);
    console.log(Temporal.Now.plainDateTimeISO("UTC") instanceof Temporal.PlainDateTime);
  `);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual([
    "function",
    "function",
    "function",
    "function",
    "true",
    "true",
    "true",
    "true",
  ]);
  expect(exitCode).toBe(0);
});

test("Temporal.Instant.from accepts ZonedDateTime", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const z = new Temporal.ZonedDateTime(12345n, "Asia/Tokyo");
    console.log(Temporal.Instant.from(z).epochNanoseconds.toString());
  `);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("12345");
  expect(exitCode).toBe(0);
});
