import { describe, expect, it, spyOn } from "bun:test";
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
    expect<Temporal.PlainDate>(withExtra).toEqual(Temporal.PlainDate.from("2024-06-15"));
    expect<Temporal.PlainDate>(withExtra).toStrictEqual(Temporal.PlainDate.from("2024-06-15"));
    expect(Temporal.PlainDate.from("2024-06-15")).toEqual(withExtra);
  });
});

describe("the message of a failing toEqual on Temporal values", () => {
  function sides(received: unknown, expected: unknown) {
    let message = "passed";
    try {
      expect(received).toEqual(expected);
    } catch (error) {
      message = Bun.stripANSI((error as Error).message);
    }
    const side = (name: string) => message.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? message;
    return { expected: side("Expected"), received: side("Received") };
  }
  const printed = (value: unknown) => sides(value, null).received;

  // No two of these are equal to Bun.deepEquals, so no two of them have the same text.
  const values: [text: string, make: () => unknown][] = [
    ["Temporal.Instant 2024-06-15T12:34:56.789Z", () => Temporal.Instant.from("2024-06-15T12:34:56.789Z")],
    ["Temporal.Instant 1969-12-31T23:59:59.999999999Z", () => new Temporal.Instant(-1n)],
    ["Temporal.Instant +275760-09-13T00:00:00Z", () => new Temporal.Instant(8_640_000_000_000_000_000_000n)],
    ["Temporal.PlainDateTime 2024-06-15T12:34:56", () => Temporal.PlainDateTime.from("2024-06-15T12:34:56")],
    ["Temporal.PlainDate 2024-06-15", () => Temporal.PlainDate.from("2024-06-15")],
    ["Temporal.PlainDate -000001-12-31", () => new Temporal.PlainDate(-1, 12, 31)],
    ["Temporal.PlainTime 12:34:56.5", () => Temporal.PlainTime.from("12:34:56.5")],
    ["Temporal.PlainTime 12:34:56.000000001", () => Temporal.PlainTime.from("12:34:56.000000001")],
    ["Temporal.PlainYearMonth 2024-06", () => Temporal.PlainYearMonth.from("2024-06")],
    ["Temporal.PlainMonthDay 06-15", () => Temporal.PlainMonthDay.from("06-15")],
    ["Temporal.Duration P1DT2H3M4.5S", () => Temporal.Duration.from("P1DT2H3M4.5S")],
    ["Temporal.Duration P1Y2M3W4DT5H6M7.00800901S", () => new Temporal.Duration(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)],
    ["Temporal.Duration PT60M", () => Temporal.Duration.from("PT60M")],
    ["Temporal.Duration PT1H", () => Temporal.Duration.from("PT1H")],
    ["Temporal.Duration -PT1H", () => Temporal.Duration.from("-PT1H")],

    // The instant and the zone. `toString()` has the local time, which the time zone data of the machine decides.
    [
      "Temporal.ZonedDateTime 2024-06-15T10:34:56Z[Europe/Berlin]",
      () => Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[Europe/Berlin]"),
    ],
    [
      "Temporal.ZonedDateTime 2024-06-15T10:34:56Z[UTC]",
      () => Temporal.ZonedDateTime.from("2024-06-15T10:34:56Z[UTC]"),
    ],
    [
      "Temporal.ZonedDateTime 2024-06-15T10:34:56Z[Etc/UTC]",
      () => Temporal.ZonedDateTime.from("2024-06-15T10:34:56Z[Etc/UTC]"),
    ],
    [
      "Temporal.ZonedDateTime 2024-06-15T10:34:56Z[+02:00]",
      () => Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[+02:00]"),
    ],

    // The calendar, when it is not ISO 8601.
    ["Temporal.PlainDate 2024-06-15[u-ca=hebrew]", () => Temporal.PlainDate.from("2024-06-15[u-ca=hebrew]")],
    [
      "Temporal.PlainDateTime 2024-06-15T12:34:56[u-ca=hebrew]",
      () => Temporal.PlainDateTime.from("2024-06-15T12:34:56[u-ca=hebrew]"),
    ],
    [
      "Temporal.ZonedDateTime 2024-06-15T10:34:56Z[Europe/Berlin][u-ca=hebrew]",
      () => Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[Europe/Berlin][u-ca=hebrew]"),
    ],
    ["Temporal.PlainYearMonth 2024-06-15[u-ca=hebrew]", () => new Temporal.PlainYearMonth(2024, 6, "hebrew", 15)],
    ["Temporal.PlainMonthDay 1972-06-15[u-ca=hebrew]", () => new Temporal.PlainMonthDay(6, 15, "hebrew", 1972)],

    // `toString()` leaves out the reference day or year of these two.
    ["Temporal.PlainYearMonth 2024-06-15[u-ca=iso8601]", () => new Temporal.PlainYearMonth(2024, 6, "iso8601", 15)],
    ["Temporal.PlainMonthDay 2000-06-15[u-ca=iso8601]", () => new Temporal.PlainMonthDay(6, 15, "iso8601", 2000)],

    // `toString()` adds the milliseconds, microseconds and nanoseconds to the seconds. A field of 1000 or more
    // is one that the seconds could hold, so the text then names the three fields.
    ["Temporal.Duration PT1.5S", () => Temporal.Duration.from({ seconds: 1, milliseconds: 500 })],
    ["Temporal.Duration PT1.5S (milliseconds: 1500)", () => Temporal.Duration.from({ milliseconds: 1500 })],
    ["Temporal.Duration PT1.5S (microseconds: 1500000)", () => Temporal.Duration.from({ microseconds: 1500000 })],
    [
      "Temporal.Duration PT1.5S (milliseconds: 1499, microseconds: 999, nanoseconds: 1000)",
      () => Temporal.Duration.from({ milliseconds: 1499, microseconds: 999, nanoseconds: 1000 }),
    ],
    ["Temporal.Duration -PT1.5S (nanoseconds: -1500000000)", () => Temporal.Duration.from({ nanoseconds: -1.5e9 })],
    ["Temporal.Duration PT0.999S", () => Temporal.Duration.from({ milliseconds: 999 })],
    ["Temporal.Duration PT1S", () => Temporal.Duration.from({ seconds: 1 })],
    ["Temporal.Duration PT1S (milliseconds: 1000)", () => Temporal.Duration.from({ milliseconds: 1000 })],
    ["Temporal.Duration -PT0.999S", () => Temporal.Duration.from({ milliseconds: -999 })],
    ["Temporal.Duration -PT1S (milliseconds: -1000)", () => Temporal.Duration.from({ milliseconds: -1000 })],
    ["Temporal.Duration PT0.000999S", () => Temporal.Duration.from({ microseconds: 999 })],
    ["Temporal.Duration PT0.001S", () => Temporal.Duration.from({ milliseconds: 1 })],
    ["Temporal.Duration PT0.001S (microseconds: 1000)", () => Temporal.Duration.from({ microseconds: 1000 })],
    ["Temporal.Duration PT0.000000999S", () => Temporal.Duration.from({ nanoseconds: 999 })],
    ["Temporal.Duration PT0.000001S", () => Temporal.Duration.from({ microseconds: 1 })],
    ["Temporal.Duration PT0.000001S (nanoseconds: 1000)", () => Temporal.Duration.from({ nanoseconds: 1000 })],
  ];

  it.each(values)("prints %s", (text, make) => {
    expect(sides(make(), null)).toEqual({ expected: "null", received: text });
    expect(sides(null, make())).toEqual({ expected: text, received: "null" });
  });

  // A value of each class and, for each slot that Bun.deepEquals reads, the same value with that slot one higher.
  function oneSlotApart() {
    const withEachOneHigher = (fields: number[]) => [
      fields,
      ...fields.map((_, changed) => fields.map((field, index) => field + Number(index === changed))),
    ];
    const [date, time, instant] = [[2024, 6, 15], [12, 34, 56, 789, 12, 345], 1_718_454_896_789_012_345n];
    return [
      ...[0n, 1n].map(more => new Temporal.Instant(instant + more)),
      ...withEachOneHigher(date).map(([year, month, day]) => new Temporal.PlainDate(year, month, day)),
      new Temporal.PlainDate(2024, 6, 15, "hebrew"),
      ...withEachOneHigher([...date, ...time]).map(
        ([year, month, day, ...rest]) => new Temporal.PlainDateTime(year, month, day, ...rest),
      ),
      new Temporal.PlainDateTime(2024, 6, 15, 12, 34, 56, 789, 12, 345, "hebrew"),
      ...withEachOneHigher(time).map(fields => new Temporal.PlainTime(...fields)),
      ...[0n, 1n].map(more => new Temporal.ZonedDateTime(instant + more, "Europe/Berlin")),
      new Temporal.ZonedDateTime(instant, "Europe/Paris"),
      new Temporal.ZonedDateTime(instant, "Europe/Berlin", "hebrew"),
      ...withEachOneHigher([2024, 6, 1]).map(
        ([year, month, day]) => new Temporal.PlainYearMonth(year, month, "iso8601", day),
      ),
      new Temporal.PlainYearMonth(2024, 6, "hebrew", 1),
      ...withEachOneHigher([6, 15, 1972]).map(
        ([month, day, year]) => new Temporal.PlainMonthDay(month, day, "iso8601", year),
      ),
      new Temporal.PlainMonthDay(6, 15, "hebrew", 1972),
      ...withEachOneHigher([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]).map(fields => new Temporal.Duration(...fields)),
    ];
  }

  it("prints two values as one text only when Bun.deepEquals calls them equal", () => {
    const apart = oneSlotApart();
    expect(new Set(apart.map(printed)).size).toEqual(apart.length);
    expect(apart.length).toBe(50);

    const made = [...values.flatMap(([, make]) => [make(), make()]), ...apart];
    const texts = made.map(printed);
    const wrong = made.flatMap((a, i) =>
      made.slice(0, i).flatMap((b, j) => {
        const [areEqual, haveOneText] = [Bun.deepEquals(a, b), texts[i] === texts[j]];
        return areEqual === haveOneText ? [] : [{ areEqual, texts: [texts[j], texts[i]] }];
      }),
    );
    expect(wrong).toEqual([]);
  });

  it("prints a text that `from()` reads back, but for the fields of a Duration that the seconds could hold", () => {
    const readBack = (value: { constructor: Function }) => {
      const [name, ...text] = printed(value).split(" ");
      expect(name).toBe("Temporal." + value.constructor.name);
      return (value.constructor as unknown as { from(text: string): unknown }).from(text.join(" "));
    };
    const calendars = Intl.supportedValuesOf("calendar");
    expect(calendars).toContain("hebrew");
    for (const value of [
      new Temporal.Instant(-8_640_000_000_000_000_000_000n),
      new Temporal.Instant(8_640_000_000_000_000_000_000n),
      new Temporal.PlainTime(23, 59, 59, 999, 999, 999),
      new Temporal.Duration(0, 0, 0, 0, 0, 0, 59, 999, 999, 999),
      new Temporal.Duration(0, 0, 0, 0, 0, 0, -59, -999, -999, -999),
      ...calendars.flatMap(calendar => [
        new Temporal.PlainDate(2024, 6, 15, calendar),
        new Temporal.PlainDateTime(2024, 6, 15, 12, 34, 56, 789, 12, 345, calendar),
        new Temporal.ZonedDateTime(1_718_454_896_789_012_345n, "Asia/Kolkata", calendar),
      ]),
    ]) {
      expect(readBack(value)).toEqual(value);
    }

    for (const [unit, inSeconds] of [
      ["milliseconds", 1e3],
      ["microseconds", 1e6],
      ["nanoseconds", 1e9],
    ] as const) {
      for (const amount of [1000, 1001]) {
        const unbalanced = Temporal.Duration.from({ [unit]: amount });
        const [iso, fields] = printed(unbalanced).slice("Temporal.Duration ".length).split(" (");
        expect(fields).toBe(`${unit}: ${amount})`);
        // The ISO text alone is another Duration of the same length.
        const balanced = Temporal.Duration.from(iso);
        expect(balanced.total("seconds")).toBe(amount / inSeconds);
        expect(balanced).not.toEqual(unbalanced);
      }
    }
  });

  it("prints a value and the string of it as two texts", () => {
    expect(sides(Temporal.PlainDate.from("2024-06-15"), "2024-06-15")).toEqual({
      expected: '"2024-06-15"',
      received: "Temporal.PlainDate 2024-06-15",
    });
  });

  it("runs no toJSON or toString of the value", () => {
    const prototypes: { toJSON(): string; toString(): string }[] = [
      Temporal.Instant.prototype,
      Temporal.PlainDateTime.prototype,
      Temporal.PlainDate.prototype,
      Temporal.PlainTime.prototype,
      Temporal.ZonedDateTime.prototype,
      Temporal.PlainYearMonth.prototype,
      Temporal.PlainMonthDay.prototype,
      Temporal.Duration.prototype,
    ];
    const spies = prototypes.flatMap(prototype => [spyOn(prototype, "toJSON"), spyOn(prototype, "toString")]);
    const onePerClass = [...new Map(values.map(row => [row[0].split(" ")[0], row])).values()];
    try {
      expect(onePerClass.map(([, make]) => printed(make()))).toEqual(onePerClass.map(([text]) => text));
      expect(spies.map(spy => spy.mock.calls.length)).toEqual(Array(16).fill(0));
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const throws = () => {
      throw new Error("called");
    };
    const withOwn = Object.assign(Temporal.PlainDate.from("2024-06-15"), { toJSON: throws, toString: throws });
    expect(printed(withOwn)).toBe("Temporal.PlainDate 2024-06-15");
  });

  it("leaves out what Bun.deepEquals does not compare", () => {
    class Later extends Temporal.PlainDate {
      unit = "day";
    }
    const date = () => Temporal.PlainDate.from("2024-06-15");
    for (const same of [
      new Later(2024, 6, 15),
      Object.assign(date(), { extra: 1 }),
      Object.setPrototypeOf(date(), null),
    ]) {
      expect(same).toEqual(date());
      expect(printed(same)).toBe("Temporal.PlainDate 2024-06-15");
    }
  });

  it("prints the values inside other values", () => {
    let message = "passed";
    try {
      expect({ at: [Temporal.Instant.from("1970-01-01T00:00:00Z")] }).toEqual({
        at: [Temporal.Instant.from("1999-12-31T00:00:00Z")],
      });
    } catch (error) {
      message = Bun.stripANSI((error as Error).message);
    }
    expect(message).toContain("-     Temporal.Instant 1999-12-31T00:00:00Z,\n");
    expect(message).toContain("+     Temporal.Instant 1970-01-01T00:00:00Z,\n");
  });

  // Only the message changes. What a snapshot stores for the value is a separate choice.
  it("leaves the text of a snapshot as it is", () => {
    expect(Temporal.PlainDate.from("2024-06-15")).toMatchInlineSnapshot(`PlainDate {}`);
    expect({ at: Temporal.Instant.from("1970-01-01T00:00:00Z") }).toMatchInlineSnapshot(`
      {
        "at": Instant {},
      }
    `);
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
