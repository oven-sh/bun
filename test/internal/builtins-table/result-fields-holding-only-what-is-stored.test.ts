import { expect, test } from "bun:test";
import { checkFieldsHoldingOnlyWhatIsStored } from "../../../src/codegen/builtins/check.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type {
  ModelOverload,
  ModelPlace,
  ModelPropertyAction,
  ModelTransfer,
} from "../../../src/codegen/builtins/model.ts";

const field = (index: number, holdsOnlyWhatIsStored: boolean): ModelPlace => ({
  place: "ResultField",
  index,
  holdsOnlyWhatIsStored,
});
const nativeMemory: ModelPlace = { place: "NativeMemory" };
const action = (kind: ModelPropertyAction["action"], value: ModelPlace) =>
  ({ action: kind, value }) as ModelPropertyAction;

function problemsOf(
  transfers: readonly ModelTransfer[],
  propertyActions: readonly ModelPropertyAction[] = [],
): readonly string[] {
  const overload = {
    indexInBuiltin: 0,
    builtin: { text: "describe" },
    source: { file: "table.ts", line: 7 },
    flow: { transfers, callbacks: [], propertyActions, handlerCalls: [] },
  } as unknown as ModelOverload;
  const problems = new Problems();
  checkFieldsHoldingOnlyWhatIsStored(overload, problems);
  return problems.lines;
}

test("the word stands where a record stores into the field", () => {
  expect(problemsOf([{ from: nativeMemory, to: field(1, true) }])).toEqual([]);
  expect(problemsOf([], [action("ReadsByKey", field(0, true)), action("ReadsGetter", field(1, true))])).toEqual([]);
  expect(problemsOf([{ from: nativeMemory, to: field(1, false) }])).toEqual([]);
});

test("a record that takes what the field holds cannot say it", () => {
  const refusal =
    "table.ts:7: overload 0 of describe: field 1 of the result is said to hold only what is stored there by a record that stores nothing into it";
  expect(problemsOf([{ from: field(1, true), to: nativeMemory }])).toEqual([refusal]);
  expect(problemsOf([], [action("StoresByKey", field(1, true))])).toEqual([refusal]);
});

test("every record that stores into the field says it, or none", () => {
  expect(problemsOf([{ from: nativeMemory, to: field(1, true) }], [action("ReadsByKey", field(1, false))])).toEqual([
    "table.ts:7: overload 0 of describe: one record says that field 1 of the result holds only what is stored there, and another that stores into it does not",
  ]);
  expect(problemsOf([{ from: nativeMemory, to: field(1, true) }], [action("ReadsByKey", field(2, false))])).toEqual([]);
});
