import { test, expect } from "bun:test";
const { findLongOptionForShort } = require("../../../../../src/js/internal/util/parse_args/utils").default;

test("findLongOptionForShort: when passed empty options then returns short", () => {
  expect(findLongOptionForShort("a", {})).toEqual("a");
});

test("findLongOptionForShort: when passed short not present in options then returns short", () => {
  expect(findLongOptionForShort("a", { foo: { short: "f", type: "string" } })).toEqual("a");
});

test("findLongOptionForShort: when passed short present in options then returns long", () => {
  expect(findLongOptionForShort("a", { alpha: { short: "a" } })).toEqual("alpha");
});
