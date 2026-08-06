// Tests adapted from https://github.com/nodejs/node/pull/63154
// (test/parallel/test-util-inspect-temporal.js)
import { describe, expect, test } from "bun:test";
import util from "util";

const colorRegex = new RegExp(`^\u001b\\[${util.inspect.colors[util.inspect.styles.date][0]}m`);

createSuite("Duration", [1, 2, 3, 4, 5, 6, 7, 8, 9], "P1Y2M3W4DT5H6M7.008009S");
createSuite("Instant", [112233445566778899n], "1973-07-22T23:57:25.566778899Z");
createSuite("PlainDate", [1901, 2, 3], "1901-02-03");
createSuite("PlainDateTime", [1901, 2, 3, 4, 5, 6, 7, 8, 9], "1901-02-03T04:05:06.007008009");
createSuite("PlainMonthDay", [1, 2], "01-02");
createSuite("PlainTime", [1, 2, 3, 4, 5, 6], "01:02:03.004005006");
createSuite("PlainYearMonth", [1901, 2], "1901-02");
createSuite("ZonedDateTime", [112233445566778899n, "UTC"], "1973-07-22T23:57:25.566778899+00:00[UTC]");

function createSuite(name, params, expected) {
  const constructor = Temporal[name];

  describe(`Temporal.${name}`, () => {
    test("basic instance", () => {
      expect(util.inspect(new constructor(...params))).toBe(`Temporal.${name} ${expected}`);
    });

    test("derived class instance", () => {
      class X extends constructor {}
      expect(util.inspect(new X(...params))).toBe(`X [Temporal.${name}] ${expected}`);
    });

    test("instance with additional properties", () => {
      expect(util.inspect(Object.assign(new constructor(...params), { foo: "bar" }), { breakLength: Infinity })).toBe(
        `Temporal.${name} ${expected} { foo: 'bar' }`,
      );
    });

    test("prototype object", () => {
      expect(util.inspect(constructor.prototype)).toBe(`Object [Temporal.${name}] {}`);
    });

    test("instance with null prototype", () => {
      expect(util.inspect(Object.setPrototypeOf(new constructor(...params), null))).toBe(
        `[Temporal.${name}: null prototype] ${expected}`,
      );
    });

    test("instance with colors: true", () => {
      expect(util.inspect(new constructor(...params), { colors: true })).toMatch(colorRegex);
    });
  });
}
