import { test, expect } from "bun:test";
const { isLongOptionAndValue } = require("../../../../../src/js/internal/util/parse_args/utils").default;

test("isLongOptionAndValue: when passed short option then returns false", () => {
  expect(isLongOptionAndValue("-s")).toBeFalse();
});

test("isLongOptionAndValue: when passed short option group then returns false", () => {
  expect(isLongOptionAndValue("-abc")).toBeFalse();
});

test("isLongOptionAndValue: when passed lone long option then returns false", () => {
  expect(isLongOptionAndValue("--foo")).toBeFalse();
});

test("isLongOptionAndValue: when passed long option and value then returns true", () => {
  expect(isLongOptionAndValue("--foo=bar")).toBeTrue();
});

test("isLongOptionAndValue: when passed single character long option and value then returns true", () => {
  expect(isLongOptionAndValue("--f=bar")).toBeTrue();
});

test("isLongOptionAndValue: when passed empty string then returns false", () => {
  expect(isLongOptionAndValue("")).toBeFalse();
});

test("isLongOptionAndValue: when passed plain text then returns false", () => {
  expect(isLongOptionAndValue("foo")).toBeFalse();
});

test("isLongOptionAndValue: when passed single dash then returns false", () => {
  expect(isLongOptionAndValue("-")).toBeFalse();
});

test("isLongOptionAndValue: when passed double dash then returns false", () => {
  expect(isLongOptionAndValue("--")).toBeFalse();
});

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test("isLongOptionAndValue: when passed arg starting with triple dash and value then returns true", () => {
  expect(isLongOptionAndValue("---foo=bar")).toBeTrue();
});

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test("isLongOptionAndValue: when passed '--=' then returns false", () => {
  expect(isLongOptionAndValue("--=")).toBeFalse();
});
