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

// Divergences from V8 found by differential fuzzing. Expected values are what Node 26 / Chromium 148 print.
describe("Temporal spec conformance", () => {
  test("PlainDate.from rejects a non-object options before it resolves the calendar fields", () => {
    // ToTemporalDate: PrepareCalendarFields, then GetOptionsObject (TypeError), then CalendarDateFromFields
    // (era resolution and the ISODateWithinLimits check, both RangeError).
    const lateFailingBags = [
      { year: -271821, month: 2, day: 31 },
      { year: 275760, month: 9, day: 14 },
      { era: "xx", eraYear: 1, month: 1, day: 1, calendar: "gregory" },
      { year: 2024, month: 13, day: 1 },
    ];
    for (const bag of lateFailingBags) {
      for (const options of [null, "constrain", 1, true]) {
        expect(() => Temporal.PlainDate.from(bag, options as any)).toThrow(TypeError);
      }
    }
    // The bag is still read first, and PrepareCalendarFields errors still win.
    const reads: PropertyKey[] = [];
    const bag = new Proxy(
      { year: -271821, month: 2, day: 31 },
      { get: (t, k, r) => (reads.push(k), Reflect.get(t, k, r)) },
    );
    expect(() => Temporal.PlainDate.from(bag, null as any)).toThrow(TypeError);
    expect(reads).toEqual(["calendar", "day", "month", "monthCode", "year"]);
    expect(() => Temporal.PlainDate.from({ year: 2024, month: 0, day: 1 }, null as any)).toThrow(RangeError);
    // With a real options object the late RangeErrors surface.
    expect(() => Temporal.PlainDate.from(lateFailingBags[0], {})).toThrow(RangeError);
    expect(() => Temporal.PlainDate.from(lateFailingBags[2], {})).toThrow(RangeError);
    expect(Temporal.PlainDate.from(lateFailingBags[3], {}).toString()).toBe("2024-12-01");
  });

  test("rounding to weeks accepts a window edge on the minimum PlainDate", () => {
    const later = Temporal.PlainDate.from("2016-02-29");
    const nearMin = Temporal.PlainDate.from("-271821-04-20");
    const results = Object.fromEntries(
      ["trunc", "floor", "expand", "halfExpand"].map(roundingMode => [
        roundingMode,
        later.since(nearMin, { smallestUnit: "weeks", roundingMode: roundingMode as Temporal.RoundingMode }).toString(),
      ]),
    );
    expect(results).toEqual({
      trunc: "P14288122W",
      floor: "P14288122W",
      expand: "P14288123W",
      halfExpand: "P14288123W",
    });
    expect(nearMin.until(later, { smallestUnit: "weeks" }).toString()).toBe("P14288122W");
    expect(later.since(nearMin, { smallestUnit: "days", roundingIncrement: 7 }).toString()).toBe("P100016854D");
    expect(
      Temporal.Duration.from({ days: -100016860 })
        .round({ relativeTo: later, smallestUnit: "weeks", roundingMode: "trunc" })
        .toString(),
    ).toBe("-P14288122W");
    // An edge that is really below the minimum still throws (here: the exact minimum as operand).
    expect(() => later.since("-271821-04-19", { smallestUnit: "weeks" })).toThrow(RangeError);
  });

  test("era codes match the lowercase CLDR identifiers exactly", () => {
    for (const [calendar, era] of [
      ["gregory", "CE"],
      ["gregory", "Bce"],
      ["gregory", "AD"],
      ["japanese", "Reiwa"],
      ["hebrew", "AM"],
    ]) {
      expect(() => Temporal.PlainDate.from({ era, eraYear: 1, month: 1, day: 1, calendar })).toThrow(RangeError);
    }
    expect(Temporal.PlainDate.from({ era: "ce", eraYear: 1, month: 1, day: 1, calendar: "gregory" }).toString()).toBe(
      "0001-01-01[u-ca=gregory]",
    );
    expect(Temporal.PlainDate.from({ era: "ad", eraYear: 1, month: 1, day: 1, calendar: "gregory" }).era).toBe("ce");
    expect(
      Temporal.PlainDate.from({ era: "reiwa", eraYear: 1, month: 5, day: 1, calendar: "japanese" }).toString(),
    ).toBe("2019-05-01[u-ca=japanese]");
  });
});
