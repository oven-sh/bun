import { expect, test } from "bun:test";
import { checkPlacesHoldingWhatIsThrown } from "../../../src/codegen/builtins/check.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type {
  ModelCallback,
  ModelHandlerCall,
  ModelOverload,
  ModelPlace,
  ModelPropertyAction,
  ModelType,
} from "../../../src/codegen/builtins/model.ts";

const anything = { isAnything: true } as ModelType;
const errors = { isAnything: false } as ModelType;
const thrown = (type = anything): ModelPlace => ({ place: "NewValue", type, holdsWhatIsThrown: true });
const made: ModelPlace = { place: "NewValue", type: errors, holdsWhatIsThrown: false };
const none: ModelPlace = { place: "None" };
const nativeMemory: ModelPlace = { place: "NativeMemory" };

const callback = (columns: Partial<ModelCallback>) =>
  ({
    newTarget: none,
    thisValue: none,
    arguments: [],
    spreadArguments: none,
    resultTo: none,
    ...columns,
  }) as ModelCallback;
const handlerCall = (columns: Partial<ModelHandlerCall>) =>
  ({ callee: nativeMemory, thisValue: none, arguments: [], ...columns }) as ModelHandlerCall;

function problemsOf(flow: Partial<ModelOverload["flow"]>): readonly string[] {
  const overload = {
    indexInBuiltin: 0,
    builtin: { text: "listen" },
    source: { file: "table.ts", line: 7 },
    flow: { transfers: [], callbacks: [], propertyActions: [], handlerCalls: [], ...flow },
  } as unknown as ModelOverload;
  const problems = new Problems();
  checkPlacesHoldingWhatIsThrown(overload, problems);
  return problems.lines;
}

test("the word stands among the arguments of a callback and of a handler", () => {
  expect(problemsOf({ callbacks: [callback({ arguments: [made, thrown()] })] })).toEqual([]);
  expect(problemsOf({ handlerCalls: [handlerCall({ thisValue: made, arguments: [thrown(), made] })] })).toEqual([]);
});

test("no other place can say it", () => {
  const refusal =
    "table.ts:7: overload 0 of listen: what is thrown is handed over as an argument of a callback or of a handler, and a record says it of another place";
  expect(problemsOf({ transfers: [{ from: thrown(), to: { place: "Result" } }] })).toEqual([refusal]);
  expect(problemsOf({ propertyActions: [{ action: "StoresByKey", value: thrown() } as ModelPropertyAction] })).toEqual([
    refusal,
  ]);
  for (const column of ["newTarget", "thisValue", "spreadArguments"] as const)
    expect(problemsOf({ callbacks: [callback({ [column]: thrown() })] })).toEqual([refusal]);
  expect(problemsOf({ handlerCalls: [handlerCall({ thisValue: thrown(), arguments: [thrown()] })] })).toEqual([
    refusal,
  ]);
});

test("such a place says nothing else of the value", () => {
  const refusal =
    "table.ts:7: overload 0 of listen: a place that holds what is thrown says nothing else of the value, and this one has a type";
  expect(problemsOf({ callbacks: [callback({ arguments: [thrown(errors)] })] })).toEqual([refusal]);
  expect(problemsOf({ handlerCalls: [handlerCall({ arguments: [thrown(errors)] })] })).toEqual([refusal]);
});
