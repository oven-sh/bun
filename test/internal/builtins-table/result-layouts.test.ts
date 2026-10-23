import { expect, test } from "bun:test";
import { checkResultLayouts } from "../../../src/codegen/builtins/check-overloads.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type {
  ModelImplementation,
  ModelLayout,
  ModelOverload,
  ModelResultLayout,
} from "../../../src/codegen/builtins/model.ts";

const layoutOf = (token: string, isTuple = false): ModelLayout => ({ id: 0, token, isTuple, fields: [] });
const step = layoutOf("IteratorResult");
const pair = layoutOf("EntriesPair", true);

const hostCall: ModelImplementation = { how: "HostCall", callee: "Function", function: null };
const compiled = { how: "Compiled", function: {} } as ModelImplementation;
const inline: ModelImplementation = {
  how: "Inline",
  builtin: "ObjectGetOwnPropertyDescriptor",
  parameters: [],
  maximumArgumentCount: null,
  otherwise: hostCall,
};

function problemsOf(implementation: ModelImplementation, ...layouts: ModelResultLayout[]): readonly string[] {
  const overload = {
    indexInBuiltin: 0,
    builtin: { text: "next" },
    source: { file: "table.ts", line: 7 },
    result: { layouts },
    code: { implementation },
  } as unknown as ModelOverload;
  const problems = new Problems();
  checkResultLayouts([overload], problems);
  return problems.lines;
}

const nothingAllocates =
  'table.ts:7: overload 0 of next is not compiled, so nothing allocates the layout: b.ordinaryObjectOf("IteratorResult")';

test("only a compiled function returns a layout", () => {
  expect(problemsOf(compiled, { layout: step, isOrdinaryObject: false })).toEqual([]);
  expect(problemsOf(hostCall, { layout: step, isOrdinaryObject: false })).toEqual([nothingAllocates]);
  expect(problemsOf(inline, { layout: step, isOrdinaryObject: false })).toEqual([nothingAllocates]);
  expect(problemsOf({ how: "Generic" }, { layout: step, isOrdinaryObject: false })).toEqual([nothingAllocates]);
});

test("what other code returns is an ordinary object", () => {
  expect(problemsOf(hostCall, { layout: step, isOrdinaryObject: true })).toEqual([]);
  expect(problemsOf(inline, { layout: step, isOrdinaryObject: true })).toEqual([]);
  expect(problemsOf(compiled, { layout: step, isOrdinaryObject: true })).toEqual([
    'table.ts:7: overload 0 of next is compiled, so it allocates the layout: b.layoutOf("IteratorResult")',
  ]);
});

test("a tuple is an array whoever makes it", () => {
  expect(problemsOf(hostCall, { layout: pair, isOrdinaryObject: false })).toEqual([]);
  expect(problemsOf(compiled, { layout: pair, isOrdinaryObject: false })).toEqual([]);
  expect(problemsOf(hostCall, { layout: pair, isOrdinaryObject: true })).toEqual([
    "table.ts:7: overload 0 of next returns the tuple EntriesPair, which is an array",
  ]);
});
