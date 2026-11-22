import { expect, test } from "bun:test";
import { mayRefuseValueBeforeConversion } from "../../../src/codegen/builtins/build-overloads.ts";
import type { ModelType } from "../../../src/codegen/builtins/model.ts";
import type { Conversion } from "../../../src/codegen/builtins/vocabulary.ts";

const converted = (...conversions: Conversion[]) => conversions.map(conversion => ({ conversion, admitted: null }));

test("an index in front of an operand whose conversion runs code", () => {
  expect(mayRefuseValueBeforeConversion(converted("None", "ToIndex", "ToNumber", "ToBoolean"))).toBe(true);
  expect(mayRefuseValueBeforeConversion(converted("ToIndex", "ToBigInt"))).toBe(true);
});

test("an index that no such operand follows", () => {
  expect(mayRefuseValueBeforeConversion(converted("None", "ToIndex"))).toBe(false);
  expect(mayRefuseValueBeforeConversion(converted("None", "ToIndex", "ToBoolean"))).toBe(false);
  expect(mayRefuseValueBeforeConversion(converted("ToNumber", "ToIndex"))).toBe(false);
});

test("conversions that take every value of their accepted type", () => {
  expect(mayRefuseValueBeforeConversion(converted("ToString", "ToIntegerOrInfinity", "ToNumber"))).toBe(false);
});

test("an operand of which only some accepted values are admitted", () => {
  const partlyAdmitted = { conversion: "None", admitted: {} as ModelType } as const;
  expect(mayRefuseValueBeforeConversion([partlyAdmitted, ...converted("ToString")])).toBe(true);
  expect(mayRefuseValueBeforeConversion([...converted("ToString"), partlyAdmitted])).toBe(false);
});
