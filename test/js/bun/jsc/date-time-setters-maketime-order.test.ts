import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Date.prototype.set{Hours,Minutes,Seconds,Milliseconds} and their UTC forms build their result
// with MakeDate(Day(t), MakeTime(hour, min, sec, ms)): the day of the Date is kept, and each time
// field is the argument or, when it was not given, the field of the Date. MakeTime adds in
// doubles in one order, ((hour * msPerHour + min * msPerMinute) + sec * msPerSecond) + ms
// (https://tc39.es/ecma262/#sec-maketime), and the order shows once a partial sum is beyond 2^53.
// JSC used to add the arguments to the milliseconds of the Date first, and the fields the Date
// kept afterwards. Node gives the values below.

const msPerDay = 86400000;
const msPerHour = 3600000;
const msPerMinute = 60000;
const msPerSecond = 1000;

// The four setters: the name, and which of hour, minute, second, millisecond the first argument is.
const setters = [
  ["Hours", 0],
  ["Minutes", 1],
  ["Seconds", 2],
  ["Milliseconds", 3],
] as const;

// MakeDate(Day(t), MakeTime(...)) and TimeClip as the specification writes them: each * and + is
// one double operation.
function expectedUTC(timeValue: number, firstField: number, args: number[]) {
  const day = Math.floor(timeValue / msPerDay);
  const timeInDay = timeValue - day * msPerDay;
  const fields = [
    Math.floor(timeInDay / msPerHour),
    Math.floor(timeInDay / msPerMinute) % 60,
    Math.floor(timeInDay / msPerSecond) % 60,
    timeInDay % 1000,
  ];
  for (let i = 0; i < args.length; i++) fields[firstField + i] = args[i];
  if (!fields.every(Number.isFinite)) return NaN;
  const [hour, min, sec, ms] = fields.map(Math.trunc);
  const time = hour * msPerHour + min * msPerMinute + sec * msPerSecond + ms;
  const tv = day * msPerDay + time;
  return Number.isFinite(tv) && Math.abs(tv) <= 8.64e15 ? Math.trunc(tv) + 0 : NaN;
}

// Runs set<name> and setUTC<name> on a Date nothing has read yet and on one a getter has broken
// down into fields. The local form must give what the Date constructor gives for the same fields.
// Each result that is not the expected one adds a line to `wrong`, up to ten lines: a debug build
// is too slow for an expect() per result, and an engine that is wrong is wrong thousands of times.
function checkSetter(wrong: string[], timeValue: number, name: string, firstField: number, args: number[]) {
  const label = `${name}(${args.join(", ")}) on ${timeValue}`;
  const check = (form: string, brokenDown: boolean, got: number, want: number) => {
    if (Object.is(got, want) || wrong.length >= 10) return;
    wrong.push(`${form}${label}${brokenDown ? ", after a getter" : ""}: expected ${want}, got ${got}`);
  };
  const wantUTC = expectedUTC(timeValue, firstField, args);
  const probe = new Date(timeValue);
  const fields = [probe.getHours(), probe.getMinutes(), probe.getSeconds(), probe.getMilliseconds()];
  for (let i = 0; i < args.length; i++) fields[firstField + i] = args[i];
  const [hour, min, sec, ms] = fields;
  const wantLocal = new Date(probe.getFullYear(), probe.getMonth(), probe.getDate(), hour, min, sec, ms).getTime();
  for (const brokenDown of [false, true]) {
    const utc = new Date(timeValue);
    if (brokenDown) utc.getUTCDay();
    check("setUTC", brokenDown, utc[`setUTC${name}`](...args), wantUTC);
    check("getTime() after setUTC", brokenDown, utc.getTime(), wantUTC);
    const local = new Date(timeValue);
    if (brokenDown) local.getDay();
    check("set", brokenDown, local[`set${name}`](...args), wantLocal);
    check("getTime() after set", brokenDown, local.getTime(), wantLocal);
  }
}

describe("Date time setters add in the order of MakeTime", () => {
  test("one argument worth just more than 2^53 ms", () => {
    // The fields the Date keeps bring MakeTime's sum back under 2^53, where it is exact.
    expect(new Date(1875619980085361).setUTCMinutes(-150119987617)).toBe(-7131579276994639);
    expect(new Date(2725612719655037).setUTCMinutes(-150119987734)).toBe(-6281586545584963);
    expect(new Date(6000780672132969).setUTCHours(-2501999793)).toBe(-3006418582667031);
    expect(new Date(4092517536431551).setUTCHours(-2501999793)).toBe(-4914681725568449);
    expect(new Date(8288993643969297).setUTCSeconds(-9007199277021)).toBe(-718205633060703);
    expect(new Date(4913242772966623).setUTCSeconds(-9007199315586)).toBe(-4093956542645377);
    expect(new Date(8.64e15 - 1).setUTCHours(-2501999793)).toBe(-367199337600001);

    const date = new Date(1875619980085361);
    date.setUTCMinutes(-150119987617);
    expect(date.toISOString()).toBe("-224021-04-02T04:23:25.361Z");
  });

  test("arguments that cancel", () => {
    // MakeTime rounds each partial sum to a double, so what the first additions lose stays lost.
    expect(new Date(60000).setUTCSeconds(2 ** 53, -(2 ** 53) * 1000)).toBe(60416);
    expect(Date.UTC(1970, 0, 1, 0, 1, 2 ** 53, -(2 ** 53) * 1000)).toBe(60416);
    expect(new Date(3600000).setUTCMinutes(2 ** 46, -(2 ** 46) * 60)).toBe(3599872);
    expect(new Date(1633790731877088).setUTCSeconds(-418978581251620, 415150737421630500)).toBe(-2194053098129472);
    expect(new Date(2096109278351068).setUTCSeconds(-1065194099809714, 1069059298030771700)).toBe(5961307499397632);
    expect(new Date(-8371246840953827).setUTCMinutes(-18917803988527, 290920603005747, 846386976741586400)).toBe(
      -6131906406286592,
    );
    expect(new Date(1329686253984).setUTCMinutes(-9007199254740992, 540435517599968260)).toBe(3563645193973720);
  });

  test("every setter gives what the specification's arithmetic and the Date constructor give", () => {
    const wrong: string[] = [];
    for (const timeValue of [1875619980085361, 6000780672132969, 8288993643969297, -1875619980085361, 123456789]) {
      const sign = timeValue > 0 ? -1 : 1;
      for (const extra of [0, 1, 2, 1000, 86399, 1234567]) {
        checkSetter(wrong, timeValue, "Hours", 0, [sign * (2501999793 + Math.trunc(extra / 3600))]);
        checkSetter(wrong, timeValue, "Minutes", 1, [sign * (150119987579 + Math.trunc(extra / 60))]);
        checkSetter(wrong, timeValue, "Seconds", 2, [sign * (9007199254741 + extra)]);
        checkSetter(wrong, timeValue, "Milliseconds", 3, [sign * (2 ** 53 + 2 * extra)]);
      }
    }

    let state = 0x9e3779b9;
    const random = () => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 4294967296;
    };
    const randomInteger = (low: number, high: number) => Math.floor(low + random() * (high - low + 1));
    const units = [msPerHour, msPerMinute, msPerSecond, 1];
    const maxima = [23, 59, 59, 999];
    for (let i = 0; i < 2000; i++) {
      const [name, firstField] = setters[i & 3];
      const count = randomInteger(1, 4 - firstField);
      // Years 100 to 275000: the Date constructor reads a year from 0 to 99 as 1900 to 1999.
      const timeValue = i & 4 ? randomInteger(-59e12, 8.6e15) : randomInteger(-59e12, 4e12);
      const kind = randomInteger(0, 3);
      const args: number[] = [];
      let worth = 0;
      for (let k = 0; k < count; k++) {
        const unit = units[firstField + k];
        let value: number;
        if (kind === 0) value = randomInteger(0, maxima[firstField + k]);
        else if (kind === 1) value = randomInteger(-100000, 100000);
        else if (k === count - 1) value = Math.trunc((-worth + (random() * 2 - 1) * 8e15) / unit);
        else value = Math.trunc(((random() * 2 - 1) * 2 ** randomInteger(50, 62)) / unit);
        args.push(value);
        worth += value * unit;
      }
      checkSetter(wrong, timeValue, name, firstField, args);
    }
    expect(wrong).toEqual([]);
  });

  test("ordinary arguments: before 1970, day boundaries and both ends of the range", () => {
    const timeValues = [
      0,
      1,
      -1,
      999,
      -999,
      86399999,
      -86399999,
      86400000,
      -86400000,
      -2208988800001,
      951782400000,
      1710064800000,
      1730624400000,
      4102444800000,
      8.64e15,
      8.64e15 - 1,
      8.64e15 - msPerDay - 1,
      -8.64e15 + 2 * msPerDay,
    ];
    const wrong: string[] = [];
    for (const timeValue of timeValues) {
      for (const [name, firstField] of setters) {
        for (const value of [0, 1, -1, 23, 24, 59, 60, 999, 1000, -1000, 86400, 100000000]) {
          checkSetter(wrong, timeValue, name, firstField, [value]);
          if (firstField < 3) checkSetter(wrong, timeValue, name, firstField, [value, value + 1]);
          if (firstField === 0) checkSetter(wrong, timeValue, name, firstField, [value, -value, value, -value]);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(new Date(8.64e15).setUTCMilliseconds(1)).toBeNaN();
    expect(new Date(-8.64e15).setUTCMilliseconds(-1)).toBeNaN();
    expect(new Date(0).setUTCHours(Infinity, -Infinity)).toBeNaN();
    expect(new Date(0).setUTCHours(1e308, -1e308)).toBeNaN();
    expect(new Date(0).setHours(1, NaN, 1, 1)).toBeNaN();
    expect(new Date(1700000000123).setUTCSeconds(1.9, -0.9)).toBe(1699999981000);
  });

  // The local forms convert to local time and back. These zones have daylight saving changes, an
  // offset that is not a whole hour, and, before their first rule, one that is not a whole minute.
  test.concurrent.each(["America/Los_Angeles", "Asia/Kolkata", "Australia/Lord_Howe", "Pacific/Apia"])(
    "local setters in %s",
    async zone => {
      const script = `
        const setters = [["Hours", 0], ["Minutes", 1], ["Seconds", 2], ["Milliseconds", 3]];
        let checked = 0;
        function check(timeValue, name, firstField, args) {
          const probe = new Date(timeValue);
          const fields = [probe.getHours(), probe.getMinutes(), probe.getSeconds(), probe.getMilliseconds()];
          for (let i = 0; i < args.length; i++) fields[firstField + i] = args[i];
          const want = new Date(probe.getFullYear(), probe.getMonth(), probe.getDate(), ...fields).getTime();
          for (const brokenDown of [false, true]) {
            const date = new Date(timeValue);
            if (brokenDown) date.getDay();
            const got = date["set" + name](...args);
            if (!Object.is(got, want) || !Object.is(date.getTime(), want))
              throw new Error("set" + name + "(" + args + ") on " + timeValue + ": expected " + want + ", got " + got);
            checked++;
          }
        }
        // Every hour across the daylight saving changes of 2024 in both hemispheres.
        for (const start of [Date.UTC(2024, 2, 9), Date.UTC(2024, 3, 5), Date.UTC(2024, 8, 27), Date.UTC(2024, 10, 2)]) {
          for (let hour = 0; hour < 60; hour++) {
            const timeValue = start + hour * 3600000 + 1805123;
            check(timeValue, "Hours", 0, [hour % 24]);
            check(timeValue, "Hours", 0, [2, 30]);
            check(timeValue, "Minutes", 1, [hour]);
            check(timeValue, "Seconds", 2, [hour, hour]);
            check(timeValue, "Milliseconds", 3, [hour]);
          }
        }
        // Local mean time in the 19th century and before, and one huge argument.
        for (const timeValue of [-2717640000000, -2717640000001, -5000000000000, -12219292800000, 1875619980085361, 6000780672132969]) {
          for (const [name, firstField] of setters) {
            check(timeValue, name, firstField, [7]);
            check(timeValue, name, firstField, [-7]);
          }
          check(timeValue, "Hours", 0, [-2501999793]);
          check(timeValue, "Minutes", 1, [-150119987617]);
          check(timeValue, "Seconds", 2, [-9007199277021]);
        }
        console.log(checked);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, TZ: zone },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "2532\n", stderr: "", exitCode: 0 });
    },
  );
});
