import { test, expect } from "bun:test";
import { parseArgs } from "node:util";
const { isOptionValue } = require("../../../../../src/js/internal/util/parse_args/utils").default;

// Options are greedy so simple behaviour, but run through the interesting possibilities.

test("isOptionValue: when passed plain text then returns true", () => {
  expect(isOptionValue("abc")).toBeTrue();
});

test("isOptionValue: when passed digits then returns true", () => {
  expect(isOptionValue(123)).toBeTrue();
});

test("isOptionValue: when passed empty string then returns true", () => {
  expect(isOptionValue("")).toBeTrue();
});

// Special case, used as stdin/stdout et al and not reason to reject
test("isOptionValue: when passed dash then returns true", () => {
  expect(isOptionValue("-")).toBeTrue();
});

test("isOptionValue: when passed -- then returns true", () => {
  expect(isOptionValue("--")).toBeTrue();
});

// Checking undefined so can pass element off end of array.
test("isOptionValue: when passed undefined then returns false", () => {
  expect(isOptionValue(undefined)).toBeFalse();
});

test("isOptionValue: when passed short option then returns true", () => {
  expect(isOptionValue("-a")).toBeTrue();
});

test("isOptionValue: when passed short option digit then returns true", () => {
  expect(isOptionValue("-1")).toBeTrue();
});

test("isOptionValue: when passed negative number then returns true", () => {
  expect(isOptionValue("-123")).toBeTrue();
});

test("isOptionValue: when passed short option group of short option with value then returns true", () => {
  expect(isOptionValue("-abd")).toBeTrue();
});

test("isOptionValue: when passed long option then returns true", () => {
  expect(isOptionValue("--foo")).toBeTrue();
});

test("isOptionValue: when passed long option with value then returns true", () => {
  expect(isOptionValue("--foo=bar")).toBeTrue();
});
