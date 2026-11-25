import { describe, expect, test } from "bun:test";
import { hasVersion as hasBunIcu } from "../intl/intl-golden/observe";

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

// https://github.com/oven-sh/bun/issues/49579
// Each amount is 2^32 days, to the nearest month. A day count that is truncated to 32 bits gives a date
// in 2023. ICU4C truncates it, so a Bun that has the system's ICU does too (macOS, and Linux with a local
// WebKit). oven-sh/WebKit#598 takes these calendars off `ucal_add`.
describe.each(["islamic-civil", "islamic-tbla", "islamic-umalqura"])("a far date of the %s calendar", calendar => {
  const date = Temporal.PlainDate.from({ year: 1445, month: 1, day: 1, calendar });
  const dateTime = date.toPlainDateTime();
  const yearMonth = Temporal.PlainYearMonth.from({ year: 1445, month: 1, calendar });
  const zoned = dateTime.toZonedDateTime("UTC");

  describe.each([{ years: -12120122 }, { months: 145441464 }])("%j", duration => {
    const negated = Temporal.Duration.from(duration).negated();

    test.todoIf(!hasBunIcu).each([
      ["PlainDate", date],
      ["PlainDateTime", dateTime],
      ["PlainYearMonth", yearMonth],
      ["ZonedDateTime", zoned],
    ])("%s add and subtract throw", (_, start) => {
      expect(() => start.add(duration)).toThrow(RangeError);
      expect(() => start.add(duration, { overflow: "reject" })).toThrow(RangeError);
      expect(() => start.subtract(negated)).toThrow(RangeError);
      expect(() => start.subtract(negated, { overflow: "reject" })).toThrow(RangeError);
    });

    test.todoIf(!hasBunIcu)("Duration with relativeTo throws", () => {
      const far = Temporal.Duration.from(duration);
      expect(() => far.total({ unit: "days", relativeTo: date })).toThrow(RangeError);
      expect(() => far.round({ largestUnit: "years", relativeTo: zoned })).toThrow(RangeError);
      expect(() => Temporal.Duration.compare(far, { days: 1 }, { relativeTo: date })).toThrow(RangeError);
    });
  });

  test.todoIf(!hasBunIcu)("until and since with a far rounding increment throw", () => {
    const years = { smallestUnit: "years", roundingIncrement: 12120122, roundingMode: "expand" } as const;
    const months = { smallestUnit: "months", roundingIncrement: 145441464, roundingMode: "expand" } as const;
    expect(() => date.until(date.subtract({ years: 1 }), years)).toThrow(RangeError);
    expect(() => date.since(date.subtract({ years: 1 }), years)).toThrow(RangeError);
    expect(() => date.until(date.add({ months: 1 }), months)).toThrow(RangeError);
    expect(() => date.add({ months: 1 }).since(date, months)).toThrow(RangeError);
    expect(() => dateTime.until(dateTime.add({ months: 1 }), months)).toThrow(RangeError);
  });
});

test("dates of the islamic-civil calendar near the limits stay", () => {
  const date = Temporal.PlainDate.from({ year: 1445, month: 1, day: 1, calendar: "islamic-civil" });
  expect(date.add({ years: -280000 }).toString()).toBe("-269639-02-11[u-ca=islamic-civil]");
  expect(date.add({ years: 280000 }).toString()).toBe("+273685-12-24[u-ca=islamic-civil]");
  expect(date.add({ months: -3360000 }).toString()).toBe("-269639-02-11[u-ca=islamic-civil]");
});
