import { test, expect } from "bun:test";
const { isOptionLikeValue } = require("../../../../../src/js/internal/util/parse_args/utils").default;

// Basically rejecting values starting with a dash, but run through the interesting possibilities.

test("isOptionLikeValue: when passed plain text then returns false", () => {
  expect(isOptionLikeValue("abc")).toBeFalse();
});

test("isOptionLikeValue: when passed digits then returns false", () => {
  expect(isOptionLikeValue(123)).toBeFalse();
});

test("isOptionLikeValue: when passed empty string then returns false", () => {
  expect(isOptionLikeValue("")).toBeFalse();
});

// Special case, used as stdin/stdout et al and not reason to reject
test("isOptionLikeValue: when passed dash then returns false", () => {
  expect(isOptionLikeValue("-")).toBeFalse();
});

test("isOptionLikeValue: when passed -- then returns true", () => {
  // Not strictly option-like, but is supect
  expect(isOptionLikeValue("--")).toBeTrue();
});

// Supporting undefined so can pass element off end of array without checking
test("isOptionLikeValue: when passed undefined then returns false", () => {
  expect(isOptionLikeValue(undefined)).toBeFalse();
});

test("isOptionLikeValue: when passed short option then returns true", () => {
  expect(isOptionLikeValue("-a")).toBeTrue();
});

test("isOptionLikeValue: when passed short option digit then returns true", () => {
  expect(isOptionLikeValue("-1")).toBeTrue();
});

test("isOptionLikeValue: when passed negative number then returns true", () => {
  expect(isOptionLikeValue("-123")).toBeTrue();
});

test("isOptionLikeValue: when passed short option group of short option with value then returns true", () => {
  expect(isOptionLikeValue("-abd")).toBeTrue();
});

test("isOptionLikeValue: when passed long option then returns true", () => {
  expect(isOptionLikeValue("--foo")).toBeTrue();
});

test("isOptionLikeValue: when passed long option with value then returns true", () => {
  expect(isOptionLikeValue("--foo=bar")).toBeTrue();
});
