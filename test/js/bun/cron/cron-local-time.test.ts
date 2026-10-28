import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.cron.parse() and the in-process Bun.cron(schedule, handler) interpret
// cron expressions in the system's local time zone — matching the OS-level
// overload (crontab/launchd/schtasks all use local time).
//
// Each test spawns a subprocess with a fixed TZ so the assertions are
// independent of the host's zone.

async function evalInTZ(tz: string, src: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: { ...bunEnv, TZ: tz },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

async function parseInTZ(tz: string, expr: string, fromISO: string): Promise<string> {
  return evalInTZ(
    tz,
    `process.stdout.write(Bun.cron.parse(${JSON.stringify(expr)}, new Date(${JSON.stringify(fromISO)})).toISOString())`,
  );
}

async function chainInTZ(tz: string, expr: string, fromISO: string, steps: number): Promise<string[]> {
  const out = await evalInTZ(
    tz,
    `let t = new Date(${JSON.stringify(fromISO)});
     const seq = [];
     for (let i = 0; i < ${steps}; i++) { t = Bun.cron.parse(${JSON.stringify(expr)}, t); seq.push(t.toISOString()); }
     process.stdout.write(JSON.stringify(seq))`,
  );
  return JSON.parse(out);
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

  test("fall-back: wildcard hour fires through both occurrences (cronie semantics)", async () => {
    // After the first 1:00 (05:00Z), next() returns the SECOND 1:00 (06:00Z).
    // Matches cronie/Vixie and cron-parser. Fixed-time schedules (30 1 * * *)
    // still fire once — only `*` minute or `*` hour schedules run through.
    const next = await parseInTZ("America/New_York", "0 * * * *", "2025-11-02T05:00:01Z");
    expect(next).toBe("2025-11-02T06:00:00.000Z");
  });

  test("fall-back: every-minute fires through both occurrences", async () => {
    const next = await parseInTZ("America/New_York", "* * * * *", "2025-11-02T05:59:01Z");
    expect(next).toBe("2025-11-02T06:00:00.000Z");
  });

  test("fall-back: every-minute chained from the transition walks the repeated hour", async () => {
    // From 05:59Z, chaining * * * * * must hit every real-time minute through
    // the repeated 1:xx EST window (06:00Z..06:59Z), not jump to 07:00Z.
    expect(await chainInTZ("America/New_York", "* * * * *", "2025-11-02T05:59:00Z", 4)).toEqual([
      "2025-11-02T06:00:00.000Z",
      "2025-11-02T06:01:00.000Z",
      "2025-11-02T06:02:00.000Z",
      "2025-11-02T06:03:00.000Z",
    ]);
  });

  test("fall-back: */15 chained from the transition fires at each quarter-hour", async () => {
    expect(await chainInTZ("America/New_York", "*/15 * * * *", "2025-11-02T05:59:00Z", 5)).toEqual([
      "2025-11-02T06:00:00.000Z",
      "2025-11-02T06:15:00.000Z",
      "2025-11-02T06:30:00.000Z",
      "2025-11-02T06:45:00.000Z",
      "2025-11-02T07:00:00.000Z",
    ]);
  });

  test("spring-forward: only the first match in the gap fires shifted (croner semantics)", async () => {
    // "*/15 2 * * *" has 4 occurrences in the missing hour. Bun fires the first
    // shifted to 3:00, then skips to next day. cron-parser shifts all four.
    const first = await parseInTZ("America/New_York", "*/15 2 * * *", "2025-03-09T06:59:00Z");
    expect(first).toBe("2025-03-09T07:00:00.000Z"); // 03:00 EDT
    const second = await parseInTZ("America/New_York", "*/15 2 * * *", "2025-03-09T07:00:00Z");
    expect(second).toBe("2025-03-10T06:00:00.000Z"); // next day 02:00 EDT
  });

  test("Lord Howe: 30-minute spring-forward gap shifts by 30 min", async () => {
    // Australia/Lord_Howe 2025-10-05 02:00→02:30. "15 2 * * *" → 02:45 LHDT.
    const next = await parseInTZ("Australia/Lord_Howe", "15 2 * * *", "2025-10-04T14:30:00Z");
    expect(next).toBe("2025-10-04T15:45:00.000Z");
  });

  test("Lord Howe: 30-minute fall-back — wildcard fires through repeated half-hour", async () => {
    // 2025-04-06 02:00 LHDT (+11) → 01:30 LHST (+10:30); 1:30-1:59 repeats.
    // After first 1:59 (14:59Z), every-minute → second 1:30 (15:00Z).
    const a = await parseInTZ("Australia/Lord_Howe", "* * * * *", "2025-04-05T14:59:01Z");
    expect(a).toBe("2025-04-05T15:00:00.000Z");
    // After first 1:45, "45 *" → second 1:45.
    const b = await parseInTZ("Australia/Lord_Howe", "45 * * * *", "2025-04-05T14:45:01Z");
    expect(b).toBe("2025-04-05T15:15:00.000Z");
  });

  test("Lord Howe: 30-minute fall-back — fixed-time fires once", async () => {
    // After first 1:45, "45 1" (fixed) → next day, not the second 1:45.
    const next = await parseInTZ("Australia/Lord_Howe", "45 1 * * *", "2025-04-05T14:45:01Z");
    expect(next).toBe("2025-04-06T15:15:00.000Z");
  });

  test("fall-back: hourly chain walks 0→1→1→2 (both occurrences)", async () => {
    expect(await chainInTZ("America/New_York", "0 * * * *", "2025-11-02T03:59:00Z", 4)).toEqual([
      "2025-11-02T04:00:00.000Z", // 0:00 EDT
      "2025-11-02T05:00:00.000Z", // 1st 1:00 EDT
      "2025-11-02T06:00:00.000Z", // 2nd 1:00 EST
      "2025-11-02T07:00:00.000Z", // 2:00 EST
    ]);
  });

  test("spring-forward: hourly chain walks 1→3→4 (no double-fire at 3)", async () => {
    expect(await chainInTZ("America/New_York", "0 * * * *", "2025-03-09T05:59:00Z", 3)).toEqual([
      "2025-03-09T06:00:00.000Z", // 1:00 EST
      "2025-03-09T07:00:00.000Z", // 3:00 EDT (2:00 doesn't exist)
      "2025-03-09T08:00:00.000Z", // 4:00 EDT
    ]);
  });

  test("Santiago: midnight spring-forward gap shifts to 01:00 same day", async () => {
    // America/Santiago 2025-09-07 00:00→01:00. "0 0 * * *" → 01:00 CLST.
    const next = await parseInTZ("America/Santiago", "0 0 * * *", "2025-09-06T23:00:00-04:00");
    expect(next).toBe("2025-09-07T04:00:00.000Z");
  });
});

describe.concurrent("Bun.cron.parse — { tz } option", () => {
  test("overrides process TZ (UTC opt under LA process)", async () => {
    const next = await evalInTZ(
      "America/Los_Angeles",
      `process.stdout.write(Bun.cron.parse("0 9 * * *", new Date("2026-06-15T00:00:00Z"), {tz: "UTC"}).toISOString())`,
    );
    expect(next).toBe("2026-06-15T09:00:00.000Z");
  });

  test("named zone (America/New_York under UTC process)", async () => {
    const next = await evalInTZ(
      "UTC",
      `process.stdout.write(Bun.cron.parse("0 9 * * *", new Date("2026-06-15T00:00:00Z"), {tz: "America/New_York"}).toISOString())`,
    );
    // 9am EDT (UTC-4) = 13:00 UTC
    expect(next).toBe("2026-06-15T13:00:00.000Z");
  });

  test("tz option matches the same zone set as process TZ", async () => {
    const zones = ["America/Los_Angeles", "Asia/Tokyo", "Pacific/Auckland", "Australia/Lord_Howe"];
    const out = await evalInTZ(
      "UTC",
      `const zones = ${JSON.stringify(zones)};
       const r = {};
       for (const z of zones) {
         const viaOpt = Bun.cron.parse("0 9 * * *", new Date("2026-06-15T00:00:00Z"), {tz: z}).toISOString();
         process.env.TZ = z;
         const viaEnv = Bun.cron.parse("0 9 * * *", new Date("2026-06-15T00:00:00Z")).toISOString();
         process.env.TZ = "UTC";
         r[z] = { viaOpt, viaEnv };
       }
       process.stdout.write(JSON.stringify(r))`,
    );
    const r = JSON.parse(out);
    for (const z of zones) expect({ zone: z, ...r[z] }).toEqual({ zone: z, viaOpt: r[z].viaEnv, viaEnv: r[z].viaEnv });
  });

  test("DST via tz option matches DST via process TZ (spring-forward)", async () => {
    // US 2025 spring-forward: "30 2 * * *" → 03:30 EDT on 2025-03-09.
    const next = await evalInTZ(
      "UTC",
      `process.stdout.write(Bun.cron.parse("30 2 * * *", new Date("2025-03-09T05:00:00Z"), {tz: "America/New_York"}).toISOString())`,
    );
    expect(next).toBe("2025-03-09T07:30:00.000Z");
  });

  test("DST via tz option matches DST via process TZ (fall-back, fixed fires once)", async () => {
    // From the second 01:30 (EST), "30 1 * * *" → next day.
    const next = await evalInTZ(
      "UTC",
      `process.stdout.write(Bun.cron.parse("30 1 * * *", new Date("2025-11-02T06:30:00Z"), {tz: "America/New_York"}).toISOString())`,
    );
    expect(next).toBe("2025-11-03T06:30:00.000Z");
  });

  test("DST via tz option (fall-back, wildcard hour fires through both occurrences)", async () => {
    const out = await evalInTZ(
      "UTC",
      `let t = new Date("2025-11-02T03:59:00Z");
       const seq = [];
       for (let i = 0; i < 4; i++) { t = Bun.cron.parse("0 * * * *", t, {tz: "America/New_York"}); seq.push(t.toISOString()); }
       process.stdout.write(JSON.stringify(seq))`,
    );
    expect(JSON.parse(out)).toEqual([
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

  test("tz: undefined falls back to local", async () => {
    const next = await evalInTZ(
      "Asia/Tokyo",
      `process.stdout.write(Bun.cron.parse("0 9 * * *", new Date("2026-06-15T00:00:00Z"), {tz: undefined}).toISOString())`,
    );
    expect(next).toBe("2026-06-16T00:00:00.000Z");
  });

  test("in-process Bun.cron(schedule, handler, { tz }) uses the override", async () => {
    const out = await evalInTZ(
      "UTC",
      `const { jest } = await import("bun:test");
       jest.useFakeTimers();
       jest.setSystemTime(new Date("2026-06-15T00:00:00Z"));
       const fired = [];
       using job = Bun.cron("0 9 * * *", () => fired.push(new Date().toISOString()), { tz: "America/New_York" });
       jest.advanceTimersByTime(14 * 60 * 60 * 1000);
       jest.useRealTimers();
       process.stdout.write(JSON.stringify(fired));`,
    );
    // 9am EDT = 13:00 UTC; advancing 14h from 00:00Z fires exactly once at 13:00Z.
    expect(JSON.parse(out)).toEqual(["2026-06-15T13:00:00.000Z"]);
  });
});
