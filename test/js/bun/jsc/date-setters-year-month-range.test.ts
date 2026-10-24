import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// MakeDay range-checks only year + floor(month / 12), not each argument: oven-sh/bun#46342, oven-sh/WebKit#616.

const startOfYear275760 = 8639977881600000; // The last year that has time values.
const minTimeValue = -8.64e15; // -271821-04-20T00:00:00Z
const maxTimeValue = 8.64e15; // +275760-09-13T00:00:00Z
const startOfYear0 = -62167219200000; // Date.UTC(0, 0, 1) is 1900.

type DateFields = [year: number, month: number, ...rest: number[]];

// toBe() takes NaN for NaN, so an expected value from Date.UTC or the Date constructor has to be a time value.
function timeValue(time: number) {
  expect(time).not.toBeNaN();
  return time;
}
const utcTime = (...fields: DateFields) => timeValue(Date.UTC(...fields));
const localTime = (...fields: DateFields) => timeValue(new Date(...fields).getTime());
// Annex B setYear is not in TypeScript's lib.
const setYear = (date: Date, year: number) => (date as Date & { setYear(year: number): number }).setYear(year);

describe("date setters range-check year + floor(month / 12), not each argument", () => {
  test("a month count that spans more years than a year can be (#46342)", () => {
    // The issue's own lines: 3472364 months from -187631-09-27.
    const d = new Date(0);
    d.setFullYear(-187631, 8, 27);
    expect(d.setMonth(3472364)).not.toBeNaN();
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([101732, 8, 27]);

    const utc = new Date(0);
    utc.setUTCFullYear(-187631, 8, 27);
    expect(utc.setUTCMonth(3472364)).toBe(utcTime(101732, 8, 27));
    expect(utc.toISOString()).toBe("+101732-09-27T00:00:00.000Z");

    // date-fns differenceInMonths: move the later date back by the month difference with setMonth, then compare.
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
      expect(date.setUTCMonth((end - start) * 12 + 8)).toBe(utcTime(end, 8, 27));
    }
  });

  test("UTC setters give what Date.UTC gives for the same fields", () => {
    expect(Date.UTC(275760, 0, 1)).toBe(startOfYear275760);
    // A year that is out of range alone, and a month count that brings it back.
    expect(new Date(0).setUTCFullYear(275761, -12, 1)).toBe(startOfYear275760);
    expect(new Date(0).setUTCFullYear(275761, -12)).toBe(startOfYear275760);
    expect(new Date(0).setUTCFullYear(300000, -300000, 1)).toBe(utcTime(275000, 0, 1));
    expect(new Date(0).setUTCFullYear(-300000, 12 * 302000)).toBe(utcTime(2000, 0, 1));
    expect(new Date(NaN).setUTCFullYear(-271821, 3600000)).toBe(utcTime(28179, 0, 1));
    // A month count that is out of range alone: 275760 * 12 is 3309120.
    expect(new Date(Date.UTC(-1, 0, 1)).setUTCMonth(12 * 275761)).toBe(startOfYear275760);
    expect(new Date(Date.UTC(-271821, 3, 20)).setUTCMonth(3 + 12 * (275760 + 271821))).toBe(utcTime(275760, 3, 20));
    expect(new Date(startOfYear275760).setUTCMonth(3 - 12 * (275760 + 271821), 20)).toBe(minTimeValue);
    expect(new Date(startOfYear0).setUTCMonth(3309120)).toBe(startOfYear275760);
    expect(new Date(startOfYear0).setUTCMonth(3309121, 15)).toBe(utcTime(275760, 1, 15));
    expect(new Date(Date.UTC(4000, 0, 1)).setUTCMonth(-3309121)).toBe(utcTime(-271761, 11, 1));

    // The month count is split with a floor division.
    for (let month = -25; month <= 25; ++month) {
      const year = 2000 + Math.floor(month / 12);
      const monthInYear = month - 12 * Math.floor(month / 12);
      const date = new Date(Date.UTC(2000, 5, 15, 1, 2, 3, 4));
      expect(date.setUTCMonth(month)).toBe(utcTime(2000, month, 15, 1, 2, 3, 4));
      expect([date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]).toEqual([year, monthInYear, 15]);
      expect(new Date(Date.UTC(1999, 5, 15, 1, 2, 3, 4)).setUTCFullYear(2000, month)).toBe(timeValue(date.getTime()));
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
    expect(setYear(new Date(0), 275761)).toBeNaN();

    // The day count is part of the same sum: 200 days before the start of 275761 is in range.
    expect(new Date(0).setUTCFullYear(275761, 0, -200)).toBe(utcTime(275760, 0, 166));
    expect(new Date(0).setUTCFullYear(-271822, 0, 500)).toBe(utcTime(-271821, 0, 135));
    expect(new Date(0).setUTCFullYear(400000, 0, -45379000)).toBe(8639867894400000);
    // days * msPerDay is not added to the milliseconds first: that sum rounds beyond 2^53.
    expect(new Date(8.64e15 - 999).setUTCDate(-199000000)).toBe(-8553601036800999);
    expect(new Date(946688523001).setUTCFullYear(300000, 0, -108842264)).toBe(946688523001);
  });

  test("a month count is split exactly up to 12 * 2^53, and is NaN beyond it", () => {
    expect(new Date(0).setUTCFullYear(2000 - 750599937895082, 2 ** 53 - 1, 1)).toBe(965088000000); // 2000-08-01
    expect(Date.UTC(2000 - 750599937895082, 2 ** 53 - 1, 1)).toBe(965088000000);
    expect(new Date(2000 - 750599937895082, 2 ** 53 - 1, 1).getTime()).toBe(localTime(2000, 7, 1));
    expect(new Date(0).setUTCFullYear(2000 + 750599937895083, -(2 ** 53 - 1), 1)).toBe(959817600000); // 2000-06-01
    expect(Date.UTC(2000 + 750599937895083, -(2 ** 53 - 1), 1)).toBe(959817600000);
    // A double cannot split a month count beyond 2^53 exactly: it gave 2000-01-01 for the first of these.
    expect(new Date(0).setUTCFullYear(-6004799503158661, 2 ** 56, 1)).toBe(957139200000); // 2000-05-01
    expect(Date.UTC(-6004799503158661, 2 ** 56, 1)).toBe(957139200000);
    expect(new Date(-6004799503158661, 2 ** 56, 1).getTime()).toBe(localTime(2000, 4, 1));
    expect(new Date(0).setUTCFullYear(-750599937893082, 2 ** 53, 1)).toBe(967766400000); // 2000-09-01
    expect(Date.UTC(-750599937893082, 2 ** 53, 1)).toBe(967766400000);
    // 12 * 2^53 is the last month count whose floor(month / 12) is an exact Number. Beyond it the answer is NaN.
    expect(new Date(0).setUTCFullYear(2000 - 2 ** 53, 12 * 2 ** 53, 1)).toBe(946684800000); // 2000-01-01
    expect(Date.UTC(2000 - 2 ** 53, 12 * 2 ** 53, 1)).toBe(946684800000);
    expect(new Date(0).setUTCFullYear(2000 - 2 ** 53, 12 * 2 ** 53 + 16, 1)).toBeNaN();
    expect(Date.UTC(2000 - 2 ** 53, 12 * 2 ** 53 + 16, 1)).toBeNaN();
    expect(new Date(2000 - 2 ** 53, 12 * 2 ** 53 + 16, 1).getTime()).toBeNaN();

    // year + floor(month / 12) has to fit an int32. The day count can pull the last such year back.
    expect(new Date(0).setUTCFullYear(2 ** 31 - 1, 0, -784353015467)).toBe(-124334438400000);
    expect(Date.UTC(2 ** 31 - 1, 0, -784353015467)).toBe(-124334438400000);
    expect(new Date(0).setUTCFullYear(2 ** 31, 0, -784353015467)).toBeNaN();
    expect(Date.UTC(2 ** 31, 0, -784353015467)).toBeNaN();
    expect(new Date(0).setUTCFullYear(-(2 ** 31), 0, 784353015833)).toBe(-86400000);
    expect(new Date(0).setUTCFullYear(-(2 ** 31) - 1, 0, 784353015833)).toBeNaN();
    // A year or a month count beyond int32 does not wrap into range.
    expect(new Date(0).setUTCMonth(-(2 ** 53))).toBeNaN();
    expect(new Date(0).setUTCFullYear(2 ** 31 + 2000)).toBeNaN();
    expect(new Date(0).setUTCFullYear(2 ** 32 + 2000)).toBeNaN();
    expect(Date.UTC(2 ** 32 + 2000, 0, 1)).toBeNaN();
    expect(new Date(2 ** 32 + 2000, 0, 1).getTime()).toBeNaN();
    expect(new Date(0).setUTCFullYear(2000, 12 * 2 ** 32)).toBeNaN();
    expect(new Date(0).setUTCMonth(12 * 2 ** 32)).toBeNaN();
    expect(new Date(0).setUTCMonth(12 * 2 ** 32 + 5, 6)).toBeNaN();
    expect(new Date(0).setFullYear(2 ** 32 + 2000)).toBeNaN();
    expect(new Date(0).setMonth(12 * 2 ** 32)).toBeNaN();
    expect(setYear(new Date(0), 2 ** 32 + 2000)).toBeNaN();

    // An argument that is not finite is NaN, also when another one would cancel it.
    expect(new Date(0).setUTCFullYear(Infinity, -Infinity)).toBeNaN();
    expect(new Date(0).setUTCFullYear(2000, Infinity, -Infinity)).toBeNaN();
    expect(new Date(0).setUTCMonth(NaN, 1)).toBeNaN();
    expect(new Date(0).setUTCDate(Infinity)).toBeNaN();
    expect(new Date(0).setFullYear(Infinity, -Infinity)).toBeNaN();
  });

  test("a year or a month count that is not an int32 is truncated and split the same way", () => {
    expect(new Date(0).setUTCFullYear(2000.9, 13.7, 1.5)).toBe(utcTime(2001, 1, 1));
    expect(new Date(0).setUTCFullYear(-0.5, -0, 1)).toBe(startOfYear0);
    expect(new Date(0).setUTCMonth(-7.9)).toBe(utcTime(1969, 5, 1));
    expect(new Date(0).setUTCMonth("17" as unknown as number)).toBe(utcTime(1971, 5, 1));
    expect(new Date(2001, 1, 3, 4, 5, 6, 7).setFullYear(1950.5, 14.5, 40.5)).toBe(localTime(1950, 14, 40, 4, 5, 6, 7));
  });

  test("each setter with each number of arguments keeps the other fields", () => {
    const start = Date.UTC(2001, 1, 3, 4, 5, 6, 7);
    expect(new Date(start).setUTCFullYear(1950)).toBe(utcTime(1950, 1, 3, 4, 5, 6, 7));
    expect(new Date(start).setUTCFullYear(1950, 14)).toBe(utcTime(1951, 2, 3, 4, 5, 6, 7));
    expect(new Date(start).setUTCFullYear(1950, 14, 40)).toBe(-591134093993); // 1951-04-09T04:05:06.007Z
    expect(new Date(start).setUTCMonth(14)).toBe(utcTime(2002, 2, 3, 4, 5, 6, 7));
    expect(new Date(start).setUTCMonth(-3, -5)).toBe(969854706007); // 2000-09-25T04:05:06.007Z
    expect(new Date(start).setUTCDate(40)).toBe(utcTime(2001, 2, 12, 4, 5, 6, 7));
    expect(new Date(start).setUTCDate(-400)).toBe(946353906007); // 1999-12-28T04:05:06.007Z
    // A NaN date starts from +0 for setFullYear, and stays NaN for the others.
    expect(new Date(NaN).setUTCFullYear(1950, 14, 40)).toBe(utcTime(1951, 3, 9));
    expect(new Date(NaN).setUTCMonth(14, 40)).toBeNaN();
    expect(new Date(NaN).setUTCDate(40)).toBeNaN();
  });

  // `bun test` runs in UTC, and the local setters add the zone's offset after MakeDay.
  const zones = ["Etc/UTC", "America/Los_Angeles", "Asia/Kathmandu", "Australia/Lord_Howe"];
  describe.each(zones)("local setters in %s", zone => {
    const previous = process.env.TZ;
    beforeAll(() => void (process.env.TZ = zone));
    afterAll(() => void (process.env.TZ = previous ?? "Etc/UTC"));

    test("give what the Date constructor gives for the same fields", () => {
      expect(new Date(2000, 0, 1).setFullYear(275761, -12, 1)).toBe(localTime(275760, 0, 1));
      expect(new Date(2000, 0, 1).setFullYear(300000, -300000, 1)).toBe(localTime(275000, 0, 1));
      expect(new Date(-1000, 0, 1).setMonth(12 * 276000 + 5, 6)).toBe(localTime(275000, 5, 6));
      expect(new Date(2000, 0, 1).setFullYear(275761, 0, -200)).toBe(localTime(275761, 0, -200));
      expect(new Date(2000, 0, 1, 1, 2, 3, 457).setFullYear(300000, 0, -108842264)).toBe(
        localTime(300000, 0, -108842264, 1, 2, 3, 457),
      );

      const date = new Date(2000, 0, 1);
      date.setFullYear(-187631, 8, 27);
      expect(date.setMonth(3472364)).toBe(localTime(101732, 8, 27));

      const local = new Date(2001, 1, 3, 4, 5, 6, 7);
      expect(new Date(local).setFullYear(1950, 14, 40)).toBe(localTime(1950, 14, 40, 4, 5, 6, 7));
      expect(new Date(local).setMonth(14, 40)).toBe(localTime(2001, 14, 40, 4, 5, 6, 7));
      expect(new Date(local).setDate(-400)).toBe(localTime(2001, 1, -400, 4, 5, 6, 7));
      expect(setYear(new Date(local), 50)).toBe(localTime(1950, 1, 3, 4, 5, 6, 7));
      expect(setYear(new Date(local), 0)).toBe(localTime(1900, 1, 3, 4, 5, 6, 7));
      expect(setYear(new Date(local), 99)).toBe(localTime(1999, 1, 3, 4, 5, 6, 7));
      expect(setYear(new Date(local), 100)).toBe(timeValue(new Date(local).setFullYear(100)));
      expect(setYear(new Date(local), 275760)).toBe(localTime(275760, 1, 3, 4, 5, 6, 7));
    });
  });
});
