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

  // ICU's islamic calendars have one era: a date before the Hijra is era AH with a year of 0 or less. For a Temporal
  // value JavaScriptCore once replaced that era and year with its own English text ("1054 Before Hijra") in format(),
  // formatToParts() and toLocaleString(), and not in formatRange() or formatRangeToParts(). It added that era to a
  // month and a day too. test/js/web/intl/intl.test.ts has the same checks for a Number and a Date.
  test.each(["islamic-civil", "islamic-tbla", "islamic-umalqura", "coptic"])(
    "every method prints one text for a Temporal value before the epoch of %s",
    calendar => {
      const date = Temporal.PlainDate.from("-000400-01-15").withCalendar(calendar);
      const zoned = date.toZonedDateTime("UTC");
      const values = {
        PlainDate: date,
        PlainDateTime: date.toPlainDateTime("12:00"),
        PlainYearMonth: date.toPlainYearMonth(),
        // The reference year is before the epoch too.
        PlainMonthDay: new Temporal.PlainMonthDay(1, 15, calendar, 200),
        Instant: zoned.toInstant(),
      };
      const join = (parts: { value: string }[]) => parts.map(part => part.value).join("");
      const differing: string[] = [];
      for (const locale of ["en", "sv"]) {
        const fields = { calendar, era: "long", year: "numeric", month: "short", day: "numeric" } as const;
        const options = { ...fields, timeZone: "UTC" };
        const format = new Intl.DateTimeFormat(locale, options);
        for (const [kind, value] of Object.entries(values)) {
          const texts = new Set([
            format.format(value),
            join(format.formatToParts(value)),
            format.formatRange(value, value),
            join(format.formatRangeToParts(value, value)),
            value.toLocaleString(locale, options),
          ]);
          if (texts.size !== 1) differing.push(`${locale} ${kind}: ${[...texts].join(" | ")}`);
        }
        // A ZonedDateTime has its own time zone. It prints the text of its instant in that zone.
        const texts = new Set([zoned.toLocaleString(locale, fields), format.format(zoned.toInstant())]);
        if (texts.size !== 1) differing.push(`${locale} ZonedDateTime: ${[...texts].join(" | ")}`);
      }
      expect(differing).toEqual([]);
    },
  );

  test("structuredClone rejects Temporal objects", () => {
    expect(() => structuredClone(Temporal.PlainDate.from("2024-06-15"))).toThrow(DOMException);
    expect(() => structuredClone(Temporal.Instant.from("2024-06-15T00:00Z"))).toThrow(DOMException);
  });
});
