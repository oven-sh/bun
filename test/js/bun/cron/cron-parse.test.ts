import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.cron.parse() and the in-process Bun.cron(schedule, handler) interpret
// schedules in the system's local time zone — matching the OS-level
// Bun.cron(path, schedule, title) overload (crontab/launchd/schtasks). The
// algorithm tests below spawn under TZ=UTC so the expected values are
// independent of the host's zone. Zone-sensitive and DST cases live in
// cron-local-time.test.ts.

async function parseUTC(expr: string, fromISO: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdout.write(String(Bun.cron.parse(${JSON.stringify(expr)}, new Date(${JSON.stringify(fromISO)}))?.toISOString() ?? "null"))`,
    ],
    env: { ...bunEnv, TZ: "UTC" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

describe.concurrent("Bun.cron.parse — algorithm (pinned TZ=UTC)", () => {
  test("weekday matching uses local day-of-week", async () => {
    // 2026-06-15 is a Monday in UTC.
    expect(await parseUTC("0 12 * * MON", "2026-06-14T23:00:00Z")).toBe("2026-06-15T12:00:00.000Z");
  });

  test("strictly-after: from = exact match returns the next occurrence", async () => {
    expect(await parseUTC("0 9 * * *", "2026-06-15T09:00:00Z")).toBe("2026-06-16T09:00:00.000Z");
  });

  test("Feb 29 finds next leap year", async () => {
    expect(await parseUTC("0 0 29 2 *", "2026-01-01T00:00:00Z")).toBe("2028-02-29T00:00:00.000Z");
  });

  test("impossible day/month (Feb 30) returns null quickly", () => {
    // The first date conversion in a process pays a one-time setup cost
    // (about 150 ms in a debug build). Pay it before the walk is timed.
    Bun.cron.parse("* * * * *", 0, { tz: "UTC" });
    const t = performance.now();
    expect(Bun.cron.parse("0 0 30 2 *", new Date("2026-01-01T00:00:00Z"), { tz: "UTC" })).toBeNull();
    expect(performance.now() - t).toBeLessThan(50);
  });

  test("DOM/DOW OR semantics when both restricted", async () => {
    // 0 0 13 * 5 → every 13th OR every Friday. From 2026-01-01 (Thu), first is Fri Jan 2.
    expect(await parseUTC("0 0 13 * 5", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe.concurrent("Bun.cron.parse — weekday 7 = Sunday in ranges", () => {
  // 2026-01-01 is a Thursday. next() is strictly-after, so the first match for
  // an every-day schedule is 2026-01-02.
  test("1-7 means Mon-Sun (every day)", async () => {
    expect(await parseUTC("0 0 * * 1-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("5-7 means Fri-Sun", async () => {
    expect(await parseUTC("0 0 * * 5-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("6-7 means Sat-Sun", async () => {
    expect(await parseUTC("0 0 * * 6-7", "2026-01-01T00:00:00Z")).toBe("2026-01-03T00:00:00.000Z");
  });
  test("0-7 means every day", async () => {
    expect(await parseUTC("0 0 * * 0-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("scalar 7 still means Sunday", async () => {
    expect(await parseUTC("0 0 * * 7", "2026-01-01T00:00:00Z")).toBe("2026-01-04T00:00:00.000Z");
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

  test("accepts the Date range boundary", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const out = [];
         // from = +8.64e15 is +275760-09-13T00:00:00Z; the next occurrence falls
         // past the representable range → null, not an Invalid Date.
         out.push(Bun.cron.parse("* * * * *", 8.64e15));
         // from = -8.64e15 is -271821-04-20T00:00:00Z; next minute is in range.
         out.push(Bun.cron.parse("* * * * *", -8.64e15)?.toISOString());
         // Just inside the upper boundary: next minute lands exactly on 8.64e15.
         out.push(Bun.cron.parse("* * * * *", 8.64e15 - 60_000)?.getTime());
         process.stdout.write(JSON.stringify(out));`,
      ],
      env: { ...bunEnv, TZ: "UTC" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: [null, "-271821-04-20T00:01:00.000Z", 8.64e15],
      stderr: "",
      exitCode: 0,
    });
  });

  test("does not crash the process on 1e300", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try { Bun.cron.parse("* * * * *", 1e300); } catch (e) { process.stdout.write(e.message); }`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "Invalid date value", stderr: "", exitCode: 0 });
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
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: { local: expected, UTC: expected, "America/New_York": expected, "Pacific/Kiritimati": expected },
      stderr: "",
      exitCode: 0,
    });
  });

  // Bun.cron.parse rejects a `from` outside the range. The scheduler reads the
  // clock, and fake timers can set the clock to any number.
  test("Bun.cron() finds no occurrence when the clock is past the range", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { jest } = Bun.jest();
         jest.useFakeTimers();
         jest.setSystemTime(8.64e15 + 2 * 86_400_000);
         let result;
         try {
           Bun.cron("* * * * *", () => {}).stop();
           result = "scheduled";
         } catch (e) {
           result = e.message;
         }
         process.stdout.write(result);`,
      ],
      env: bunEnv,
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "Cron expression '* * * * *' has no future occurrences",
      stderr: "",
      exitCode: 0,
    });
  });
});
