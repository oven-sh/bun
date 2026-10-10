import { afterAll, beforeAll, describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.cron.parse() and the in-process Bun.cron(schedule, handler) interpret
// cron expressions in the system's local time zone — matching the OS-level
// overload (crontab/launchd/schtasks all use local time).
//
// Assigning process.env.TZ at runtime updates WTF's time-zone override
// immediately (see cron.test.ts's "Bun.cron.parse" suite for the same
// pattern), so these tests pin the zone per assertion instead of spawning a
// subprocess per case. One spawned case below still covers the startup-env
// path explicitly.

const savedTZ = process.env.TZ;
// Leave the process in a known zone between tests; each helper restores it.
beforeAll(() => void (process.env.TZ = "UTC"));
afterAll(() => void (process.env.TZ = savedTZ ?? ""));

function withTZ<T>(tz: string, fn: () => T): T {
  const old = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = old ?? "";
  }
}

function parseInTZ(tz: string, expr: string, fromISO: string, opts?: { tz?: string }): string {
  return withTZ(tz, () => Bun.cron.parse(expr, new Date(fromISO), opts)!.toISOString());
}

function chainInTZ(tz: string, expr: string, fromISO: string, steps: number, opts?: { tz?: string }): string[] {
  return withTZ(tz, () => {
    let t = new Date(fromISO);
    const seq: string[] = [];
    for (let i = 0; i < steps; i++) {
      t = Bun.cron.parse(expr, t, opts)!;
      seq.push(t.toISOString());
    }
    return seq;
  });
}

// These suites mutate process.env.TZ, so they must not be describe.concurrent.
// Each in-process test is pure computation, so sequential is still fast.

describe("Bun.cron.parse — local time zone", () => {
  test("0 9 * * * in America/Los_Angeles is 9am Pacific (PDT = UTC-7)", () => {
    // 2026-06-15 00:00 UTC = 2026-06-14 17:00 PDT; next 9am PDT = 2026-06-15 09:00 PDT = 16:00 UTC
    expect(parseInTZ("America/Los_Angeles", "0 9 * * *", "2026-06-15T00:00:00Z")).toBe("2026-06-15T16:00:00.000Z");
  });

  test("0 9 * * * in UTC is 9am UTC", () => {
    expect(parseInTZ("UTC", "0 9 * * *", "2026-06-15T00:00:00Z")).toBe("2026-06-15T09:00:00.000Z");
  });

  test("0 9 * * * in Asia/Tokyo is 9am JST (UTC+9, no DST)", () => {
    // 2026-06-15 00:00 UTC = 2026-06-15 09:00 JST → already at 09:00 but parse() returns the
    // NEXT occurrence strictly after, so next is 2026-06-16 09:00 JST = 2026-06-16 00:00 UTC
    expect(parseInTZ("Asia/Tokyo", "0 9 * * *", "2026-06-15T00:00:00Z")).toBe("2026-06-16T00:00:00.000Z");
  });

  test("weekday matching uses local day-of-week (0 12 * * MON across the dateline)", () => {
    // Pacific/Auckland is UTC+12 (NZST in June). 2026-06-15 is a Monday in NZST.
    // 2026-06-14 23:00 UTC = 2026-06-15 11:00 NZST (Mon); next Mon 12:00 NZST = 2026-06-15 00:00 UTC
    expect(parseInTZ("Pacific/Auckland", "0 12 * * MON", "2026-06-14T23:00:00Z")).toBe("2026-06-15T00:00:00.000Z");
  });

  test("TZ set in the spawned process's environment is honored at startup", async () => {
    // Covers the startup-env path that the in-process withTZ() helper does not:
    // a fresh process with TZ in its env must parse in that zone from the
    // first call, before any process.env.TZ assignment.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write(Bun.cron.parse("0 9 * * *", new Date("2026-06-15T00:00:00Z")).toISOString())`,
      ],
      env: { ...bunEnv, TZ: "America/Los_Angeles" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "2026-06-15T16:00:00.000Z", stderr: "", exitCode: 0 });
  });
});

describe("Bun.cron.parse — DST transitions", () => {
  test("spring-forward: schedule in the missing hour fires shifted forward (same day)", () => {
    // US 2025 spring-forward: 2025-03-09 02:00 EST → 03:00 EDT (2:00-2:59 don't exist).
    // "30 2 * * *" fires at 03:30 EDT — the gap-shifted instant. Matches croner and cron-parser.
    expect(parseInTZ("America/New_York", "30 2 * * *", "2025-03-09T05:00:00Z")).toBe("2025-03-09T07:30:00.000Z");
  });

  test("fall-back: schedule in the duplicated hour fires at the first occurrence", () => {
    // US 2025 fall-back: 2025-11-02 02:00 EDT → 01:00 EST (1:00-1:59 occurs twice).
    // Starting from 00:30 EDT (= 04:30 UTC), next "30 1 * * *" is the first 01:30 (EDT) = 05:30 UTC.
    expect(parseInTZ("America/New_York", "30 1 * * *", "2025-11-02T04:30:00Z")).toBe("2025-11-02T05:30:00.000Z");
  });

  test("fall-back: starting from the second occurrence does not return a time before from", () => {
    // 06:30 UTC = 01:30 EST (the SECOND 01:30). next() must not return the first 01:30 (05:30 UTC).
    // Next valid 01:30 is the following day (EST): 2025-11-03 01:30 EST = 06:30 UTC.
    expect(parseInTZ("America/New_York", "30 1 * * *", "2025-11-02T06:30:00Z")).toBe("2025-11-03T06:30:00.000Z");
  });

  test("fall-back: wildcard hour fires through both occurrences (cronie semantics)", () => {
    // After the first 1:00 (05:00Z), next() returns the SECOND 1:00 (06:00Z).
    // Matches cronie/Vixie and cron-parser. Fixed-time schedules (30 1 * * *)
    // still fire once — only `*` minute or `*` hour schedules run through.
    expect(parseInTZ("America/New_York", "0 * * * *", "2025-11-02T05:00:01Z")).toBe("2025-11-02T06:00:00.000Z");
  });

  test("fall-back: every-minute fires through both occurrences", () => {
    expect(parseInTZ("America/New_York", "* * * * *", "2025-11-02T05:59:01Z")).toBe("2025-11-02T06:00:00.000Z");
  });

  test("fall-back: every-minute chained from the transition walks the repeated hour", () => {
    // From 05:59Z, chaining * * * * * must hit every real-time minute through
    // the repeated 1:xx EST window (06:00Z..06:59Z), not jump to 07:00Z.
    expect(chainInTZ("America/New_York", "* * * * *", "2025-11-02T05:59:00Z", 4)).toEqual([
      "2025-11-02T06:00:00.000Z",
      "2025-11-02T06:01:00.000Z",
      "2025-11-02T06:02:00.000Z",
      "2025-11-02T06:03:00.000Z",
    ]);
  });

  test("fall-back: */15 chained from the transition fires at each quarter-hour", () => {
    expect(chainInTZ("America/New_York", "*/15 * * * *", "2025-11-02T05:59:00Z", 5)).toEqual([
      "2025-11-02T06:00:00.000Z",
      "2025-11-02T06:15:00.000Z",
      "2025-11-02T06:30:00.000Z",
      "2025-11-02T06:45:00.000Z",
      "2025-11-02T07:00:00.000Z",
    ]);
  });

  test("spring-forward: only the first match in the gap fires shifted (croner semantics)", () => {
    // "*/15 2 * * *" has 4 occurrences in the missing hour. Bun fires the first
    // shifted to 3:00, then skips to next day. cron-parser shifts all four.
    expect(chainInTZ("America/New_York", "*/15 2 * * *", "2025-03-09T06:59:00Z", 2)).toEqual([
      "2025-03-09T07:00:00.000Z", // 03:00 EDT
      "2025-03-10T06:00:00.000Z", // next day 02:00 EDT
    ]);
  });

  test("Lord Howe: 30-minute spring-forward gap shifts by 30 min", () => {
    // Australia/Lord_Howe 2025-10-05 02:00→02:30. "15 2 * * *" → 02:45 LHDT.
    expect(parseInTZ("Australia/Lord_Howe", "15 2 * * *", "2025-10-04T14:30:00Z")).toBe("2025-10-04T15:45:00.000Z");
  });

  test("Lord Howe: 30-minute fall-back — wildcard fires through repeated half-hour", () => {
    // 2025-04-06 02:00 LHDT (+11) → 01:30 LHST (+10:30); 1:30-1:59 repeats.
    expect({
      // After first 1:59 (14:59Z), every-minute → second 1:30 (15:00Z).
      everyMinute: parseInTZ("Australia/Lord_Howe", "* * * * *", "2025-04-05T14:59:01Z"),
      // After first 1:45, "45 *" → second 1:45.
      wildcardHour: parseInTZ("Australia/Lord_Howe", "45 * * * *", "2025-04-05T14:45:01Z"),
    }).toEqual({
      everyMinute: "2025-04-05T15:00:00.000Z",
      wildcardHour: "2025-04-05T15:15:00.000Z",
    });
  });

  test("Lord Howe: 30-minute fall-back — fixed-time fires once", () => {
    // After first 1:45, "45 1" (fixed) → next day, not the second 1:45.
    expect(parseInTZ("Australia/Lord_Howe", "45 1 * * *", "2025-04-05T14:45:01Z")).toBe("2025-04-06T15:15:00.000Z");
  });

  test("fall-back: hourly chain walks 0→1→1→2 (both occurrences)", () => {
    expect(chainInTZ("America/New_York", "0 * * * *", "2025-11-02T03:59:00Z", 4)).toEqual([
      "2025-11-02T04:00:00.000Z", // 0:00 EDT
      "2025-11-02T05:00:00.000Z", // 1st 1:00 EDT
      "2025-11-02T06:00:00.000Z", // 2nd 1:00 EST
      "2025-11-02T07:00:00.000Z", // 2:00 EST
    ]);
  });

  test("spring-forward: hourly chain walks 1→3→4 (no double-fire at 3)", () => {
    expect(chainInTZ("America/New_York", "0 * * * *", "2025-03-09T05:59:00Z", 3)).toEqual([
      "2025-03-09T06:00:00.000Z", // 1:00 EST
      "2025-03-09T07:00:00.000Z", // 3:00 EDT (2:00 doesn't exist)
      "2025-03-09T08:00:00.000Z", // 4:00 EDT
    ]);
  });

  test("Santiago: midnight spring-forward gap shifts to 01:00 same day", () => {
    // America/Santiago 2025-09-07 00:00→01:00. "0 0 * * *" → 01:00 CLST.
    expect(parseInTZ("America/Santiago", "0 0 * * *", "2025-09-06T23:00:00-04:00")).toBe("2025-09-07T04:00:00.000Z");
  });
});

describe("Bun.cron.parse — { tz } option", () => {
  test("overrides process TZ (UTC opt under LA process)", () => {
    expect(parseInTZ("America/Los_Angeles", "0 9 * * *", "2026-06-15T00:00:00Z", { tz: "UTC" })).toBe(
      "2026-06-15T09:00:00.000Z",
    );
  });

  test("named zone (America/New_York under UTC process)", () => {
    // 9am EDT (UTC-4) = 13:00 UTC
    expect(parseInTZ("UTC", "0 9 * * *", "2026-06-15T00:00:00Z", { tz: "America/New_York" })).toBe(
      "2026-06-15T13:00:00.000Z",
    );
  });

  test("tz option matches the same zone set as process TZ", () => {
    const expected = {
      "America/Los_Angeles": "2026-06-15T16:00:00.000Z",
      "Asia/Tokyo": "2026-06-16T00:00:00.000Z",
      "Pacific/Auckland": "2026-06-15T21:00:00.000Z",
      "Australia/Lord_Howe": "2026-06-15T22:30:00.000Z",
    };
    const actual: Record<string, { viaOpt: string; viaEnv: string }> = {};
    for (const z of Object.keys(expected)) {
      actual[z] = {
        viaOpt: parseInTZ("UTC", "0 9 * * *", "2026-06-15T00:00:00Z", { tz: z }),
        viaEnv: parseInTZ(z, "0 9 * * *", "2026-06-15T00:00:00Z"),
      };
    }
    expect(actual).toEqual(
      Object.fromEntries(Object.entries(expected).map(([z, iso]) => [z, { viaOpt: iso, viaEnv: iso }])),
    );
  });

  test("DST via tz option matches DST via process TZ (spring-forward)", () => {
    // US 2025 spring-forward: "30 2 * * *" → 03:30 EDT on 2025-03-09.
    expect(parseInTZ("UTC", "30 2 * * *", "2025-03-09T05:00:00Z", { tz: "America/New_York" })).toBe(
      "2025-03-09T07:30:00.000Z",
    );
  });

  test("DST via tz option matches DST via process TZ (fall-back, fixed fires once)", () => {
    // From the second 01:30 (EST), "30 1 * * *" → next day.
    expect(parseInTZ("UTC", "30 1 * * *", "2025-11-02T06:30:00Z", { tz: "America/New_York" })).toBe(
      "2025-11-03T06:30:00.000Z",
    );
  });

  test("DST via tz option (fall-back, wildcard hour fires through both occurrences)", () => {
    expect(chainInTZ("UTC", "0 * * * *", "2025-11-02T03:59:00Z", 4, { tz: "America/New_York" })).toEqual([
      "2025-11-02T04:00:00.000Z", // 0:00 EDT
      "2025-11-02T05:00:00.000Z", // 1st 1:00 EDT
      "2025-11-02T06:00:00.000Z", // 2nd 1:00 EST
      "2025-11-02T07:00:00.000Z", // 2:00 EST
    ]);
  });

  test("empty-string tz throws (not silently falling back to local)", () => {
    expect(() => Bun.cron.parse("* * * * *", Date.now(), { tz: "" })).toThrow(/unknown time zone ''/);
    expect(() => Bun.cron("* * * * *", () => {}, { tz: "" })).toThrow(/unknown time zone ''/);
  });

  test("non-ASCII tz throws", () => {
    expect(() => Bun.cron.parse("* * * * *", Date.now(), { tz: "Europe/Zürich" })).toThrow(
      /unknown time zone 'Europe\/Zürich'/,
    );
  });

  test("unknown tz throws", () => {
    expect(() => Bun.cron.parse("* * * * *", Date.now(), { tz: "Mars/Olympus" })).toThrow(
      /unknown time zone 'Mars\/Olympus'/,
    );
    expect(() => Bun.cron("* * * * *", () => {}, { tz: "Mars/Olympus" })).toThrow(/unknown time zone 'Mars\/Olympus'/);
  });

  test("non-string tz throws", () => {
    // @ts-expect-error
    expect(() => Bun.cron.parse("* * * * *", Date.now(), { tz: 42 })).toThrow(/options\.tz must be a string/);
  });

  test("tz: undefined falls back to local", () => {
    expect(parseInTZ("Asia/Tokyo", "0 9 * * *", "2026-06-15T00:00:00Z", { tz: undefined })).toBe(
      "2026-06-16T00:00:00.000Z",
    );
  });

  test("in-process Bun.cron(schedule, handler, { tz }) uses the override", () => {
    withTZ("UTC", () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2026-06-15T00:00:00Z"));
        const fired: string[] = [];
        using _job = Bun.cron("0 9 * * *", () => fired.push(new Date().toISOString()), { tz: "America/New_York" });
        jest.advanceTimersByTime(14 * 60 * 60 * 1000);
        // 9am EDT = 13:00 UTC; advancing 14h from 00:00Z fires exactly once at 13:00Z.
        expect(fired).toEqual(["2026-06-15T13:00:00.000Z"]);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
