import { afterAll, describe, expect, test } from "bun:test";

// The local Date setters, the multi-argument Date constructor and Date.parse of
// a string without a UTC offset compute TimeClip(UTC(local time value)). For a
// Date within one UTC offset of either end of the time value range that local
// time value is itself outside the range, and UTC() has to use the zone's
// offset at that date for it (https://tc39.es/ecma262/#sec-utc-t: "The
// algorithm must not limit t to the time value range"). JSC used to remap such
// a local time to a year between 2008 and 2035 before it asked ICU for the
// offset, so the result was off by the difference between the two offsets, or
// NaN (oven-sh/WebKit#615).

const originalTZ = process.env.TZ;
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

const minTimeValue = -8.64e15; // -271821-04-20T00:00:00.000Z
const maxTimeValue = 8.64e15; // +275760-09-13T00:00:00.000Z
const msPerHour = 3600 * 1000;
const msPerDay = 24 * msPerHour;

const timeValuesNearTheLimits = [
  minTimeValue,
  minTimeValue + 1,
  minTimeValue + msPerHour,
  minTimeValue + msPerDay - 1,
  minTimeValue + msPerDay,
  maxTimeValue - msPerDay,
  maxTimeValue - msPerDay + 1,
  maxTimeValue - 5 * msPerHour,
  maxTimeValue - 1,
  maxTimeValue,
];

// Each zone with its getTimezoneOffset() at the epoch, to tell that the zone
// change took effect. A zone west of Greenwich at its first (local mean time)
// offset has the local time of the minimum time value below the range, a zone
// east of it today has the local time of the maximum above it. Asia/Manila
// (-15:56:08 until 1844, +8 today) has both.
const timeZones = {
  "America/New_York": 300,
  "America/Los_Angeles": 480,
  "America/St_Johns": 210,
  "Pacific/Honolulu": 600,
  "Europe/London": -60,
  "Europe/Paris": -60,
  "Asia/Kolkata": -330,
  "Asia/Tokyo": -540,
  "Australia/Lord_Howe": -600,
  "Pacific/Kiritimati": 640,
  "Pacific/Apia": 660,
  "Asia/Manila": -480,
  UTC: 0,
};

function setTimeZone(timeZone: keyof typeof timeZones) {
  process.env.TZ = timeZone;
  expect(new Date(0).getTimezoneOffset()).toBe(timeZones[timeZone]);
}

describe.each(Object.keys(timeZones) as (keyof typeof timeZones)[])("in %s", timeZone => {
  test("rebuilding a Date near the time value limits from its local fields is the identity", () => {
    setTimeZone(timeZone);
    const results: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const timeValue of timeValuesNearTheLimits) {
      const date = new Date(timeValue);
      const fields = [
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
        date.getMilliseconds(),
      ] as const;
      const check = (label: string, actual: number, want = timeValue) => {
        results[`${timeValue}: ${label}`] = actual;
        expected[`${timeValue}: ${label}`] = want;
      };
      check(`new Date(${fields.join(", ")})`, new Date(...fields).getTime());
      check(`setMilliseconds(${fields[6]})`, new Date(timeValue).setMilliseconds(fields[6]));
      check(`setSeconds(${fields[5]})`, new Date(timeValue).setSeconds(fields[5]));
      check(`setMinutes(${fields[4]})`, new Date(timeValue).setMinutes(fields[4]));
      check(`setHours(${fields[3]})`, new Date(timeValue).setHours(fields[3]));
      check(`setDate(${fields[2]})`, new Date(timeValue).setDate(fields[2]));
      check(`setMonth(${fields[1]})`, new Date(timeValue).setMonth(fields[1]));
      check(`setFullYear(${fields[0]})`, new Date(timeValue).setFullYear(fields[0]));
      check(`setFullYear(${fields.slice(0, 3).join(", ")})`, new Date(timeValue).setFullYear(...fields.slice(0, 3)));
      check(`setHours(${fields.slice(3).join(", ")})`, new Date(timeValue).setHours(...fields.slice(3)));

      // One millisecond further out is not a time value any more.
      if (timeValue === minTimeValue) {
        check(`setMilliseconds(${fields[6] - 1})`, new Date(timeValue).setMilliseconds(fields[6] - 1), NaN);
        check(`new Date(..., ${fields[6] - 1})`, new Date(...fields.slice(0, 6), fields[6] - 1).getTime(), NaN);
      }
      if (timeValue === maxTimeValue) {
        check(`setMilliseconds(${fields[6] + 1})`, new Date(timeValue).setMilliseconds(fields[6] + 1), NaN);
        check(`new Date(..., ${fields[6] + 1})`, new Date(...fields.slice(0, 6), fields[6] + 1).getTime(), NaN);
      }
    }
    expect(results).toEqual(expected);
  });

  test("a local time more than a day beyond either limit is an Invalid Date", () => {
    setTimeZone(timeZone);
    expect(new Date(275760, 8, 14, 0, 0, 0, 1).getTime()).toBeNaN();
    expect(new Date(-271821, 3, 18, 23, 59, 59, 999).getTime()).toBeNaN();
    expect(new Date(1970, 0, 1, 0, 0, 0, 1e300).getTime()).toBeNaN();
    expect(new Date(1970, 0, 1, 0, 0, 0, -1e300).getTime()).toBeNaN();
    expect(new Date(0).setMilliseconds(2 ** 70)).toBeNaN();
  });

  test("Date.parse with an explicit UTC offset only TimeClips the result", () => {
    setTimeZone(timeZone);
    expect(Date.parse("-271821-04-19T20:00:00-04:00")).toBe(minTimeValue);
    expect(Date.parse("+275760-09-13T05:00:00+05:00")).toBe(maxTimeValue);
    expect(Date.parse("+275760-09-13T05:00:00.001+05:00")).toBeNaN();
  });
});

// America/New_York is at its local mean time, -4:56:02, before 1883-11-18, so
// the minimum time value reads as -271821-04-19T19:03:58 local time there, and
// that local time is below the time value range.
test("America/New_York: local times around the minimum time value", () => {
  setTimeZone("America/New_York");
  expect(new Date(minTimeValue).getTimezoneOffset()).toBe(296);
  expect(new Date(-271821, 3, 19, 19, 3, 58).getTime()).toBe(minTimeValue);
  expect(new Date(-271821, 3, 19, 19, 3, 57, 999).getTime()).toBeNaN();
  expect(new Date(-271821, 3, 19, 20, 3, 58).getTime()).toBe(minTimeValue + msPerHour);
  expect(new Date(minTimeValue + msPerHour).setHours(19)).toBe(minTimeValue);
  expect(new Date(minTimeValue + msPerHour).setHours(19, 3, 57, 999)).toBeNaN();
  expect(Date.parse("-271821-04-19T19:03:58")).toBe(minTimeValue);
  expect(Date.parse("-271821-04-19T19:03:57.999")).toBeNaN();
});

// East of Greenwich the maximum time value has a local time past
// +275760-09-13T00:00:00.
test.each(["Asia/Tokyo", "Pacific/Apia", "Pacific/Kiritimati"] as const)(
  "%s: local times around the maximum time value",
  timeZone => {
    setTimeZone(timeZone);
    const offset = -new Date(maxTimeValue).getTimezoneOffset() * 60 * 1000;
    expect(offset).toBeGreaterThan(0);
    expect(new Date(275760, 8, 13, 0, 0, 0, offset).getTime()).toBe(maxTimeValue);
    expect(new Date(275760, 8, 13, 0, 0, 0, offset + 1).getTime()).toBeNaN();
    expect(new Date(275760, 8, 13, 0, 0, 0, offset - 1).getTime()).toBe(maxTimeValue - 1);
    expect(new Date(maxTimeValue - 5 * msPerHour).setHours(offset / msPerHour)).toBe(maxTimeValue);
    expect(new Date(maxTimeValue - 5 * msPerHour).setHours(offset / msPerHour, 0, 0, 1)).toBeNaN();
  },
);
