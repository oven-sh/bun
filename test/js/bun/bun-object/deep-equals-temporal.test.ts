import { describe, expect, it } from "bun:test";
import { isDeepStrictEqual } from "node:util";

// Temporal objects keep their state in internal slots and have no own
// properties; without dedicated handling every pair of instances of a class
// compares equal. They compare by class + internal fields, like Date.
describe.each([true, false])("Bun.deepEquals on Temporal values (strict: %p)", strict => {
  const deepEquals = (a: unknown, b: unknown) => Bun.deepEquals(a, b, strict);

  it.each([
    () => Temporal.Instant.from("2024-06-15T12:34:56.789Z"),
    () => Temporal.PlainDateTime.from("2024-06-15T12:34:56"),
    () => Temporal.PlainDate.from("2024-06-15"),
    () => Temporal.PlainTime.from("12:34:56.5"),
    () => Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[Europe/Berlin]"),
    () => Temporal.PlainYearMonth.from("2024-06"),
    () => Temporal.PlainMonthDay.from("06-15"),
    () => Temporal.Duration.from("P1DT2H3M4.5S"),
  ])("two separately constructed instances of the same value are equal (%p)", make => {
    expect(deepEquals(make(), make())).toBe(true);
  });

  it.each([
    [
      () => Temporal.Instant.from("2024-06-15T12:34:56Z"),
      () => Temporal.Instant.from("2024-06-15T12:34:56.000000001Z"),
    ],
    [
      () => Temporal.PlainDateTime.from("2024-06-15T12:34:56"),
      () => Temporal.PlainDateTime.from("2024-06-15T12:34:57"),
    ],
    [() => Temporal.PlainDate.from("2020-01-01"), () => Temporal.PlainDate.from("1999-12-31")],
    [() => Temporal.PlainTime.from("12:34:56"), () => Temporal.PlainTime.from("12:34:56.000000001")],
    [
      () => Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[Europe/Berlin]"),
      () => Temporal.ZonedDateTime.from("2024-06-15T12:34:57+02:00[Europe/Berlin]"),
    ],
    [() => Temporal.PlainYearMonth.from("2024-06"), () => Temporal.PlainYearMonth.from("2024-07")],
    [() => Temporal.PlainMonthDay.from("06-15"), () => Temporal.PlainMonthDay.from("06-16")],
    [() => Temporal.Duration.from("PT1H"), () => Temporal.Duration.from("PT2H")],
    // Field-wise, not balanced: one hour and sixty minutes are different Durations.
    [() => Temporal.Duration.from("PT1H"), () => Temporal.Duration.from("PT60M")],
    [() => Temporal.Duration.from("PT1H"), () => Temporal.Duration.from("-PT1H")],
    // Every remaining Duration unit distinguishes values.
    [() => Temporal.Duration.from({ years: 1 }), () => Temporal.Duration.from({ years: 2 })],
    [() => Temporal.Duration.from({ months: 1 }), () => Temporal.Duration.from({ months: 2 })],
    [() => Temporal.Duration.from({ weeks: 1 }), () => Temporal.Duration.from({ weeks: 2 })],
    [() => Temporal.Duration.from({ days: 1 }), () => Temporal.Duration.from({ days: 2 })],
    [() => Temporal.Duration.from({ minutes: 1 }), () => Temporal.Duration.from({ minutes: 2 })],
    [() => Temporal.Duration.from({ seconds: 1 }), () => Temporal.Duration.from({ seconds: 2 })],
    [() => Temporal.Duration.from({ milliseconds: 1 }), () => Temporal.Duration.from({ milliseconds: 2 })],
    [() => Temporal.Duration.from({ microseconds: 1 }), () => Temporal.Duration.from({ microseconds: 2 })],
    [() => Temporal.Duration.from({ nanoseconds: 1 }), () => Temporal.Duration.from({ nanoseconds: 2 })],
    // The calendar distinguishes values for every calendar-bearing class.
    [() => Temporal.PlainDate.from("2024-06-15"), () => Temporal.PlainDate.from("2024-06-15[u-ca=hebrew]")],
    [
      () => Temporal.PlainDateTime.from("2024-06-15T12:34:56"),
      () => Temporal.PlainDateTime.from("2024-06-15T12:34:56[u-ca=hebrew]"),
    ],
    [
      () => Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[Europe/Berlin]"),
      () => Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[Europe/Berlin][u-ca=hebrew]"),
    ],
    [() => Temporal.PlainYearMonth.from("2024-06"), () => Temporal.PlainYearMonth.from("2024-06-15[u-ca=hebrew]")],
    [() => Temporal.PlainMonthDay.from("06-15"), () => Temporal.PlainMonthDay.from("2024-06-15[u-ca=hebrew]")],
  ])("different values of the same class are not equal (case %#)", (makeA, makeB) => {
    expect(deepEquals(makeA(), makeB())).toBe(false);
    expect(deepEquals(makeB(), makeA())).toBe(false);
  });

  it("different Temporal classes are never equal, even for the same moment", () => {
    const zdt = Temporal.ZonedDateTime.from("2024-06-15T12:34:56+00:00[UTC]");
    expect(deepEquals(zdt.toInstant(), zdt)).toBe(false);
    expect(deepEquals(zdt, zdt.toInstant())).toBe(false);
    expect(deepEquals(Temporal.PlainDate.from("2024-06-15"), Temporal.PlainDateTime.from("2024-06-15T00:00:00"))).toBe(
      false,
    );
  });

  it("a Temporal object never equals a plain object", () => {
    const date = Temporal.PlainDate.from("2024-06-15");
    expect(deepEquals(date, {})).toBe(false);
    expect(deepEquals({}, date)).toBe(false);
  });

  it("the same instant in different zones or calendars is not equal", () => {
    const berlin = Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[Europe/Berlin]");
    const utc = berlin.withTimeZone("UTC");
    expect(berlin.toInstant().equals(utc.toInstant())).toBe(true);
    expect(deepEquals(berlin, utc)).toBe(false);
    expect(deepEquals(Temporal.PlainDate.from("2024-06-15"), Temporal.PlainDate.from("2024-06-15[u-ca=hebrew]"))).toBe(
      false,
    );
  });

  it("extra own properties are ignored, matching Date", () => {
    const a = Temporal.PlainDate.from("2024-06-15");
    const b = Object.assign(Temporal.PlainDate.from("2024-06-15"), { extra: 1 });
    expect(deepEquals(a, b)).toBe(true);
    const c = new Date(0);
    const d = Object.assign(new Date(0), { extra: 1 });
    expect(deepEquals(c, d)).toBe(true);
  });

  it("nests inside structures", () => {
    const make = () => ({
      when: [Temporal.PlainTime.from("07:32:00")],
      meta: new Map([["d", Temporal.PlainDate.from("1979-05-27")]]),
    });
    expect(deepEquals(make(), make())).toBe(true);
    const other = make();
    other.when[0] = Temporal.PlainTime.from("07:32:01");
    expect(deepEquals(make(), other)).toBe(false);
  });
});

describe("expect().toEqual on Temporal values", () => {
  it("compares by value in toEqual and toStrictEqual", () => {
    expect(Temporal.PlainDate.from("2024-06-15")).toEqual(Temporal.PlainDate.from("2024-06-15"));
    expect(Temporal.PlainDate.from("2024-06-15")).toStrictEqual(Temporal.PlainDate.from("2024-06-15"));
    expect(Temporal.PlainDate.from("2020-01-01")).not.toEqual(Temporal.PlainDate.from("1999-12-31"));
    expect(Temporal.Instant.from("2024-06-15T12:34:56Z")).not.toEqual(Temporal.Instant.from("2024-06-15T12:34:57Z"));
    expect({ d: Temporal.PlainTime.from("07:32:00") }).toEqual({ d: Temporal.PlainTime.from("07:32:00") });
    expect({ d: Temporal.PlainTime.from("07:32:00") }).not.toEqual({ d: Temporal.PlainTime.from("07:32:01") });
  });

  it("ignores extra own properties in toEqual and toStrictEqual, matching Date", () => {
    const withExtra = Object.assign(Temporal.PlainDate.from("2024-06-15"), { extra: 1 });
    expect(withExtra).toEqual(Temporal.PlainDate.from("2024-06-15"));
    expect(withExtra).toStrictEqual(Temporal.PlainDate.from("2024-06-15"));
    expect(Temporal.PlainDate.from("2024-06-15")).toEqual(withExtra);
  });
});

describe("util.isDeepStrictEqual on Temporal values", () => {
  it("compares by value", () => {
    expect(isDeepStrictEqual(Temporal.PlainDate.from("2024-06-15"), Temporal.PlainDate.from("2024-06-15"))).toBe(true);
    expect(isDeepStrictEqual(Temporal.PlainDate.from("2020-01-01"), Temporal.PlainDate.from("1999-12-31"))).toBe(false);
    expect(
      isDeepStrictEqual(Temporal.Instant.from("2024-06-15T12:34:56Z"), Temporal.Instant.from("2024-06-15T12:34:56Z")),
    ).toBe(true);
    expect(
      isDeepStrictEqual(Temporal.Instant.from("2024-06-15T12:34:56Z"), Temporal.Instant.from("2024-06-15T12:34:57Z")),
    ).toBe(false);
    expect(isDeepStrictEqual(Temporal.Duration.from("PT1H"), Temporal.Duration.from("PT60M"))).toBe(false);
  });
});
