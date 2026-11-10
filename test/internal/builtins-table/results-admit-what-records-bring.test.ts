import { expect, test } from "bun:test";
import { checkResultAdmitsWhatRecordsBring } from "../../../src/codegen/builtins/check.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type {
  ModelOverload,
  ModelPlace,
  ModelPropertyAction,
  ModelTransfer,
  ModelType,
} from "../../../src/codegen/builtins/model.ts";

const result: ModelPlace = { place: "Result" };
const nativeMemory: ModelPlace = { place: "NativeMemory" };
const readsChildren = { action: "ReadsByKey", value: result } as ModelPropertyAction;

const type = (parts: Partial<ModelType>) =>
  ({
    isAnything: false,
    hasAnyObject: false,
    hasAnyFunction: false,
    hasPlainData: false,
    primitives: ["Undefined", "Null"],
    parts: [],
    ...parts,
  }) as ModelType;

interface Row {
  returns: ModelType;
  mode?: ModelOverload["mode"];
  proof?: ModelOverload["proof"];
  transfers?: readonly ModelTransfer[];
  propertyActions?: readonly ModelPropertyAction[];
}

function problemsOf({ returns, mode = "Call", proof = "HandWritten", transfers = [], propertyActions = [] }: Row) {
  const overload = {
    indexInBuiltin: 0,
    builtin: { text: "%PrivateGlobals%.evaluateCommonJSModule" },
    source: { file: "table.ts", line: 7 },
    mode,
    proof,
    flags: [],
    result: { type: returns },
    flow: { transfers, callbacks: [], propertyActions, handlerCalls: [] },
  } as unknown as ModelOverload;
  const problems = new Problems();
  checkResultAdmitsWhatRecordsBring(overload, problems);
  return problems.lines;
}

const refusal =
  "table.ts:7: overload 0 of %PrivateGlobals%.evaluateCommonJSModule: a record brings a value into the result, and the type of the result admits no object";

// The row as it once stood: `if (list && list.indexOf(module) === -1) list.push(module)` was compiled away, and `module.children` stayed empty.
test("a member read into a result of undefined and null is refused", () => {
  expect(problemsOf({ returns: type({}), propertyActions: [readsChildren] })).toEqual([refusal]);
});

test("what lies in memory of native code is refused there too", () => {
  expect(problemsOf({ returns: type({}), transfers: [{ from: nativeMemory, to: result }] })).toEqual([refusal]);
});

test("a result that admits an object takes it", () => {
  for (const admitted of [{ isAnything: true }, { hasAnyObject: true }, { hasAnyFunction: true }])
    expect(problemsOf({ returns: type(admitted), propertyActions: [readsChildren] })).toEqual([]);
});

test("a record that brings nothing into the result says nothing of it", () => {
  expect(problemsOf({ returns: type({}), transfers: [{ from: result, to: nativeMemory }] })).toEqual([]);
});

test("a read of a property is typed by the analysis, and generated code holds its own result", () => {
  expect(problemsOf({ returns: type({}), mode: "Get", propertyActions: [readsChildren] })).toEqual([]);
  expect(problemsOf({ returns: type({}), proof: "ByConstruction", propertyActions: [readsChildren] })).toEqual([]);
});
