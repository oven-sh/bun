/**
 * fs._toUnixTimestamp(time) returned a Date unchanged, and the current time for
 * a Date before 1970. It also returned null, booleans, arrays and boxed
 * primitives unchanged. Bun tested the argument with the global isFinite(),
 * which converts its argument to a number first. Node uses NumberIsFinite(),
 * which does not:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L779-L796
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L3361-L3362 (the export)
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot import
 * from "harness" for the same reason.
 */
import assert from "node:assert";
import fs from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const toUnixTimestamp: (time: unknown) => number = (fs as any)._toUnixTimestamp;

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

  test("returns the seconds of a Date", () => {
    const dates = [
      new Date(5000),
      new Date(0),
      new Date(1500),
      new Date("2026-01-01T00:00:00Z"),
      new Date(-5000),
      new Date(NaN),
      vm.runInNewContext("new Date(5000)"),
    ];
    assert.deepStrictEqual(
      dates.map(date => toUnixTimestamp(date)),
      [5, 0, 1.5, 1767225600, -5, NaN, 5],
    );
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
      Object.create(Date.prototype),
      new Proxy(new Date(5000), {}),
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
});
