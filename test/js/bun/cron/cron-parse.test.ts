import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.cron.parse() and the in-process Bun.cron(schedule, handler) interpret
// schedules in UTC. The OS-level Bun.cron(path, schedule, title) overload
// uses the system's local time zone (crontab/launchd/schtasks all do).

const parse = (expr: string, from: string) => Bun.cron.parse(expr, new Date(from))!.toISOString();

describe("Bun.cron.parse — UTC", () => {
  test("0 9 * * * is 9am UTC regardless of process TZ", async () => {
    // Parse is UTC; spawning under a non-UTC TZ should produce the same result.
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `process.stdout.write(Bun.cron.parse("0 9 * * *", new Date("2026-06-15T00:00:00Z")).toISOString())`,
        ],
        env: { ...bunEnv, TZ: tz },
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("2026-06-15T09:00:00.000Z");
      expect(exitCode).toBe(0);
    }
  });

  test("weekday matching uses UTC day-of-week", () => {
    // 2026-06-15 is a Monday in UTC.
    expect(parse("0 12 * * MON", "2026-06-14T23:00:00Z")).toBe("2026-06-15T12:00:00.000Z");
  });

  test("strictly-after: from = exact match returns the next occurrence", () => {
    expect(parse("0 9 * * *", "2026-06-15T09:00:00Z")).toBe("2026-06-16T09:00:00.000Z");
  });

  test("Feb 29 finds next leap year", () => {
    expect(parse("0 0 29 2 *", "2026-01-01T00:00:00Z")).toBe("2028-02-29T00:00:00.000Z");
  });

  test("impossible day/month (Feb 30) returns null quickly", () => {
    const t = performance.now();
    expect(Bun.cron.parse("0 0 30 2 *", new Date("2026-01-01T00:00:00Z"))).toBeNull();
    expect(performance.now() - t).toBeLessThan(50);
  });

  test("DOM/DOW OR semantics when both restricted", () => {
    // 0 0 13 * 5 → every 13th OR every Friday. From 2026-01-01 (Thu), first is Fri Jan 2.
    expect(parse("0 0 13 * 5", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("Bun.cron.parse — weekday 7 = Sunday in ranges", () => {
  // 2026-01-01 is a Thursday. next() is strictly-after, so the first match for
  // an every-day schedule is 2026-01-02.
  test("1-7 means Mon-Sun (every day)", () => {
    expect(parse("0 0 * * 1-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("5-7 means Fri-Sun", () => {
    expect(parse("0 0 * * 5-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("6-7 means Sat-Sun", () => {
    expect(parse("0 0 * * 6-7", "2026-01-01T00:00:00Z")).toBe("2026-01-03T00:00:00.000Z");
  });
  test("0-7 means every day", () => {
    expect(parse("0 0 * * 0-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("scalar 7 still means Sunday", () => {
    expect(parse("0 0 * * 7", "2026-01-01T00:00:00Z")).toBe("2026-01-04T00:00:00.000Z");
  });
});
