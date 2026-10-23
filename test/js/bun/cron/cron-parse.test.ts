import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// Bun.cron.parse() and the in-process Bun.cron(schedule, handler) interpret
// schedules in the system's local time zone, matching the OS-level
// Bun.cron(path, schedule, title) overload (crontab/launchd/schtasks). The
// algorithm tests below pin { tz: "UTC" } so the expected values are
// independent of the host's zone. Zone-sensitive and DST cases live in
// cron-local-time.test.ts.

function parseUTC(expr: string, fromISO: string): string {
  return Bun.cron.parse(expr, new Date(fromISO), { tz: "UTC" })?.toISOString() ?? "null";
}

describe("Bun.cron.parse — algorithm (pinned tz: UTC)", () => {
  test("weekday matching uses local day-of-week", () => {
    // 2026-06-15 is a Monday in UTC.
    expect(parseUTC("0 12 * * MON", "2026-06-14T23:00:00Z")).toBe("2026-06-15T12:00:00.000Z");
  });

  test("strictly-after: from = exact match returns the next occurrence", () => {
    expect(parseUTC("0 9 * * *", "2026-06-15T09:00:00Z")).toBe("2026-06-16T09:00:00.000Z");
  });

  test("Feb 29 finds next leap year", () => {
    expect(parseUTC("0 0 29 2 *", "2026-01-01T00:00:00Z")).toBe("2028-02-29T00:00:00.000Z");
  });

  test("impossible day/month (Feb 30) returns null quickly", () => {
    // The first date conversion in a process pays a one-time setup cost
    // (about 150 ms in a debug build). Pay it before the walk is timed.
    Bun.cron.parse("* * * * *", 0, { tz: "UTC" });
    const t = performance.now();
    expect(Bun.cron.parse("0 0 30 2 *", new Date("2026-01-01T00:00:00Z"), { tz: "UTC" })).toBeNull();
    // Guards against the search spinning through the full 8-year window; that
    // pathological loop is orders of magnitude above this ceiling even under
    // ASAN, where the first in-process parse (tzdata init) is ~150ms.
    expect(performance.now() - t).toBeLessThan(isDebug ? 1000 : 50);
  });

  test("DOM/DOW OR semantics when both restricted", () => {
    // 0 0 13 * 5 → every 13th OR every Friday. From 2026-01-01 (Thu), first is Fri Jan 2.
    expect(parseUTC("0 0 13 * 5", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("Bun.cron.parse — weekday 7 = Sunday in ranges", () => {
  // 2026-01-01 is a Thursday. next() is strictly-after, so the first match for
  // an every-day schedule is 2026-01-02.
  test.each([
    ["1-7", "Mon-Sun (every day)", "2026-01-02T00:00:00.000Z"],
    ["5-7", "Fri-Sun", "2026-01-02T00:00:00.000Z"],
    ["6-7", "Sat-Sun", "2026-01-03T00:00:00.000Z"],
    ["0-7", "every day", "2026-01-02T00:00:00.000Z"],
    ["7", "Sunday (scalar)", "2026-01-04T00:00:00.000Z"],
  ])("0 0 * * %s means %s", (dow, _desc, expected) => {
    expect(parseUTC(`0 0 * * ${dow}`, "2026-01-01T00:00:00Z")).toBe(expected);
  });
});

describe("Bun.cron.parse — invalid `from` argument", () => {
  // Values outside the ECMAScript Date range (±8.64e15 ms) used to reach
  // WTF::msToGregorianDateTime's undefined int casts and panic in next().
  test.each([
    1e300,
    -1e300,
    4e18,
    8.7e15,
    -8.7e15,
    8.64e15 + 1,
    -8.64e15 - 1,
    Number.MAX_VALUE,
    Infinity,
    -Infinity,
    NaN,
  ])("throws for out-of-range/non-finite ms: %p", from => {
    expect(() => Bun.cron.parse("* * * * *", from)).toThrow("Invalid date value");
    expect(() => Bun.cron.parse("* * * * *", new Date(from))).toThrow("Invalid date value");
  });

  // The ±8.64e15 boundary values exercise WTF::GregorianDateTime at its limits,
  // and 1e300 used to hit a native panic; both stay in a subprocess so a
  // regression in either can't take down the test runner. Pins TZ=UTC via env
  // to test the CronTz::Local path the original regression was in.
  test("accepts the Date range boundary and rejects 1e300 without crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const out = {};
         // from = +8.64e15 is +275760-09-13T00:00:00Z; the next occurrence falls
         // past the representable range → null, not an Invalid Date.
         out.upper = Bun.cron.parse("* * * * *", 8.64e15);
         // from = -8.64e15 is -271821-04-20T00:00:00Z; next minute is in range.
         out.lower = Bun.cron.parse("* * * * *", -8.64e15)?.toISOString();
         // Just inside the upper boundary: next minute lands exactly on 8.64e15.
         out.inside = Bun.cron.parse("* * * * *", 8.64e15 - 60_000)?.getTime();
         try { Bun.cron.parse("* * * * *", 1e300); } catch (e) { out.huge = e.message; }
         process.stdout.write(JSON.stringify(out));`,
      ],
      env: { ...bunEnv, TZ: "UTC" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: {
        upper: null,
        lower: "-271821-04-20T00:01:00.000Z",
        inside: 8.64e15,
        huge: "Invalid date value",
      },
      stderr: "",
      exitCode: 0,
    });
  });
});

// 8.64e15 ms is +275760-09-13T00:00:00Z, the last instant a Date holds. JSC
// converts no time value more than a day past it to a calendar date. A debug
// build asserts. Newer JSC returns year 0, which made the walk start over and
// never stop. Both tests spawn, with a kill switch on the child.
describe("Bun.cron — end of the Date range", () => {
  test("Bun.cron.parse stops the walk at the last day", async () => {
    // [tz, schedule for the wall-clock minute of 8.64e15 in that zone, one minute later]
    const zones = [
      [null, "0 0 13 9 *", "1 0 13 9 *"], // local time, TZ=UTC
      ["UTC", "0 0 13 9 *", "1 0 13 9 *"],
      ["America/New_York", "0 20 12 9 *", "1 20 12 9 *"],
      ["Pacific/Kiritimati", "0 14 13 9 *", "1 14 13 9 *"],
    ];
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const max = 8.64e15, day = 86_400_000;
         const out = {};
         for (const [tz, lastMinute, oneMinuteLater] of ${JSON.stringify(zones)}) {
           const next = (expr, from) => Bun.cron.parse(expr, from, tz ? { tz } : undefined)?.getTime() ?? null;
           const first = next("* * * * *", -max);
           out[tz ?? "local"] = [
             // Every minute after max is past the range.
             next("* * * * *", max),
             next("0 0 1 1 *", max),
             // One minute inside the range lands on the end of it.
             next("* * * * *", max - 60_000),
             // Feb 30 never exists: the walk runs into the end of the range.
             next("0 0 30 2 *", max - 400 * day),
             // The next Jan 1 is in year 275761.
             next("0 0 1 1 *", max - 10 * day),
             next("0 0 14 9 *", max - 10 * day),
             // The last minute of the range still matches. One minute later does not.
             next(lastMinute, max - 10 * day),
             next(oneMinuteLater, max - 10 * day),
             // The walk only moves forward, so the lower end needs no bound.
             first > -max && first <= -max + 60_000,
           ];
         }
         process.stdout.write(JSON.stringify(out));`,
      ],
      env: { ...bunEnv, TZ: "UTC" },
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = [null, null, 8.64e15, null, null, null, 8.64e15, null, true];
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      out: { local: expected, UTC: expected, "America/New_York": expected, "Pacific/Kiritimati": expected },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // Bun.cron.parse rejects a `from` outside the range. The scheduler reads the
  // clock, and fake timers can set the clock to any number.
  test("Bun.cron() finds no occurrence when the clock is at or past the end of the range", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { jest } = Bun.jest();
         jest.useFakeTimers();
         const out = [];
         // At the last instant the next minute is past the range. Two days later
         // JSC has no calendar date for the clock itself.
         for (const now of [8.64e15, 8.64e15 + 2 * 86_400_000]) {
           jest.setSystemTime(now);
           try {
             Bun.cron("* * * * *", () => {}).stop();
             out.push("scheduled");
           } catch (e) {
             out.push(e.message);
           }
         }
         process.stdout.write(JSON.stringify(out));`,
      ],
      env: { ...bunEnv, TZ: "UTC" },
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const noOccurrence = "Cron expression '* * * * *' has no future occurrences";
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      out: [noOccurrence, noOccurrence],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
