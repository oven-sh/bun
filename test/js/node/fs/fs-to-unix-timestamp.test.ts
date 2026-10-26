/**
 * fs._toUnixTimestamp(time) returned a Date unchanged, and the current time for
 * a Date before 1970. It also returned null, booleans, arrays and boxed
 * primitives unchanged. Bun tested the argument with the global isFinite(),
 * which converts its argument to a number first. Node uses NumberIsFinite(),
 * which does not:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L779-L796
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L3361-L3362 (the export)
 *
 * Node's function also calls the DateNow and DatePrototypeGetTime primordials,
 * which Node takes before any user code runs. So its result does not depend on
 * what user code did to Date, before or after node:fs was loaded.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot import
 * from "harness" for the same reason.
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { describe, test } from "node:test";
import { promisify } from "node:util";

const toUnixTimestamp: (time: unknown) => number = (fs as any)._toUnixTimestamp;

function withReplaced<T>(object: any, key: string, replacement: unknown, run: () => T): T {
  const original = object[key];
  object[key] = replacement;
  try {
    return run();
  } finally {
    object[key] = original;
  }
}

// Runs with `-e` in a new process, where node:fs is not loaded yet: CHANGE, load node:fs with LOAD, call, restore, call.
const firstLoadScript = `
const RealDate = Date, now = Date.now, getTime = Date.prototype.getTime;
let reads = 0;
const changes = {
  'Date is deleted': [() => { delete globalThis.Date; }, () => { globalThis.Date = RealDate; }],
  'Date is a function with no now and no prototype': [
    () => { globalThis.Date = Object.assign(function () {}, { prototype: undefined }); },
    () => { globalThis.Date = RealDate; },
  ],
  'Date.now and getTime are replaced': [
    () => { Date.now = () => 0; Date.prototype.getTime = () => 42000; },
    () => { Date.now = now; Date.prototype.getTime = getTime; },
  ],
  'Date is a getter that counts its reads': [
    () => { Object.defineProperty(globalThis, 'Date', { configurable: true, get() { reads++; return RealDate; } }); },
    () => { Object.defineProperty(globalThis, 'Date', { configurable: true, writable: true, value: RealDate }); },
  ],
};
const [change, restore] = changes[CHANGE];
change();
Promise.resolve(LOAD).then(fs => {
  const answers = () => [fs._toUnixTimestamp(new RealDate(5000)), Math.abs(fs._toUnixTimestamp(-5) - now() / 1000) < 60];
  const whileChanged = answers();
  const readsOfDate = reads;
  restore();
  console.log(JSON.stringify({ whileChanged, afterRestore: answers(), readsOfDate }));
});
`.replace(/\s*\n\s*/g, " ");

describe("fs._toUnixTimestamp()", () => {
  test("returns a number and a numeric string as seconds", () => {
    const times = [1000, 1.5, "1000", "-1"];
    assert.deepStrictEqual(
      times.map(time => toUnixTimestamp(time)),
      [1000, 1.5, 1000, -1],
    );
  });

  test("returns the current time for a negative number", () => {
    const seconds = toUnixTimestamp(-5);
    assert.ok(Math.abs(seconds - Date.now() / 1000) < 60, `${seconds} is not the current time`);
  });

  test("returns the current time for a negative number when Date.now is replaced", () => {
    const seconds = withReplaced(
      Date,
      "now",
      () => 0,
      () => toUnixTimestamp(-5),
    );
    assert.ok(Math.abs(seconds - Date.now() / 1000) < 60, `${seconds} is not the current time`);
  });

  test("returns the seconds of a Date", () => {
    const dates = [new Date(5000), new Date(0), new Date(1500), new Date("2026-01-01T00:00:00Z"), new Date(-5000)];
    assert.deepStrictEqual(
      dates.map(date => toUnixTimestamp(date)),
      [5, 0, 1.5, 1767225600, -5],
    );
  });

  test("returns the seconds of a Date when getTime is overridden or replaced", () => {
    class OverriddenDate extends Date {
      getTime() {
        return 42_000;
      }
    }
    const withOwnGetTime = new Date(5000);
    withOwnGetTime.getTime = () => 42_000;
    const dates = [new OverriddenDate(5000), withOwnGetTime, new Date(5000)];

    const seconds = withReplaced(
      Date.prototype,
      "getTime",
      () => 42_000,
      () => dates.map(date => toUnixTimestamp(date)),
    );
    assert.deepStrictEqual(seconds, [5, 5, 5]);
  });

  test("throws ERR_INVALID_ARG_TYPE for a value that is not a number, a numeric string or a Date", () => {
    let valueOfCalls = 0;
    const values: unknown[] = [
      null,
      true,
      false,
      [],
      [7],
      new Number(12),
      new String("12"),
      12n,
      Symbol("time"),
      {
        valueOf() {
          valueOfCalls++;
          return 7;
        },
      },
    ];
    const outcomeOf = (value: unknown) => {
      try {
        return `returned type ${typeof toUnixTimestamp(value)}`;
      } catch (e: any) {
        return `threw ${e.name} ${e.code}`;
      }
    };
    assert.deepStrictEqual(
      values.map(outcomeOf),
      values.map(() => "threw TypeError ERR_INVALID_ARG_TYPE"),
    );
    assert.strictEqual(valueOfCalls, 0);
  });

  test("node:fs loads and gives the same answers when Date is changed before its first load", async () => {
    const cases = [
      ["Date is deleted", "import('node:fs').then(module => module.default)"],
      ["Date is a function with no now and no prototype", "require('node:fs')"],
      ["Date.now and getTime are replaced", "import('node:fs').then(module => module.default)"],
      ["Date is a getter that counts its reads", "require('node:fs')"],
    ];
    const results = await Promise.all(
      cases.map(async ([change, load]) => {
        const script = firstLoadScript.replace("CHANGE", `'${change}'`).replace("LOAD", load);
        const { stdout } = await promisify(execFile)(process.execPath, ["-e", script]);
        return [change, JSON.parse(stdout)];
      }),
    );
    assert.deepStrictEqual(
      results,
      cases.map(([change]) => [change, { whileChanged: [5, true], afterRestore: [5, true], readsOfDate: 0 }]),
    );
  });

  test("follows the clock that bun:test sets", { skip: !process.versions.bun }, async () => {
    // Not a module-scope import: the file also runs under Node.
    const { setSystemTime } = await import("bun:test");
    setSystemTime(new Date(4e12));
    try {
      assert.strictEqual(toUnixTimestamp(-5), 4e9);
    } finally {
      setSystemTime();
    }
  });
});
