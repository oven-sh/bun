import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// setFullYear, setMonth, setDate, their UTC forms and setYear build the new time value with
// MakeDate(MakeDay(year, month, date), TimeWithinDay(t)). MakeDay range-checks
// year + floor(month / 12), never the year or the month count alone
// (https://tc39.es/ecma262/#sec-makeday). JSC returned NaN as soon as |year| alone was above
// 275760 or |month| alone above 3309120, where Date.UTC and the Date constructor of the same
// engine, and V8, return the date. oven-sh/WebKit#616, oven-sh/bun#46342.

const startOfYear275760 = 8639977881600000; // The last year that has time values.
const minTimeValue = -8.64e15; // -271821-04-20T00:00:00Z
const maxTimeValue = 8.64e15; // +275760-09-13T00:00:00Z
const startOfYear0 = -62167219200000; // Date.UTC(0, 0, 1) is 1900.

describe("date setters range-check year + floor(month / 12), not each argument", () => {
  test("a month count that spans more years than a year can be (#46342)", () => {
    // The issue's own lines: 3472364 months from -187631-09-27.
    const d = new Date(0);
    d.setFullYear(-187631, 8, 27);
    expect(d.setMonth(3472364)).not.toBeNaN();
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([101732, 8, 27]);

    const utc = new Date(0);
    utc.setUTCFullYear(-187631, 8, 27);
    expect(utc.setUTCMonth(3472364)).toBe(Date.UTC(101732, 8, 27));
    expect(utc.toISOString()).toBe("+101732-09-27T00:00:00.000Z");

    // What date-fns differenceInMonths does: move the later date back by the whole difference
    // in calendar months with setMonth, then see whether it passed the earlier one.
    function differenceInMonths(later: Date, earlier: Date) {
      const sign = Math.sign(later.getTime() - earlier.getTime());
      const difference = Math.abs(
        (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth()),
      );
      const moved = new Date(later);
      moved.setMonth(moved.getMonth() - sign * difference);
      const lastMonthNotFull = Math.sign(moved.getTime() - earlier.getTime()) === -sign;
      return sign * (difference - +lastMonthNotFull);
    }
    const a = new Date("-187631-09-28T04:56:01.999Z");
    const b = new Date("+101732-11-04T06:00:00.000Z");
    expect(differenceInMonths(a, b)).toBe(-3472357);
    expect(differenceInMonths(b, a)).toBe(3472357);

    // The other spans of the report.
    for (const [start, end] of [
      [-187631, 99849],
      [-270000, 10000],
      [270000, -10000],
    ]) {
      const date = new Date(0);
      date.setUTCFullYear(start, 8, 27);
      expect(date.setUTCMonth((end - start) * 12 + 8)).toBe(Date.UTC(end, 8, 27));
    }
  });

  test("UTC setters give what Date.UTC gives for the same fields", () => {
    expect(Date.UTC(275760, 0, 1)).toBe(startOfYear275760);
    // A year that is out of range alone, and a month count that brings it back.
    expect(new Date(0).setUTCFullYear(275761, -12, 1)).toBe(startOfYear275760);
    expect(new Date(0).setUTCFullYear(275761, -12)).toBe(startOfYear275760);
    expect(new Date(0).setUTCFullYear(300000, -300000, 1)).toBe(Date.UTC(275000, 0, 1));
    expect(new Date(0).setUTCFullYear(-300000, 12 * 302000)).toBe(Date.UTC(2000, 0, 1));
    expect(new Date(NaN).setUTCFullYear(-271821, 3600000)).toBe(Date.UTC(28179, 0, 1));
    // A month count that is out of range alone: 275760 * 12 is 3309120.
    expect(new Date(Date.UTC(-1, 0, 1)).setUTCMonth(12 * 275761)).toBe(startOfYear275760);
    expect(new Date(Date.UTC(-271821, 3, 20)).setUTCMonth(3 + 12 * (275760 + 271821))).toBe(Date.UTC(275760, 3, 20));
    expect(new Date(startOfYear275760).setUTCMonth(3 - 12 * (275760 + 271821), 20)).toBe(minTimeValue);
    expect(new Date(startOfYear0).setUTCMonth(3309120)).toBe(startOfYear275760);
    expect(new Date(startOfYear0).setUTCMonth(3309121, 15)).toBe(Date.UTC(275760, 1, 15));
    expect(new Date(Date.UTC(4000, 0, 1)).setUTCMonth(-3309121)).toBe(Date.UTC(-271761, 11, 1));

    // The month count is split with a floor division.
    for (let month = -25; month <= 25; ++month) {
      const year = 2000 + Math.floor(month / 12);
      const monthInYear = month - 12 * Math.floor(month / 12);
      const date = new Date(Date.UTC(2000, 5, 15, 1, 2, 3, 4));
      expect(date.setUTCMonth(month)).toBe(Date.UTC(2000, month, 15, 1, 2, 3, 4));
      expect([date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]).toEqual([year, monthInYear, 15]);
      expect(new Date(Date.UTC(1999, 5, 15, 1, 2, 3, 4)).setUTCFullYear(2000, month)).toBe(date.getTime());
    }
    expect(new Date(Date.UTC(2000, 5, 15)).setUTCMonth(-13)).toBe(913680000000); // 1998-12-15
    expect(new Date(Date.UTC(2000, 5, 15)).setUTCMonth(13)).toBe(982195200000); // 2001-02-15

    // The Date holds what the setter returned.
    const date = new Date(0);
    expect(date.setUTCFullYear(275761, -12, 1)).toBe(startOfYear275760);
    expect(date.toISOString()).toBe("+275760-01-01T00:00:00.000Z");
    expect(date.setUTCMonth(9)).toBeNaN(); // October 275760 is past the last time value.
    expect(date.getTime()).toBeNaN();
  });

  test("only the result has a range", () => {
    expect(new Date(0).setUTCFullYear(275760, 8, 13)).toBe(maxTimeValue);
    expect(new Date(0).setUTCFullYear(275760, 8, 14)).toBeNaN();
    expect(new Date(0).setUTCFullYear(275761)).toBeNaN();
    expect(new Date(0).setUTCFullYear(275760)).toBe(startOfYear275760);
    expect(new Date(0).setUTCFullYear(-271821, 3, 20)).toBe(minTimeValue);
    expect(new Date(0).setUTCFullYear(-271821, 3, 19)).toBeNaN();
    expect(new Date(0).setUTCFullYear(-271822, 0, 1)).toBeNaN();
    expect(new Date(0).setUTCMonth(12 * 273790 + 8, 13)).toBe(maxTimeValue);
    expect(new Date(0).setUTCMonth(12 * 273790 + 8, 14)).toBeNaN();
    expect(new Date(0).setUTCMonth(-12 * 273791 + 3, 20)).toBe(minTimeValue);
    expect(new Date(0).setUTCMonth(-12 * 273791 + 3, 19)).toBeNaN();
    expect(new Date(0).setYear(275761)).toBeNaN();

    // The day count is part of the same sum: the start of 275761 is out of range, 200 days
    // before it is not. Date.UTC gives the same, and so does V8.
    expect(new Date(0).setUTCFullYear(275761, 0, -200)).toBe(Date.UTC(275760, 0, 166));
    expect(new Date(0).setUTCFullYear(-271822, 0, 500)).toBe(Date.UTC(-271821, 0, 135));
    expect(new Date(0).setUTCFullYear(400000, 0, -45379000)).toBe(8639867894400000);
    // The day count is not multiplied into the milliseconds first, which lost a millisecond
    // beyond 2^53.
    expect(new Date(8.64e15 - 999).setUTCDate(-199000000)).toBe(-8553601036800999);
    expect(new Date(946688523001).setUTCFullYear(300000, 0, -108842264)).toBe(946688523001);
  });

  test("a year or a month count is exact up to the last safe integer, and NaN beyond it", () => {
    expect(new Date(0).setUTCFullYear(2000 - 750599937895082, 2 ** 53 - 1, 1)).toBe(965088000000); // 2000-08-01
    expect(Date.UTC(2000 - 750599937895082, 2 ** 53 - 1, 1)).toBe(965088000000);
    expect(new Date(0).setUTCFullYear(2000 + 750599937895083, -(2 ** 53 - 1), 1)).toBe(959817600000); // 2000-06-01
    expect(Date.UTC(2000 + 750599937895083, -(2 ** 53 - 1), 1)).toBe(959817600000);
    // A double cannot split a month count beyond 2^53 exactly. It gave 2000-01-01 for 2 ** 56
    // months from this year, which is 2000-05-01, or a year that wrapped in int arithmetic.
    expect(new Date(0).setUTCFullYear(-6004799503158661, 2 ** 56, 1)).toBeNaN();
    expect(Date.UTC(-6004799503158661, 2 ** 56, 1)).toBeNaN();
    expect(new Date(0).setUTCFullYear(-750599937893082, 2 ** 53)).toBeNaN();
    expect(Date.UTC(-750599937893082, 2 ** 53)).toBeNaN();
    expect(new Date(0).setUTCMonth(-(2 ** 53))).toBeNaN();
    expect(Date.UTC(-9007197107257351, 108086391056891980, 784353026671)).toBeNaN();

    // year + floor(month / 12) has to fit an int32. The day count can pull the last such year back.
    expect(new Date(0).setUTCFullYear(2 ** 31 - 1, 0, -784353015467)).toBe(-124334438400000);
    expect(Date.UTC(2 ** 31 - 1, 0, -784353015467)).toBe(-124334438400000);
    expect(new Date(0).setUTCFullYear(2 ** 31, 0, -784353015467)).toBeNaN();
    expect(new Date(0).setUTCFullYear(-(2 ** 31), 0, 784353015833)).toBe(-86400000);
    expect(new Date(0).setUTCFullYear(-(2 ** 31) - 1, 0, 784353015833)).toBeNaN();
    // A year or a month count beyond int32 does not wrap into range.
    expect(new Date(0).setUTCFullYear(2 ** 31 + 2000)).toBeNaN();
    expect(new Date(0).setUTCFullYear(2 ** 32 + 2000)).toBeNaN();
    expect(new Date(0).setUTCFullYear(2000, 12 * 2 ** 32)).toBeNaN();
    expect(new Date(0).setUTCMonth(12 * 2 ** 32)).toBeNaN();
    expect(new Date(0).setUTCMonth(12 * 2 ** 32 + 5, 6)).toBeNaN();
    expect(new Date(0).setFullYear(2 ** 32 + 2000)).toBeNaN();
    expect(new Date(0).setMonth(12 * 2 ** 32)).toBeNaN();
    expect(new Date(0).setYear(2 ** 32 + 2000)).toBeNaN();

    // An argument that is not finite is NaN, also when another one would cancel it.
    expect(new Date(0).setUTCFullYear(Infinity, -Infinity)).toBeNaN();
    expect(new Date(0).setUTCFullYear(2000, Infinity, -Infinity)).toBeNaN();
    expect(new Date(0).setUTCMonth(NaN, 1)).toBeNaN();
    expect(new Date(0).setUTCDate(Infinity)).toBeNaN();
    expect(new Date(0).setFullYear(Infinity, -Infinity)).toBeNaN();
  });

  test("each setter with each number of arguments keeps the other fields", () => {
    const start = Date.UTC(2001, 1, 3, 4, 5, 6, 7);
    expect(new Date(start).setUTCFullYear(1950)).toBe(Date.UTC(1950, 1, 3, 4, 5, 6, 7));
    expect(new Date(start).setUTCFullYear(1950, 14)).toBe(Date.UTC(1951, 2, 3, 4, 5, 6, 7));
    expect(new Date(start).setUTCFullYear(1950, 14, 40)).toBe(-591134093993); // 1951-04-09T04:05:06.007Z
    expect(new Date(start).setUTCMonth(14)).toBe(Date.UTC(2002, 2, 3, 4, 5, 6, 7));
    expect(new Date(start).setUTCMonth(-3, -5)).toBe(969854706007); // 2000-09-25T04:05:06.007Z
    expect(new Date(start).setUTCDate(40)).toBe(Date.UTC(2001, 2, 12, 4, 5, 6, 7));
    expect(new Date(start).setUTCDate(-400)).toBe(946353906007); // 1999-12-28T04:05:06.007Z
    // A NaN date starts from +0 for setFullYear, and stays NaN for the others.
    expect(new Date(NaN).setUTCFullYear(1950, 14, 40)).toBe(Date.UTC(1951, 3, 9));
    expect(new Date(NaN).setUTCMonth(14, 40)).toBeNaN();
    expect(new Date(NaN).setUTCDate(40)).toBeNaN();
  });

  // `bun test` runs in UTC. The local setters add the zone's offset after MakeDay, so run them
  // in zones where that is not 0.
  const zones = ["Etc/UTC", "America/Los_Angeles", "Asia/Kathmandu", "Australia/Lord_Howe"];
  describe.each(zones)("local setters in %s", zone => {
    const previous = process.env.TZ;
    beforeAll(() => void (process.env.TZ = zone));
    afterAll(() => void (process.env.TZ = previous ?? "Etc/UTC"));

    test("give what the Date constructor gives for the same fields", () => {
      expect(new Date(2000, 0, 1).setFullYear(275761, -12, 1)).toBe(new Date(275760, 0, 1).getTime());
      expect(new Date(2000, 0, 1).setFullYear(300000, -300000, 1)).toBe(new Date(275000, 0, 1).getTime());
      expect(new Date(-1000, 0, 1).setMonth(12 * 276000 + 5, 6)).toBe(new Date(275000, 5, 6).getTime());
      expect(new Date(2000, 0, 1).setFullYear(275761, 0, -200)).toBe(new Date(275761, 0, -200).getTime());
      expect(new Date(2000, 0, 1, 1, 2, 3, 457).setFullYear(300000, 0, -108842264)).toBe(
        new Date(300000, 0, -108842264, 1, 2, 3, 457).getTime(),
      );
      expect(Number.isFinite(new Date(275000, 5, 6).getTime())).toBe(true);

      const date = new Date(2000, 0, 1);
      date.setFullYear(-187631, 8, 27);
      expect(date.setMonth(3472364)).toBe(new Date(101732, 8, 27).getTime());

      const local = new Date(2001, 1, 3, 4, 5, 6, 7);
      expect(new Date(local).setFullYear(1950, 14, 40)).toBe(new Date(1950, 14, 40, 4, 5, 6, 7).getTime());
      expect(new Date(local).setMonth(14, 40)).toBe(new Date(2001, 14, 40, 4, 5, 6, 7).getTime());
      expect(new Date(local).setDate(-400)).toBe(new Date(2001, 1, -400, 4, 5, 6, 7).getTime());
      expect(new Date(local).setYear(50)).toBe(new Date(1950, 1, 3, 4, 5, 6, 7).getTime());
      expect(new Date(local).setYear(0)).toBe(new Date(1900, 1, 3, 4, 5, 6, 7).getTime());
      expect(new Date(local).setYear(99)).toBe(new Date(1999, 1, 3, 4, 5, 6, 7).getTime());
      expect(new Date(local).setYear(100)).toBe(new Date(local).setFullYear(100));
      expect(new Date(local).setYear(275760)).toBe(new Date(275760, 1, 3, 4, 5, 6, 7).getTime());
    });
  });
});
