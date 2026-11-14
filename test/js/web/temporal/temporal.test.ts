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

  // A total, and a nanoseconds or microseconds field, is the Number nearest to the exact count.
  // On Windows the C++ standard library has no 128-bit integer, so JSC holds the count in two
  // 64-bit halves. WTF::Int128Impl converts each half and adds the results, which rounds a count
  // of 2^64 or more up to three times.
  describe("a count of 2^64 nanoseconds or more is the nearest Number", () => {
    const nsPerSecond = 1_000_000_000n;
    const nsMaxInstant = 8_640_000_000_000_000_000_000n;
    const epoch = Temporal.Instant.fromEpochNanoseconds(0n);
    const durationOf = (ns: bigint) =>
      Temporal.Duration.from({ seconds: Number(ns / nsPerSecond), nanoseconds: Number(ns % nsPerSecond) });

    // Each way to get the count `ns` back as a Number, with its name.
    function* counts(ns: bigint): Generator<[string, number]> {
      const duration = durationOf(ns);
      yield ["total", duration.total("nanoseconds")];
      yield ["-total", -duration.negated().total("nanoseconds")];
      yield ["round", duration.round({ largestUnit: "nanoseconds" }).nanoseconds];
      yield ["-round", -duration.negated().round({ largestUnit: "nanoseconds" }).nanoseconds];
      // Two nanosecond fields that are exact as Numbers, and whose sum is ns.
      const low = ns % 2n ** 30n;
      const high = Temporal.Duration.from({ nanoseconds: Number(ns - low) });
      yield ["add", high.add({ nanoseconds: Number(low) }).nanoseconds];
      yield ["-subtract", -high.negated().subtract({ nanoseconds: Number(low) }).nanoseconds];
      if (ns > nsMaxInstant) return;
      const instant = Temporal.Instant.fromEpochNanoseconds(ns);
      yield ["Instant.until", epoch.until(instant, { largestUnit: "nanoseconds" }).nanoseconds];
      yield ["-Instant.since", -epoch.since(instant, { largestUnit: "nanoseconds" }).nanoseconds];
      const zoned = instant.toZonedDateTimeISO("UTC");
      yield [
        "ZonedDateTime.since",
        zoned.since(epoch.toZonedDateTimeISO("UTC"), { largestUnit: "nanoseconds" }).nanoseconds,
      ];
      yield [
        "PlainDateTime.until",
        Temporal.PlainDateTime.from("1970-01-01").until(zoned.toPlainDateTime(), { largestUnit: "nanoseconds" })
          .nanoseconds,
      ];
      // The same digits as microseconds.
      yield ["microseconds", durationOf(ns * 1000n + 999n).round({ largestUnit: "microseconds" }).microseconds];
    }

    test("next to a tie", () => {
      // From 2^64 to 2^65 a Number is a multiple of 4096, so an odd multiple of 2048 is a tie.
      const base = 2n ** 64n + 2n ** 63n;
      expect(base).toBe(27670116110564327424n);
      for (const [offset, nearest] of [
        [2047n, 27670116110564327424], // below the tie: down
        [2048n, 27670116110564327424], // the tie: to the even neighbour, down
        [2049n, 27670116110564331520], // above the tie: up
        [6143n, 27670116110564331520], // below the next tie: down
        [6144n, 27670116110564335616], // the tie: to the even neighbour, up
        [6145n, 27670116110564335616], // above the tie: up
      ] as const) {
        expect(Number(base + offset)).toBe(nearest);
        for (const [name, count] of counts(base + offset))
          expect([offset, name, count]).toEqual([offset, name, nearest]);
      }
    });

    // test262 built-ins/Temporal/Duration/prototype/round/precision-exact-in-balance-time-duration.js
    test("8692288669465520 seconds and 373761 microseconds", () => {
      const duration = new Temporal.Duration(0, 0, 0, 0, 0, 0, 8692288669465520, 0, 373761);
      expect(duration.round({ largestUnit: "microseconds" }).microseconds).toBe(8692288669465520373761);
    });

    test("the largest nanoseconds field is valid", () => {
      // A Duration holds less than 2^53 seconds. A Number near that many nanoseconds is a multiple
      // of 2^30, so 2^29 below the limit is the tie between the largest valid field and the limit.
      const limit = 2n ** 53n * nsPerSecond;
      const largest = limit - 2n ** 29n - 1n;
      expect(Number(largest)).toBe(9007199254740990926258176);
      expect([...counts(largest)]).toEqual(
        ["total", "-total", "round", "-round", "add", "-subtract"].map(name => [name, 9007199254740990926258176]),
      );
      expect(() => durationOf(largest + 1n).round({ largestUnit: "nanoseconds" })).toThrow(RangeError);
    });

    test("a fixed sequence of 65 to 83-bit counts", () => {
      // xorshift64
      let state = 0x9e3779b97f4a7c15n;
      const random64 = () => {
        state ^= BigInt.asUintN(64, state << 13n);
        state ^= state >> 7n;
        state ^= BigInt.asUintN(64, state << 17n);
        return state;
      };
      const largest = 2n ** 53n * nsPerSecond - 2n ** 29n - 1n;
      const wrong: [bigint, string, number, number][] = [];
      for (let i = 0; i < 190; i++) {
        const bits = BigInt(64 + (i % 19));
        let ns = (1n << bits) | (((random64() << 64n) | random64()) & ((1n << bits) - 1n));
        if (ns > largest) ns = largest - (random64() >> 4n);
        for (const [name, count] of counts(ns)) if (count !== Number(ns)) wrong.push([ns, name, count, Number(ns)]);
      }
      expect(wrong).toEqual([]);
    });
  });
});
