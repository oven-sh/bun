import { test, expect } from "bun:test";
const { isLoneShortOption } = require("../../../../../src/js/internal/util/parse_args/utils").default;

test("isLoneShortOption: when passed short option then returns true", () => {
  expect(isLoneShortOption("-s")).toBeTrue();
});

test("isLoneShortOption: when passed short option group (or might be short and value) then returns false", () => {
  expect(isLoneShortOption("-abc")).toBeFalse();
});

test("isLoneShortOption: when passed long option then returns false", () => {
  expect(isLoneShortOption("--foo")).toBeFalse();
});

test("isLoneShortOption: when passed long option with value then returns false", () => {
  expect(isLoneShortOption("--foo=bar")).toBeFalse();
});

test("isLoneShortOption: when passed empty string then returns false", () => {
  expect(isLoneShortOption("")).toBeFalse();
});

test("isLoneShortOption: when passed plain text then returns false", () => {
  expect(isLoneShortOption("foo")).toBeFalse();
});

test("isLoneShortOption: when passed single dash then returns false", () => {
  expect(isLoneShortOption("-")).toBeFalse();
});

test("isLoneShortOption: when passed double dash then returns false", () => {
  expect(isLoneShortOption("--")).toBeFalse();
});
