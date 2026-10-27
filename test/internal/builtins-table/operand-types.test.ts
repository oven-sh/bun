import { expect, test } from "bun:test";
import { checkOperandTypes } from "../../../src/codegen/builtins/check-operand-types.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type { ModelOperand, ModelOverload, ModelParameter, ModelType } from "../../../src/codegen/builtins/model.ts";

const typeOf = (columns: Partial<ModelType> = {}) =>
  ({ hasPlainData: false, parts: [], ...columns }) as unknown as ModelType;

const primitives = typeOf();
const plainData = typeOf({ hasPlainData: true });
const arrayOf = (held: ModelType) =>
  typeOf({ parts: [{ part: "Instance", contents: [{ type: held }] }] } as unknown as Partial<ModelType>);

const parameterOf = (operand: ModelOperand, types: Partial<ModelParameter>) =>
  ({ operand, accepted: primitives, converted: primitives, refused: primitives, ...types }) as ModelParameter;

const argument = (index: number, types: Partial<ModelParameter>) => parameterOf({ operand: "Argument", index }, types);

function problemsOf(columns: Partial<ModelOverload>): readonly string[] {
  const overload = {
    indexInBuiltin: 0,
    builtin: { text: "structuredClone" },
    source: { file: "globals.builtins.ts", line: 7 },
    receiver: null,
    parameters: [],
    result: { type: plainData },
    ...columns,
  } as unknown as ModelOverload;
  const problems = new Problems();
  checkOperandTypes({ overloads: [overload] }, problems);
  return problems.lines;
}

const problemAt = (operand: string) =>
  `globals.builtins.ts:7: overload 0 of structuredClone: b.plainData describes a result, and ${operand} is tested for it`;

test("a result may be plain data", () => {
  expect(problemsOf({ parameters: [argument(0, {}), argument(1, { accepted: arrayOf(primitives) })] })).toEqual([]);
});

test("no operand is tested for plain data", () => {
  expect(problemsOf({ parameters: [argument(0, { accepted: plainData })] })).toEqual([problemAt("argument 0")]);
  expect(problemsOf({ parameters: [argument(0, {}), argument(1, { converted: plainData })] })).toEqual([
    problemAt("argument 1"),
  ]);
  expect(problemsOf({ parameters: [argument(0, { refused: plainData })] })).toEqual([problemAt("argument 0")]);
  expect(problemsOf({ receiver: parameterOf({ operand: "Receiver" }, { accepted: plainData }) })).toEqual([
    problemAt("the receiver"),
  ]);
});

test("nor are the contents of an operand", () => {
  expect(problemsOf({ parameters: [argument(0, { accepted: arrayOf(arrayOf(plainData)) })] })).toEqual([
    problemAt("argument 0"),
  ]);
});
