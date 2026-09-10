import { describe, expect, test } from "bun:test";

// Date.prototype.set{FullYear,Month,UTCFullYear,UTCMonth} build their result with
// MakeDay(year, month, date), which range-checks year + floor(month / 12) and never year or month
// alone (https://tc39.es/ecma262/#sec-makeday). JSC used to return NaN as soon as |year| or
// |month / 12| alone exceeded 275760, while Date.UTC and the Date constructor in the same engine
// (and V8) returned the date. oven-sh/WebKit#616.

const startOfYear275760 = 8639977881600000; // 275760 is the last year with representable time values.
const minTimeValue = -8.64e15; // -271821-04-20T00:00:00Z

describe("Date setters range-check year + floor(month / 12), not each argument", () => {
  test("UTC setters give what Date.UTC gives for the same fields", () => {
    expect(Date.UTC(275760, 0, 1)).toBe(startOfYear275760);
    expect(new Date(0).setUTCFullYear(275761, -12, 1)).toBe(startOfYear275760);
    expect(new Date(0).setUTCFullYear(275761, -12)).toBe(startOfYear275760);
    expect(new Date(0).setUTCFullYear(300000, -300000, 1)).toBe(Date.UTC(275000, 0, 1));
    expect(new Date(0).setUTCFullYear(-300000, 12 * 302000)).toBe(Date.UTC(2000, 0, 1));
    expect(new Date(NaN).setUTCFullYear(-271821, 3600000)).toBe(Date.UTC(28179, 0, 1));
    expect(new Date(Date.UTC(-1, 0, 1)).setUTCMonth(12 * 275761)).toBe(startOfYear275760);
    expect(new Date(Date.UTC(-271821, 3, 20)).setUTCMonth(3 + 12 * (275760 + 271821))).toBe(Date.UTC(275760, 3, 20));
    expect(new Date(startOfYear275760).setUTCMonth(3 - 12 * (275760 + 271821), 20)).toBe(minTimeValue);

    // The day count is part of the same sum: the start of 275761 is out of range, 200 days earlier is not.
    expect(new Date(0).setUTCFullYear(275761, 0, -200)).toBe(Date.UTC(275760, 0, 166));
    expect(new Date(0).setUTCFullYear(-271822, 0, 500)).toBe(Date.UTC(-271821, 0, 135));

    // Exact to the millisecond even when |days * msPerDay| exceeds 2^53.
    expect(new Date(946688523001).setUTCFullYear(300000, 0, -108842264)).toBe(946688523001);
    expect(new Date(8.64e15 - 999).setUTCDate(-199000000)).toBe(Date.UTC(275760, 8, -199000000, 23, 59, 59, 1));
    expect(new Date(8.64e15 - 999).setUTCDate(-199000000)).toBe(-8553601036800999);

    const date = new Date(0);
    expect(date.setUTCFullYear(275761, -12, 1)).toBe(startOfYear275760);
    expect(date.toISOString()).toBe("+275760-01-01T00:00:00.000Z");
    expect(date.setUTCMonth(9)).toBeNaN(); // October 275760 is past the last time value.
    expect(date.getTime()).toBeNaN();
  });

  test("local time setters give what the Date constructor gives", () => {
    expect(new Date(2000, 0, 1).setFullYear(300000, -300000, 1)).toBe(new Date(275000, 0, 1).getTime());
    expect(new Date(2000, 0, 1).setFullYear(275761, -12)).toBe(new Date(275760, 0, 1).getTime());
    expect(new Date(-1000, 0, 1).setMonth(12 * 276000 + 5, 6)).toBe(new Date(275000, 5, 6).getTime());
    expect(new Date(2000, 0, 1, 1, 2, 3, 457).setFullYear(300000, 0, -108842264)).toBe(
      new Date(300000, 0, -108842264, 1, 2, 3, 457).getTime(),
    );
    expect(Number.isFinite(new Date(275000, 5, 6).getTime())).toBe(true);
  });

  test("still NaN when the combined year is out of range or an argument is not finite", () => {
    expect(new Date(0).setUTCFullYear(275761, 0, 1)).toBeNaN();
    expect(new Date(0).setUTCFullYear(275760, 12)).toBeNaN();
    expect(new Date(0).setUTCFullYear(-271822, 0, 1)).toBeNaN();
    expect(new Date(0).setUTCMonth(12 * 275760)).toBeNaN();
    // A year or month count beyond int32 does not wrap around.
    expect(new Date(0).setUTCFullYear(2 ** 31 + 2000)).toBeNaN();
    expect(new Date(0).setUTCFullYear(2 ** 32 + 2000)).toBeNaN();
    expect(new Date(0).setUTCFullYear(2000, 12 * 2 ** 32)).toBeNaN();
    expect(new Date(0).setUTCMonth(12 * 2 ** 32)).toBeNaN();
    expect(new Date(0).setFullYear(2 ** 32 + 2000)).toBeNaN();
    expect(new Date(0).setMonth(12 * 2 ** 32)).toBeNaN();
    expect(new Date(0).setYear(2 ** 32 + 2000)).toBeNaN();
    expect(new Date(0).setYear(275761)).toBeNaN();
    expect(new Date(0).setUTCFullYear(500000, -12 * (500000 - 2000))).toBe(Date.UTC(2000, 0, 1));
    expect(new Date(0).setUTCFullYear(-9007197107257351, 108086391056891980, 784353026671)).toBeNaN();
    expect(Date.UTC(-9007197107257351, 108086391056891980, 784353026671)).toBeNaN();

    expect(new Date(0).setUTCFullYear(Infinity, -Infinity)).toBeNaN();
    expect(new Date(0).setUTCFullYear(-Infinity, Infinity, 1)).toBeNaN();
    expect(new Date(0).setUTCFullYear(2000, Infinity, -Infinity)).toBeNaN();
    expect(new Date(0).setUTCMonth(NaN, 1)).toBeNaN();
    expect(new Date(0).setFullYear(Infinity, -Infinity)).toBeNaN();
  });
});
