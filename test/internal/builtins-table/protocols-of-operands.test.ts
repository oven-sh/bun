import { expect, test } from "bun:test";
import type { WrittenSignature } from "../../../src/codegen/builtins/build-entries.ts";
import { applyUses, OverloadContext, type EntryContext } from "../../../src/codegen/builtins/build-uses.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";
import type { ModelName, ModelParameter } from "../../../src/codegen/builtins/model.ts";
import type { Protocol, UseSpec } from "../../../src/codegen/builtins/vocabulary.ts";

const receiver = { operand: "Receiver" } as const;

function receiverWith(uses: readonly UseSpec[], protocolsOfConversion: readonly Protocol[] = []): ModelParameter {
  const names = new Map<string, ModelName>();
  const internComponent = (text: string): ModelName => {
    const name = names.get(text) ?? { number: names.size, text, kind: "Text", cppConstant: null };
    names.set(text, name);
    return name;
  };
  const entry = {
    builder: { internComponent },
    types: { never: {} },
    builtin: { text: "join" },
    hostCallee: "Function",
  } as unknown as EntryContext;
  const written = { signature: { mode: "Call" }, source: { file: "table.ts", line: 1 } } as unknown as WrittenSignature;
  const context = new OverloadContext(entry, written);
  context.declare({
    name: "this",
    operand: receiver,
    uses: ["Inspects"],
    roles: [],
    protocols: protocolsOfConversion,
    namedMembers: [],
    calledMembers: [],
    convertedMembers: [],
  } as unknown as ModelParameter);
  applyUses(context, receiver, uses);
  return context.finishReceiver()!;
}

const textsOf = (names: readonly ModelName[]) => names.map(name => name.text);

test("a member is read or called", () => {
  const parameter = receiverWith([b.runs(b.calls("join"), b.named("@@toStringTag", "length"))]);
  expect(parameter.protocols).toEqual(["Named", "CallsNamed"]);
  expect(textsOf(parameter.namedMembers)).toEqual(["@@toStringTag", "length"]);
  expect(textsOf(parameter.calledMembers)).toEqual(["join"]);
});

test("a member that is read by key is not called", () => {
  const parameter = receiverWith([b.readByKey(b.keysNamed("cause"), b.nativeMemory)]);
  expect(parameter.protocols).toEqual(["Named"]);
  expect(textsOf(parameter.namedMembers)).toEqual(["cause"]);
  expect(parameter.calledMembers).toEqual([]);
});

test("a word without a name means every member, and only for that word", () => {
  const parameter = receiverWith([b.runs(b.named("length"), b.calls("next"), b.calls())]);
  expect(parameter.protocols).toEqual(["Named", "CallsNamed"]);
  expect(textsOf(parameter.namedMembers)).toEqual(["length"]);
  expect(parameter.calledMembers).toEqual([]);
});

test("a function is converted only under a name that the entry lists", () => {
  const uses = [
    b.runsTransitively("OwnValues", "ToPrimitive", b.named("port")),
    b.readByKey(b.keysNamed("fetch"), b.nativeMemory),
  ];
  const marked = receiverWith([...uses, b.functionsConvertedUnderNamesOnly]);
  expect(marked.roles).toEqual(["FunctionsAreConvertedUnderNamesOnly"]);
  expect(textsOf(marked.namedMembers)).toEqual(["port", "fetch"]);
  expect(textsOf(marked.convertedMembers)).toEqual(["port"]);

  expect(receiverWith(uses).convertedMembers).toEqual([]);
});

test("protocols that run only on the contents", () => {
  const parameter = receiverWith([b.readsContents(), b.runsOnContents("ToPrimitive")]);
  expect(parameter.protocols).toEqual(["ToPrimitive"]);
  expect(parameter.uses).toEqual(["Inspects", "ReadsContents", "AppliesToContents"]);
});

test("beside a protocol of the operand itself, every reachable object covers both", () => {
  const written = receiverWith([b.runs("OwnValues"), b.runsOnContents("ToPrimitive", b.calls("toLocaleString"))]);
  expect(written.protocols).toEqual(["OwnValues", "ToPrimitive", "CallsNamed"]);
  expect(written.uses).toEqual(["Inspects", "AppliesTransitively"]);

  const converted = receiverWith([b.runsOnContents("ToPrimitive")], ["ToPrimitive"]);
  expect(converted.uses).toEqual(["Inspects", "AppliesTransitively"]);

  const read = receiverWith([b.readByKey(b.keysNamed("length"), b.nativeMemory), b.runsOnContents("ToPrimitive")]);
  expect(read.uses).toEqual(["Inspects", "ReadsContents", "AppliesTransitively"]);
});

test("protocols of the operand alone choose no other receiver", () => {
  expect(receiverWith([b.runs("ToPrimitive")]).uses).toEqual(["Inspects"]);
  expect(receiverWith([b.runsTransitively("ToPrimitive")]).uses).toEqual(["Inspects", "AppliesTransitively"]);
});
