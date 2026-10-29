import { expect, test } from "bun:test";
import { typeOfPropertyWithoutWrittenType } from "../../../src/codegen/builtins/build-overloads.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";
import type { ModelBuiltin, ModelName, NameKind } from "../../../src/codegen/builtins/model.ts";
import type { BuiltinKind } from "../../../src/codegen/builtins/vocabulary.ts";

const named = (text: string, kind: NameKind = "Text") => ({ text, kind }) as ModelName;
const heldBy = (kind: BuiltinKind | null) => (kind === null ? null : ({ kind } as ModelBuiltin));
const typeOf = (name: ModelName, holder: BuiltinKind | null) =>
  typeOfPropertyWithoutWrittenType({ name, holder: heldBy(holder) });

test("the length and the name of a function have the types that every built-in function is created with", () => {
  for (const kind of ["Constructor", "Function", "Method"] as const) {
    expect(typeOf(named("length"), kind)).toEqual(b.int(0, 2 ** 31 - 1).spec);
    expect(typeOf(named("name"), kind)).toEqual(b.string.spec);
  }
});

test("a length or a name of what is no function is anything", () => {
  for (const kind of ["Namespace", "Prototype", null] as const) {
    expect(typeOf(named("length"), kind)).toEqual(b.any.spec);
    expect(typeOf(named("name"), kind)).toEqual(b.any.spec);
  }
});

test("a @@toStringTag is a string on every holder", () => {
  for (const kind of ["Namespace", "Prototype", "Constructor"] as const)
    expect(typeOf(named("toStringTag", "WellKnownSymbol"), kind)).toEqual(b.string.spec);
});

test("no other property gets a type, and a symbol is not taken for the text of its name", () => {
  expect(typeOf(named("size"), "Constructor")).toEqual(b.any.spec);
  expect(typeOf(named("toStringTag"), "Prototype")).toEqual(b.any.spec);
  expect(typeOf(named("species", "WellKnownSymbol"), "Constructor")).toEqual(b.any.spec);
  expect(typeOf(named("length", "RegisteredSymbol"), "Function")).toEqual(b.any.spec);
  expect(typeOf(named("name", "WellKnownSymbol"), "Function")).toEqual(b.any.spec);
});
