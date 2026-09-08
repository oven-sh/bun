import { describe, expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/15853
// The default-on/opt-out subprocess tests live in
// test/js/bun/jsc/temporal-global.test.ts next to the other JSC option tests.
describe.concurrent("Temporal global", () => {
  test("is installed with the spec property attributes", () => {
    expect(Object.getOwnPropertyDescriptor(globalThis, "Temporal")).toMatchObject({
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  test("exposes all nine namespaces", () => {
    expect(Object.getOwnPropertyNames(Temporal).sort()).toEqual([
      "Duration",
      "Instant",
      "Now",
      "PlainDate",
      "PlainDateTime",
      "PlainMonthDay",
      "PlainTime",
      "PlainYearMonth",
      "ZonedDateTime",
    ]);
    expect(Temporal[Symbol.toStringTag]).toBe("Temporal");
  });
});

describe("Temporal core operations", () => {
  test("Temporal.Now", () => {
    expect(Temporal.Now.instant()).toBeInstanceOf(Temporal.Instant);
    expect(Temporal.Now.plainDateISO()).toBeInstanceOf(Temporal.PlainDate);
    expect(Temporal.Now.plainDateTimeISO()).toBeInstanceOf(Temporal.PlainDateTime);
    expect(Temporal.Now.plainTimeISO()).toBeInstanceOf(Temporal.PlainTime);
    expect(Temporal.Now.zonedDateTimeISO()).toBeInstanceOf(Temporal.ZonedDateTime);
    expect(typeof Temporal.Now.timeZoneId()).toBe("string");
  });

  test("parsing, arithmetic, and formatting round-trip", () => {
    const d = Temporal.PlainDate.from("2024-06-15");
    expect(d.add({ months: 1, days: 20 }).toString()).toBe("2024-08-04");
    expect(d.since("2023-01-01", { largestUnit: "month" }).toString()).toBe("P17M14D");

    const i = Temporal.Instant.from("2024-06-15T12:34:56.789Z");
    expect(i.epochMilliseconds).toBe(1718454896789);
    expect(i.round({ smallestUnit: "minute" }).toString()).toBe("2024-06-15T12:35:00Z");

    const z = Temporal.ZonedDateTime.from("2024-06-15T12:34:56-04:00[America/New_York]");
    expect(z.toString()).toBe("2024-06-15T12:34:56-04:00[America/New_York]");
    expect(z.withTimeZone("Asia/Tokyo").toString()).toBe("2024-06-16T01:34:56+09:00[Asia/Tokyo]");

    expect(Temporal.Duration.from({ hours: 36, minutes: 30 }).round({ largestUnit: "day" }).toString()).toBe(
      "P1DT12H30M",
    );
  });

  test("DST disambiguation", () => {
    // 2024-03-10 02:30 does not exist in America/New_York (spring-forward gap).
    const gap = Temporal.PlainDateTime.from("2024-03-10T02:30:00");
    expect(gap.toZonedDateTime("America/New_York", { disambiguation: "earlier" }).toString()).toBe(
      "2024-03-10T01:30:00-05:00[America/New_York]",
    );
    expect(gap.toZonedDateTime("America/New_York", { disambiguation: "later" }).toString()).toBe(
      "2024-03-10T03:30:00-04:00[America/New_York]",
    );
    expect(() => gap.toZonedDateTime("America/New_York", { disambiguation: "reject" })).toThrow(RangeError);
  });

  test("Date.prototype.toTemporalInstant", () => {
    const date = new Date("2024-06-15T12:34:56.789Z");
    const instant = date.toTemporalInstant();
    expect(instant).toBeInstanceOf(Temporal.Instant);
    expect(instant.epochMilliseconds).toBe(date.getTime());
  });

  test("Intl.DateTimeFormat formats Temporal objects", () => {
    const d = Temporal.PlainDate.from("2024-06-15");
    expect(new Intl.DateTimeFormat("en-US").format(d)).toBe("6/15/2024");
    expect(d.toLocaleString("en-US")).toBe("6/15/2024");
  });

  test("structuredClone rejects Temporal objects", () => {
    expect(() => structuredClone(Temporal.PlainDate.from("2024-06-15"))).toThrow(DOMException);
    expect(() => structuredClone(Temporal.Instant.from("2024-06-15T00:00Z"))).toThrow(DOMException);
  });
});

// ICU4C evaluates the tabular Hijri leap rule ((14 + 11y) mod 30 < 11) and the Persian one
// ((25y + 11) mod 33 < 8) with a truncating %, so on its own it calls almost every year below 1 a
// leap year while still placing the days correctly. The engine has to report lengths that agree
// with where the days are (and with icu4x): a floored remainder.
describe("Temporal non-ISO calendars before their epoch", () => {
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  const tabularLeapYear = (calendar: string, year: number) =>
    calendar === "persian" ? mod(25 * year + 11, 33) < 8 : mod(14 + 11 * year, 30) < 11;
  const fields = (d: Temporal.PlainDate) => `${d.year}-${d.monthCode}-${d.day}`;
  const hijri = ["islamic-civil", "islamic-tbla", "islamic-umalqura"];

  test.each([...hijri, "persian"])("%s: year and month lengths match the dates in years <= 0", calendar => {
    const commonYear = calendar === "persian" ? 365 : 354;
    for (let year = -34; year <= 3; year++) {
      const leap = tabularLeapYear(calendar, year);
      const first = Temporal.PlainDate.from({ year, month: 1, day: 1, calendar });
      const next = Temporal.PlainDate.from({ year: year + 1, month: 1, day: 1, calendar });
      const lastMonth = Temporal.PlainDate.from({ year, month: 12, day: 1, calendar });
      let sumOfMonths = 0;
      for (let month = 1; month <= 12; month++) {
        sumOfMonths += Temporal.PlainDate.from({ year, month, day: 1, calendar }).daysInMonth;
      }
      expect({
        year,
        inLeapYear: first.inLeapYear,
        daysInYear: first.daysInYear,
        daysUntilNextYear: first.until(next, { largestUnit: "days" }).days,
        sumOfMonths,
        lastMonthDays: lastMonth.daysInMonth,
        lastDayOfYear: lastMonth.with({ day: 30 }).dayOfYear,
        day30Constrained: Temporal.PlainDate.from({ year, month: 12, day: 30, calendar }).day,
        dayAfterLastDay: fields(lastMonth.with({ day: 30 }).add({ days: 1 })),
      }).toEqual({
        year,
        inLeapYear: leap,
        daysInYear: commonYear + +leap,
        daysUntilNextYear: commonYear + +leap,
        sumOfMonths: commonYear + +leap,
        lastMonthDays: 29 + +leap,
        lastDayOfYear: commonYear + +leap,
        day30Constrained: 29 + +leap,
        dayAfterLastDay: `${year + 1}-M01-1`,
      });
      const rejectDay30 = () => Temporal.PlainDate.from({ year, month: 12, day: 30, calendar }, { overflow: "reject" });
      if (leap) expect(rejectDay30().day).toBe(30);
      else expect(rejectDay30).toThrow(RangeError);
    }
  });

  test.each(hijri)("%s: year and month arithmetic regulates the day against the real month length", calendar => {
    // -4 and -6 are leap (30-day Dhu al-Hijjah); -3, -5 and -7 are common.
    const leapLastDay = Temporal.PlainDate.from({ year: -4, month: 12, day: 30, calendar });
    const muharram30 = Temporal.PlainDate.from({ year: -7, month: 1, day: 30, calendar });
    const newYearMinus5 = Temporal.PlainDate.from({ year: -5, month: 1, day: 1, calendar });
    expect({
      plusOneYear: fields(leapLastDay.add({ years: 1 })),
      minusThreeYears: fields(leapLastDay.subtract({ years: 3 })),
      plusThreeYears: fields(leapLastDay.add({ years: 3 }, { overflow: "reject" })),
      plus11Months: fields(muharram30.add({ months: 11 })),
      plus23Months: fields(muharram30.add({ months: 23 }, { overflow: "reject" })),
      plus11Months1Day: fields(muharram30.add({ months: 11, days: 1 })),
      untilYears: muharram30.until(newYearMinus5, { largestUnit: "years" }).toString(),
      untilMonths: muharram30.until(newYearMinus5, { largestUnit: "months" }).toString(),
      sinceMonths: muharram30.since(newYearMinus5, { largestUnit: "months" }).toString(),
      roundTrip: muharram30.add("P1Y11M1D").equals(newYearMinus5),
      yearMonthPlusOneYear: Temporal.PlainYearMonth.from({ year: -4, month: 12, calendar }).add({ years: 1 }).daysInMonth,
    }).toEqual({
      plusOneYear: "-3-M12-29",
      minusThreeYears: "-7-M12-29",
      plusThreeYears: "-1-M12-30",
      plus11Months: "-7-M12-29",
      plus23Months: "-6-M12-30",
      plus11Months1Day: "-6-M01-1",
      untilYears: "P1Y11M1D",
      untilMonths: "P23M1D",
      sinceMonths: "-P23M1D",
      roundTrip: true,
      yearMonthPlusOneYear: 29,
    });
    expect(() => leapLastDay.add({ years: 1 }, { overflow: "reject" })).toThrow(RangeError);
    expect(() => muharram30.add({ months: 11 }, { overflow: "reject" })).toThrow(RangeError);
  });

  test("persian: year and month arithmetic regulates the day against the real month length", () => {
    const calendar = "persian";
    // -3 and -7 are leap (30-day Esfand); -4, -2, -1 and 0 are common.
    const bahman30 = Temporal.PlainDate.from({ year: -1, month: 11, day: 30, calendar });
    const leapLastDay = Temporal.PlainDate.from({ year: -3, month: 12, day: 30, calendar });
    const farvardin31 = Temporal.PlainDate.from({ year: -2, month: 1, day: 31, calendar });
    const newYear0 = Temporal.PlainDate.from({ year: 0, month: 1, day: 1, calendar });
    expect({
      plusOneMonth: fields(bahman30.add({ months: 1 })),
      plusTwoYears: fields(leapLastDay.add({ years: 2 })),
      minusOneYear: fields(leapLastDay.subtract({ years: 1 })),
      minusFourYears: fields(leapLastDay.subtract({ years: 4 }, { overflow: "reject" })),
      plus23Months: fields(farvardin31.add({ months: 23 })),
      untilYears: farvardin31.until(newYear0, { largestUnit: "years" }).toString(),
      untilMonths: farvardin31.until(newYear0, { largestUnit: "months" }).toString(),
      roundTrip: farvardin31.add("P1Y11M1D").equals(newYear0),
      firstDayISO: Temporal.PlainDate.from({ year: -1, month: 1, day: 1, calendar }).toString(),
    }).toEqual({
      plusOneMonth: "-1-M12-29",
      plusTwoYears: "-1-M12-29",
      minusOneYear: "-4-M12-29",
      minusFourYears: "-7-M12-30",
      plus23Months: "-1-M12-29",
      untilYears: "P1Y11M1D",
      untilMonths: "P23M1D",
      roundTrip: true,
      firstDayISO: "0620-03-21[u-ca=persian]",
    });
    expect(() => bahman30.add({ months: 1 }, { overflow: "reject" })).toThrow(RangeError);
    expect(() => leapLastDay.add({ years: 2 }, { overflow: "reject" })).toThrow(RangeError);
  });
});
