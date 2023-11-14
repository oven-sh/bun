import { test, expect } from "bun:test";
const { isShortOptionGroup } = require("../../../../../src/js/internal/util/parse_args/utils").default;

test("isShortOptionGroup: when passed lone short option then returns false", () => {
  expect(isShortOptionGroup("-s", {})).toBeFalse();
});

test("isShortOptionGroup: when passed group with leading zero-config boolean then returns true", () => {
  expect(isShortOptionGroup("-ab", {})).toBeTrue();
});

test("isShortOptionGroup: when passed group with leading configured implicit boolean then returns true", () => {
  expect(isShortOptionGroup("-ab", { aaa: { short: "a" } })).toBeTrue();
});

test("isShortOptionGroup: when passed group with leading configured explicit boolean then returns true", () => {
  expect(isShortOptionGroup("-ab", { aaa: { short: "a", type: "boolean" } })).toBeTrue();
});

test("isShortOptionGroup: when passed group with leading configured string then returns false", () => {
  expect(isShortOptionGroup("-ab", { aaa: { short: "a", type: "string" } })).toBeFalse();
});

test("isShortOptionGroup: when passed group with trailing configured string then returns true", () => {
  expect(isShortOptionGroup("-ab", { bbb: { short: "b", type: "string" } })).toBeTrue();
});

// This one is dubious, but leave it to caller to handle.
test("isShortOptionGroup: when passed group with middle configured string then returns true", () => {
  expect(isShortOptionGroup("-abc", { bbb: { short: "b", type: "string" } })).toBeTrue();
});

test("isShortOptionGroup: when passed long option then returns false", () => {
  expect(isShortOptionGroup("--foo", {})).toBeFalse();
});

test("isShortOptionGroup: when passed long option with value then returns false", () => {
  expect(isShortOptionGroup("--foo=bar", {})).toBeFalse();
});

test("isShortOptionGroup: when passed empty string then returns false", () => {
  expect(isShortOptionGroup("", {})).toBeFalse();
});

test("isShortOptionGroup: when passed plain text then returns false", () => {
  expect(isShortOptionGroup("foo", {})).toBeFalse();
});

test("isShortOptionGroup: when passed single dash then returns false", () => {
  expect(isShortOptionGroup("-", {})).toBeFalse();
});

test("isShortOptionGroup: when passed double dash then returns false", () => {
  expect(isShortOptionGroup("--", {})).toBeFalse();
});
