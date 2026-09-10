import { afterAll, describe, expect, test } from "bun:test";

// JSC keeps the local time offset of the current zone in a small interval
// cache (DateCache::DSTCache in vendor/WebKit/.../runtime/JSDateMath.cpp). To
// find the instant where the offset changes it bisects between two cached
// intervals at most 19 days apart. A zone can change its offset more than once
// within 19 days, and then a bisection probe can match neither interval. JSC
// filed such a probe under the later interval, so every instant from the probe
// to that interval got its offset (America/Cambridge_Bay, 2000-10-29 and
// 2000-11-05: an hour off for up to a week) or its DST flag (America/Asuncion,
// 2024-10-06 and 2024-10-15: "Paraguay Standard Time" for summer time), until
// the zone changed. Debug builds hit ASSERT(m_after->offset == offset).
// oven-sh/WebKit#618 makes such a probe an interval of its own.
//
// The expectations come from Intl.DateTimeFormat, which asks ICU directly and
// shares no state with Date, so they follow whatever tzdata this build has.

const originalTZ = process.env.TZ;
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

// Assigning process.env.TZ applies the zone to the running process and empties
// the offset cache, also when the value does not change.
function resetTimeZone(timeZone: string) {
  process.env.TZ = timeZone;
}

const msPerMinute = 60 * 1000;
const msPerHour = 60 * msPerMinute;
const msPerDay = 24 * msPerHour;
const step = 4 * msPerHour;

const iso = (time: number) => new Date(time).toISOString().replace(":00.000Z", "Z");

// Minutes east of UTC at `time` in `timeZone` according to Intl ("GMT-05:00" is -300, "GMT" is 0).
function makeOffsetOracle(timeZone: string) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "numeric" });
  return (time: number) => {
    const name = format.formatToParts(time).find(part => part.type === "timeZoneName")!.value;
    if (name === "GMT") return 0;
    const match = /^GMT([+-])(\d{1,2}):?(\d{2})?(?::(\d{2}))?$/.exec(name);
    if (!match) throw new Error(`${timeZone}: unexpected offset name ${name}`);
    return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0) + Number(match[4] ?? 0) / 60);
  };
}

// The zone's long name at `time` according to Intl, e.g. "Paraguay Summer Time".
// For a zone that kept one name over the years this is what
// Date.prototype.toString() puts in parentheses, and Standard or Summer in it
// is the cached DST flag.
function makeNameOracle(timeZone: string) {
  const format = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "long", hour: "numeric" });
  return (time: number) => format.formatToParts(time).find(part => part.type === "timeZoneName")!.value;
}

function nameInDateString(date: Date) {
  const match = /\(([^)]*)\)$/.exec(date.toString());
  if (!match) throw new Error(`no zone name in ${date.toString()}`);
  return match[1];
}

// A small deterministic shuffle, so that a sweep does not only walk forward (which the cache is best at).
function shuffled<T>(array: T[], seed: number) {
  const result = array.slice();
  let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; --i) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const primingDistances = {
  "a minute": msPerMinute,
  "6 days": 6 * msPerDay,
  "12 days": 12 * msPerDay,
  "17 days": 17 * msPerDay,
};

type Scenario = ReturnType<typeof makeScenario>;

function makeScenario(timeZone: string, firstTransition: string, lastTransition: string, checkNames: boolean) {
  const first = Date.parse(firstTransition);
  const last = Date.parse(lastTransition);
  const offsetOracle = makeOffsetOracle(timeZone);
  const nameOracle = checkNames ? makeNameOracle(timeZone) : null;

  // The instants to check: from two days before the first transition to 20 days past the last.
  const sweep: number[] = [];
  for (let time = first - 2 * msPerDay; time <= last + 20 * msPerDay; time += step) sweep.push(time);
  const offsetAt = new Map<number, number>();
  for (let time = sweep[0] - step; time <= sweep.at(-1)! + step; time += step) offsetAt.set(time, offsetOracle(time));
  const nameAt = nameOracle ? new Map(sweep.map(time => [time, nameOracle(time)])) : null;

  // The first instants to prime the cache with, from 19 days before the first
  // transition up to the last transition, every other day at another hour. The
  // second one comes one of the primingDistances later. So the 19 day probe
  // window past the first one holds both transitions, and the bisection towards
  // the second one comes at the three offsets from either side.
  const primingStarts: number[] = [];
  for (let time = first - 19 * msPerDay - msPerMinute; time <= last; time += 49 * msPerHour) primingStarts.push(time);

  return { timeZone, sweep, offsetAt, nameAt, offsetOracle, primingStarts };
}

// One Date for all the UTC-to-local checks: the cost of a zone change grows
// with the number of Dates in the heap.
const date = new Date();

// Compares every instant of `order` with the oracles and returns what differs.
function checkWindow(scenario: Scenario, order: number[]) {
  const { offsetAt, nameAt } = scenario;
  const mismatches: string[] = [];
  for (const time of order) {
    date.setTime(time);
    const expectedOffset = offsetAt.get(time)!;

    const actualOffset = -date.getTimezoneOffset();
    if (actualOffset !== expectedOffset)
      mismatches.push(`offset of ${iso(time)} is ${actualOffset}, expected ${expectedOffset}`);

    if (nameAt) {
      const actualName = nameInDateString(date);
      if (actualName !== nameAt.get(time))
        mismatches.push(`${iso(time)} is in "${actualName}", expected "${nameAt.get(time)}"`);
    }

    // The local time to UTC direction has a cache of its own with the same
    // logic. Where the offset is steady for four hours either side, the local
    // time of `time` exists exactly once, so a Date built from its fields has
    // to give `time` back.
    if (offsetAt.get(time - step) !== expectedOffset || offsetAt.get(time + step) !== expectedOffset) continue;
    date.setTime(time + expectedOffset * msPerMinute);
    const fromFields = new Date(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
    ).getTime();
    if (fromFields !== time)
      mismatches.push(`${date.toISOString().slice(0, 16)} local time is ${iso(fromFields)}, expected ${iso(time)}`);
  }
  return mismatches;
}

const scenarios = [
  // -05 DST (CDT) until 2000-10-29T07:00Z, then -05 (EST) until 2000-11-05T05:00Z, then -06 (CST).
  makeScenario("America/Cambridge_Bay", "2000-10-29T07:00Z", "2000-11-05T05:00Z", false),
  // -04 until 2024-10-06T04:00Z, then -03 DST until 2024-10-15T03:00Z, then -03 as the standard time (tzdata 2025a).
  // The offset does not tell the last two apart, the name in Date.prototype.toString() does.
  makeScenario("America/Asuncion", "2024-10-06T04:00Z", "2024-10-15T03:00Z", true),
  // +01 (CET) until 1944-04-03T01:00Z, then +02 DST (CEST) until 1944-04-12T22:00Z, then +03 (MSK).
  makeScenario("Europe/Simferopol", "1944-04-03T01:00Z", "1944-04-12T22:00Z", false),
  // +02 DST (CEST) until 1944-10-02T01:00Z, then +01 (CET) until 1944-10-12T23:00Z, then +03 (MSK).
  makeScenario("Europe/Riga", "1944-10-02T01:00Z", "1944-10-12T23:00Z", false),
  // -01 until 1976-04-14T01:00Z, then +00 until 1976-05-01T00:00Z, then +01 DST.
  makeScenario("Africa/El_Aaiun", "1976-04-14T01:00Z", "1976-05-01T00:00Z", false),
];

describe("local time offset cache, two offset changes less than 19 days apart", () => {
  // The two reports, spelled out.
  test("America/Cambridge_Bay: 2000-11-01 keeps its -05:00 offset after two lookups at the 2000-10-29 change", () => {
    resetTimeZone("America/Cambridge_Bay");
    new Date("2000-10-29T06:59Z").getTimezoneOffset();
    new Date("2000-10-29T07:00Z").getTimezoneOffset();
    expect(new Date("2000-11-01T12:00Z").getTimezoneOffset()).toBe(300);
  });

  test("America/Asuncion: 2024-10-14 keeps its zone name after two lookups at the 2024-10-06 change", () => {
    const time = Date.parse("2024-10-14T12:00Z");
    const expected = makeNameOracle("America/Asuncion")(time); // "Paraguay Summer Time" with current tzdata and CLDR
    resetTimeZone("America/Asuncion");
    new Date("2024-10-06T03:59Z").getTimezoneOffset();
    new Date("2024-10-06T04:00Z").getTimezoneOffset();
    expect(nameInDateString(new Date(time))).toBe(expected);
  });

  describe.each(scenarios.map(scenario => [scenario.timeZone, scenario] as const))("in %s", (timeZone, scenario) => {
    test("walking the window forward on a fresh cache", () => {
      resetTimeZone(timeZone);
      expect(checkWindow(scenario, scenario.sweep)).toEqual([]);
    });

    test("visiting the window in a shuffled order on a fresh cache", () => {
      resetTimeZone(timeZone);
      expect(checkWindow(scenario, shuffled(scenario.sweep, 1))).toEqual([]);
    });

    test.each(Object.entries(primingDistances))("visiting the window after two lookups %s apart", (_, distance) => {
      const failures: string[] = [];
      scenario.primingStarts.forEach((first, index) => {
        const second = first + distance;
        resetTimeZone(timeZone);
        const mismatches: string[] = [];
        for (const time of [first, second]) {
          date.setTime(time);
          const actualOffset = -date.getTimezoneOffset();
          const expectedOffset = scenario.offsetOracle(time);
          if (actualOffset !== expectedOffset)
            mismatches.push(`offset of ${iso(time)} is ${actualOffset}, expected ${expectedOffset}`);
        }
        mismatches.push(...checkWindow(scenario, shuffled(scenario.sweep, index + 2)));
        if (mismatches.length)
          failures.push(`after ${iso(first)} and ${iso(second)}: ${mismatches.length} wrong, first: ${mismatches[0]}`);
      });
      expect(failures).toEqual([]);
    });
  });
});
