import { test, expect } from "bun:test";
const { isLoneLongOption } = require("../../../../../src/js/internal/util/parse_args/utils").default;

test("isLoneLongOption: when passed short option then returns false", () => {
  expect(isLoneLongOption("-s")).toBeFalse();
});

test("isLoneLongOption: when passed short option group then returns false", () => {
  expect(isLoneLongOption("-abc")).toBeFalse();
});

test("isLoneLongOption: when passed lone long option then returns true", () => {
  expect(isLoneLongOption("--foo")).toBeTrue();
});

test("isLoneLongOption: when passed single character long option then returns true", () => {
  expect(isLoneLongOption("--f")).toBeTrue();
});

test("isLoneLongOption: when passed long option and value then returns false", () => {
  expect(isLoneLongOption("--foo=bar")).toBeFalse();
});

test("isLoneLongOption: when passed empty string then returns false", () => {
  expect(isLoneLongOption("")).toBeFalse();
});

test("isLoneLongOption: when passed plain text then returns false", () => {
  expect(isLoneLongOption("foo")).toBeFalse();
});

test("isLoneLongOption: when passed single dash then returns false", () => {
  expect(isLoneLongOption("-")).toBeFalse();
});

test("isLoneLongOption: when passed double dash then returns false", () => {
  expect(isLoneLongOption("--")).toBeFalse();
});

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test("isLoneLongOption: when passed arg starting with triple dash then returns true", () => {
  expect(isLoneLongOption("---foo")).toBeTrue();
});

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test("isLoneLongOption: when passed '--=' then returns true", () => {
  expect(isLoneLongOption("--=")).toBeTrue();
});
