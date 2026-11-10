import { expect, test } from "bun:test";
import type { WrittenSignature } from "../../../src/codegen/builtins/build-entries.ts";
import {
  applyUses,
  deriveHeaps,
  OverloadContext,
  type EntryContext,
} from "../../../src/codegen/builtins/build-uses.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";
import type { ModelParameter, ModelType } from "../../../src/codegen/builtins/model.ts";
import type { Heap, UseSpec } from "../../../src/codegen/builtins/vocabulary.ts";

const heaps: Heap[] = [
  "ObjectFields",
  "ShapeWords",
  "OrderWords",
  "NamedProperties",
  "Elements",
  "ArrayStorage",
  "TypedArrayStorage",
  "TypedArrayElements",
  "CollectionStorage",
  "CollectionEntries",
  "InternalFields",
  "RegExpState",
  "PromiseState",
  "ExternalState",
];
const heapsOfObjects = heaps.slice(0, 6);
const operand = { operand: "Argument", index: 0 } as const;
const never = { isAnything: false, hasAnyObject: false, hasAnyFunction: false, hasPlainData: false, parts: [] };
const anything = { ...never, isAnything: true } as unknown as ModelType;
const text = never as unknown as ModelType;

function effectsOf(accepted: ModelType, uses: readonly UseSpec[]) {
  const internComponent = (name: string) => ({ number: 0, text: name, kind: "Text", cppConstant: null });
  const entry = {
    builder: { internComponent, schema: { heaps } },
    types: { never: {} },
    builtin: { text: "read" },
    hostCallee: "Function",
  } as unknown as EntryContext;
  const signature = { mode: "Call", capability: "heap", reads: [], writes: [] };
  const written = { signature, source: { file: "table.ts", line: 1 } } as unknown as WrittenSignature;
  const context = new OverloadContext(entry, written);
  context.declare({
    name: "value",
    operand,
    accepted,
    converted: accepted,
    uses: ["Inspects"],
    roles: [],
    protocols: [],
    namedMembers: [],
    calledMembers: [],
    convertedMembers: [],
  } as unknown as ModelParameter);
  applyUses(context, operand, uses);
  return deriveHeaps(context);
}

test("native code that reads whatever object it is given reads where any class keeps what it holds", () => {
  expect(effectsOf(anything, [b.readsContents()]).reads).toEqual(heaps);
});

test("what a protocol reads is left to the type of the operand", () => {
  expect(effectsOf(anything, [b.readsContents(), b.runs("OwnValues")]).reads).toEqual(heapsOfObjects);
});

test("a store says where it goes by itself", () => {
  expect(effectsOf(anything, [b.writesContents()]).writes).toEqual(heapsOfObjects);
});

test("an operand that is no object has no such memory", () => {
  expect(effectsOf(text, [b.readsContents()]).reads).toEqual([]);
});
