import vm from "node:vm";

describe.each([true, false])("Bun.deepEquals(a, b, strict: %p)", strict => {
  const deepEquals = (a: unknown, b: unknown) => Bun.deepEquals(a, b, strict);
  it.each([
    [1, 1],
    [true, true],
    [undefined, undefined],
    [null, null],
    ["foo", "foo"],
    [{}, {}],
    [{ a: 1 }, { a: 1 }],
    [new Map(), new Map()],
    [new Set(), new Set()],
    [Symbol.for("foo"), Symbol.for("foo")],
    [NaN, NaN],
  ])("Bun.deepEquals(%p, %p) === true, regardless of strict modee", (a, b) => {
    expect(Bun.deepEquals(a, b, true)).toBe(true);
    expect(Bun.deepEquals(a, b, false)).toBe(true);
  });

  it.each([
    [0, 1],
    [-0, +0], //
    [{ a: 1 }, { a: 2 }],
    ["foo", "bar"],
  ])("Bun.deepEquals(%p, %p) !== true, regardless of strict modee", (a, b) => {
    expect(Bun.deepEquals(a, b, true)).toBe(false);
    expect(Bun.deepEquals(a, b, false)).toBe(false);
  });

  // https://github.com/nodejs/node/issues/10258
  it("fake dates are not equal", () => {
    function FakeDate() {}
    FakeDate.prototype = Date.prototype;
    const a = new Date("2016");
    const b = new FakeDate();
    expect(deepEquals(a, b)).toBe(false);
    expect(deepEquals(b, a)).toBe(false);
  });

  it("fake maps are not equal", () => {
    function FakeMap() {}
    FakeMap.prototype = Map.prototype;
    const a = new Map();
    const b = new FakeMap();
    expect(deepEquals(a, b)).toBe(false);
    expect(deepEquals(b, a)).toBe(false);
  });

  // we may change this in the future
  it("functions that are not reference-equal are never equal", () => {
    function foo() {}
    function bar() {}
    function baz(a) {}
    expect(deepEquals(foo, foo)).toBe(true);
    expect(deepEquals(foo, bar)).toBe(false);
    expect(deepEquals(foo, baz)).toBe(false);
  });

  describe("global object", () => {
    let contexts: [vm.Context, vm.Context];

    beforeEach(() => {
      contexts = [vm.createContext(), vm.createContext()];
    });
    afterEach(() => {});

    // TODO: re-enable when https://github.com/oven-sh/bun/issues/17080 is resolved
    it.skip("main global object is not equal to vm global objects", () => {
      const [ctx] = contexts;
      expect(deepEquals(global, ctx)).toBe(false);

      ctx.mainGlobal = global;
      const areEqual = vm.runInContext("Bun.deepEquals(globalThis, mainGlobal)", ctx);
      expect(areEqual).toBe(false);
    });
  });
});

// The cases documented at https://bun.sh/docs/api/utils#bun-deepequals as the
// differences between the default and strict modes.
describe("Bun.deepEquals strict mode", () => {
  it("ignores an extra undefined property only when not strict", () => {
    const a = { entries: [1, 2] };
    const b = { entries: [1, 2], extra: undefined };
    expect(Bun.deepEquals(a, b)).toBe(true);
    expect(Bun.deepEquals(a, b, true)).toBe(false);
  });

  it("distinguishes a missing property from an undefined one", () => {
    expect(Bun.deepEquals({}, { a: undefined })).toBe(true);
    expect(Bun.deepEquals({}, { a: undefined }, true)).toBe(false);
  });

  it("distinguishes a missing array element from an undefined one", () => {
    expect(Bun.deepEquals(["asdf"], ["asdf", undefined])).toBe(true);
    expect(Bun.deepEquals(["asdf"], ["asdf", undefined], true)).toBe(false);
  });

  it("distinguishes a hole from an undefined element", () => {
    expect(Bun.deepEquals([, 1], [undefined, 1])).toBe(true);
    expect(Bun.deepEquals([, 1], [undefined, 1], true)).toBe(false);
  });

  it("distinguishes a class instance from an object literal", () => {
    class Foo {
      a = 1;
    }
    expect(Bun.deepEquals(new Foo(), { a: 1 })).toBe(true);
    expect(Bun.deepEquals(new Foo(), { a: 1 }, true)).toBe(false);
  });

  it("is symmetric", () => {
    const a = { entries: [1, 2] };
    const b = { entries: [1, 2], extra: undefined };
    expect(Bun.deepEquals(b, a)).toBe(true);
    expect(Bun.deepEquals(b, a, true)).toBe(false);
  });

  it("recurses into nested values", () => {
    expect(Bun.deepEquals({ a: { b: 1 } }, { a: { b: 1, c: undefined } })).toBe(true);
    expect(Bun.deepEquals({ a: { b: 1 } }, { a: { b: 1, c: undefined } }, true)).toBe(false);
  });

  // Matches Node's util.isDeepStrictEqual, which rejects a null prototype
  // against Object.prototype.
  it.failing("distinguishes a null-prototype object from an object literal", () => {
    expect(Bun.deepEquals(Object.create(null), {}, true)).toBe(false);
  });
});

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
});
