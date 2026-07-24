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
