import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.cron.parse() and the in-process Bun.cron(schedule, handler) interpret
// cron expressions in the system's local time zone — matching the OS-level
// overload (crontab/launchd/schtasks all use local time).
//
// Each test spawns a subprocess with a fixed TZ so the assertions are
// independent of the host's zone.

async function parseInTZ(tz: string, expr: string, fromISO: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdout.write(Bun.cron.parse(${JSON.stringify(expr)}, new Date(${JSON.stringify(fromISO)})).toISOString())`,
    ],
    env: { ...bunEnv, TZ: tz },
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(exitCode).toBe(0);
  return stdout;
}

describe.concurrent("Bun.cron.parse — local time zone", () => {
  test("0 9 * * * in America/Los_Angeles is 9am Pacific (PDT = UTC-7)", async () => {
    const next = await parseInTZ("America/Los_Angeles", "0 9 * * *", "2026-06-15T00:00:00Z");
    // 2026-06-15 00:00 UTC = 2026-06-14 17:00 PDT; next 9am PDT = 2026-06-15 09:00 PDT = 16:00 UTC
    expect(next).toBe("2026-06-15T16:00:00.000Z");
  });

  test("0 9 * * * in UTC is 9am UTC", async () => {
    const next = await parseInTZ("UTC", "0 9 * * *", "2026-06-15T00:00:00Z");
    expect(next).toBe("2026-06-15T09:00:00.000Z");
  });

  test("0 9 * * * in Asia/Tokyo is 9am JST (UTC+9, no DST)", async () => {
    const next = await parseInTZ("Asia/Tokyo", "0 9 * * *", "2026-06-15T00:00:00Z");
    // 2026-06-15 00:00 UTC = 2026-06-15 09:00 JST → already at 09:00 but parse() returns the
    // NEXT occurrence strictly after, so next is 2026-06-16 09:00 JST = 2026-06-16 00:00 UTC
    expect(next).toBe("2026-06-16T00:00:00.000Z");
  });

  test("weekday matching uses local day-of-week (0 12 * * MON across the dateline)", async () => {
    // Pacific/Auckland is UTC+12 (NZST in June). 2026-06-15 is a Monday in NZST.
    // 12:00 NZST = 00:00 UTC same date.
    const next = await parseInTZ("Pacific/Auckland", "0 12 * * MON", "2026-06-14T23:00:00Z");
    // 2026-06-14 23:00 UTC = 2026-06-15 11:00 NZST (Mon); next Mon 12:00 NZST = 2026-06-15 00:00 UTC
    expect(next).toBe("2026-06-15T00:00:00.000Z");
  });
});

describe.concurrent("Bun.cron.parse — weekday 7 = Sunday in ranges", () => {
  // 2026-01-01 is a Thursday. next() is strictly-after, so the first match for an
  // every-day schedule is 2026-01-02.
  test("1-7 means Mon-Sun (every day)", async () => {
    expect(await parseInTZ("UTC", "0 0 * * 1-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("5-7 means Fri-Sun", async () => {
    expect(await parseInTZ("UTC", "0 0 * * 5-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("6-7 means Sat-Sun", async () => {
    expect(await parseInTZ("UTC", "0 0 * * 6-7", "2026-01-01T00:00:00Z")).toBe("2026-01-03T00:00:00.000Z");
  });
  test("0-7 means every day", async () => {
    expect(await parseInTZ("UTC", "0 0 * * 0-7", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });
  test("scalar 7 still means Sunday", async () => {
    expect(await parseInTZ("UTC", "0 0 * * 7", "2026-01-01T00:00:00Z")).toBe("2026-01-04T00:00:00.000Z");
  });
});

describe.concurrent("Bun.cron.parse — DST transitions", () => {
  test("spring-forward: schedule in the missing hour fires shifted forward (same day)", async () => {
    // US 2025 spring-forward: 2025-03-09 02:00 EST → 03:00 EDT (2:00-2:59 don't exist).
    // "30 2 * * *" fires at 03:30 EDT — the gap-shifted instant. Matches croner and cron-parser.
    const next = await parseInTZ("America/New_York", "30 2 * * *", "2025-03-09T05:00:00Z"); // = 00:00 EST
    expect(next).toBe("2025-03-09T07:30:00.000Z"); // 03:30 EDT
  });

  test("fall-back: schedule in the duplicated hour fires at the first occurrence", async () => {
    // US 2025 fall-back: 2025-11-02 02:00 EDT → 01:00 EST (1:00-1:59 occurs twice).
    // Starting from 00:30 EDT (= 04:30 UTC), next "30 1 * * *" is the first 01:30 (EDT) = 05:30 UTC.
    const next = await parseInTZ("America/New_York", "30 1 * * *", "2025-11-02T04:30:00Z");
    expect(next).toBe("2025-11-02T05:30:00.000Z");
  });

  test("fall-back: starting from the second occurrence does not return a time before from", async () => {
    // 06:30 UTC = 01:30 EST (the SECOND 01:30). next() must not return the first 01:30 (05:30 UTC).
    const next = await parseInTZ("America/New_York", "30 1 * * *", "2025-11-02T06:30:00Z");
    // Next valid 01:30 is the following day (EST): 2025-11-03 01:30 EST = 06:30 UTC.
    expect(next).toBe("2025-11-03T06:30:00.000Z");
  });
});

describe.concurrent("Bun.cron(schedule, handler) — local time zone", () => {
  test("registering 0 9 * * * computes the same next-fire as Bun.cron.parse in local time", async () => {
    // The in-process scheduler uses the same next() — we verify via parse() since
    // waiting for an actual fire would take up to 24 hours.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const expr = "0 9 * * *";
        const parsed = Bun.cron.parse(expr).getTime();
        // Register and immediately stop; the deadline was computed from the same next().
        using job = Bun.cron(expr, () => {});
        process.stdout.write(String(parsed > Date.now()));
      `,
      ],
      env: { ...bunEnv, TZ: "America/Los_Angeles" },
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("true");
    expect(exitCode).toBe(0);
  });
});
