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

// Month differences in the calendars whose months follow the moon. JSC counts the months from the
// day span and confirms the count with one ICU month addition, so the cost of until()/since() does
// not grow with the span (a chinese century used to take a second, two millennia tens of seconds).
describe("Temporal lunar-calendar month arithmetic over long spans", () => {
  function expectRoundTrip(one: Temporal.PlainDate, two: Temporal.PlainDate, months: number) {
    const until = one.until(two, { largestUnit: "months" });
    expect(until.months).toBe(months);
    expect(Math.abs(until.days)).toBeLessThan(30);
    expect(one.add(until).equals(two)).toBe(true);
    expect(two.until(one, { largestUnit: "months" }).months).toBe(-months);
    expect(one.since(two, { largestUnit: "months" }).months).toBe(-months);
  }

  describe.each(["chinese", "dangi"] as const)("%s", calendar => {
    test("two millennia of months", () => {
      // Both ends sit mid-month, so the count does not depend on which day ICU starts a month on.
      const one = Temporal.PlainDate.from("0001-01-25").withCalendar(calendar);
      const two = Temporal.PlainDate.from("2034-03-05").withCalendar(calendar);
      expectRoundTrip(one, two, 25146);
      expect(one.until(two, { largestUnit: "years" }).years).toBe(2033);
      expectRoundTrip(
        Temporal.PlainDate.from("-002000-04-20").withCalendar(calendar),
        Temporal.PlainDate.from("-000001-12-12").withCalendar(calendar),
        24732,
      );
    });

    test("a leap month (2023 has M02L) and a day-30 start that clamps along the way", () => {
      const day30 = Temporal.PlainDate.from({ calendar, year: 2020, monthCode: "M04", day: 30 });
      expect(day30.day).toBe(30);
      expectRoundTrip(day30, Temporal.PlainDate.from({ calendar, year: 2031, monthCode: "M09", day: 29 }), 141);
    });
  });

  // 235 hebrew months are exactly 19 years. ICU 75+ mis-adds 229 or more months forward from
  // Adar..Elul of a common year; JSC routes around it.
  describe("hebrew", () => {
    const nisan5720 = Temporal.PlainDate.from({ calendar: "hebrew", year: 5720, monthCode: "M07", day: 25 });

    test.each([
      [229, "5739 M01 25"],
      [235, "5739 M07 25"],
      [463, "5757 M12 25"],
      [464, "5758 M01 25"],
      [2351, "5910 M08 25"],
    ] as const)("5720 Nisan 25 + %d months is %s", (months, expected) => {
      expect(nisan5720.inLeapYear).toBe(false);
      const sum = nisan5720.add({ months });
      expect(`${sum.year} ${sum.monthCode} ${sum.day}`).toBe(expected);
      expect(sum.subtract({ months }).equals(nisan5720)).toBe(true);
    });

    test("counting more than 19 years of months", () => {
      const tishri5758 = Temporal.PlainDate.from({ calendar: "hebrew", year: 5758, monthCode: "M01", day: 14 });
      expect(nisan5720.until(tishri5758, { largestUnit: "months" }).toString()).toBe("P463M18D");
      expect(tishri5758.since(nisan5720, { largestUnit: "months" }).toString()).toBe("P463M19D");
      expect(nisan5720.until(tishri5758, { largestUnit: "years" }).toString()).toBe("P37Y5M18D");
      expectRoundTrip(
        Temporal.PlainDate.from("1880-08-06").withCalendar("hebrew"),
        Temporal.PlainDate.from("2943-11-02").withCalendar("hebrew"),
        13150,
      );
    });
  });

  // Twelve lunar months to every year, so whole years are a closed form for the shared month tail.
  describe.each(["islamic-civil", "islamic-tbla", "islamic-umalqura"] as const)("%s", calendar => {
    test("two centuries of months", () => {
      const one = Temporal.PlainDate.from({ calendar, year: 1300, monthCode: "M01", day: 1 });
      const two = Temporal.PlainDate.from({ calendar, year: 1500, monthCode: "M01", day: 1 });
      expectRoundTrip(one, two, 2400);
    });
  });
});
