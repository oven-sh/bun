import { test, expect } from "bun:test";
const { isShortOptionAndValue } = require("../../../../../src/js/internal/util/parse_args/utils").default;

test("isShortOptionAndValue: when passed lone short option then returns false", () => {
  expect(isShortOptionAndValue("-s", {})).toBeFalse();
});

test("isShortOptionAndValue: when passed group with leading zero-config boolean then returns false", () => {
  expect(isShortOptionAndValue("-ab", {})).toBeFalse();
});

test("isShortOptionAndValue: when passed group with leading configured implicit boolean then returns false", () => {
  expect(isShortOptionAndValue("-ab", { aaa: { short: "a" } })).toBeFalse();
});

test("isShortOptionAndValue: when passed group with leading configured explicit boolean then returns false", () => {
  expect(isShortOptionAndValue("-ab", { aaa: { short: "a", type: "boolean" } })).toBeFalse();
});

test("isShortOptionAndValue: when passed group with leading configured string then returns true", () => {
  expect(isShortOptionAndValue("-ab", { aaa: { short: "a", type: "string" } })).toBeTrue();
});

test("isShortOptionAndValue: when passed long option then returns false", () => {
  expect(isShortOptionAndValue("--foo", {})).toBeFalse();
});

test("isShortOptionAndValue: when passed long option with value then returns false", () => {
  expect(isShortOptionAndValue("--foo=bar", {})).toBeFalse();
});

test("isShortOptionAndValue: when passed empty string then returns false", () => {
  expect(isShortOptionAndValue("", {})).toBeFalse();
});

test("isShortOptionAndValue: when passed plain text then returns false", () => {
  expect(isShortOptionAndValue("foo", {})).toBeFalse();
});

test("isShortOptionAndValue: when passed single dash then returns false", () => {
  expect(isShortOptionAndValue("-", {})).toBeFalse();
});

test("isShortOptionAndValue: when passed double dash then returns false", () => {
  expect(isShortOptionAndValue("--", {})).toBeFalse();
});
