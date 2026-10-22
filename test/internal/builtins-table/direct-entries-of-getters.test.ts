import { expect, test } from "bun:test";
import { define, type ClassDefinition } from "../../../src/codegen/class-definitions.ts";
import { collectClasses } from "../../../src/codegen/builtins/collect-classes.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";

const collect = (definition: Partial<ClassDefinition>, problems: Problems) =>
  collectClasses([define({ name: "Thing", proto: {}, klass: {}, ...definition } as ClassDefinition)], problems);

function problemsOf(definition: Partial<ClassDefinition>): readonly string[] {
  const problems = new Problems();
  collect(definition, problems);
  return problems.lines;
}

function entriesOf(definition: Partial<ClassDefinition>): Record<string, string | null> {
  const problems = new Problems();
  const declarations = collect(definition, problems);
  expect(problems.lines).toEqual([]);
  return Object.fromEntries(
    declarations.flatMap(({ declaration }) =>
      declaration.declares === "Member" && declaration.kind === "Accessor"
        ? [[declaration.path, declaration.columns.directEntryOfGetter?.symbol ?? null]]
        : [],
    ),
  );
}

test("a getter that is passed what its receiver wraps and the realm is entered without the getter of the table", () => {
  const problems = new Problems();
  const [member] = collectClasses(
    [define({ name: "Thing", proto: { size: { getter: "getSize", type: "number" } }, klass: {} } as ClassDefinition)],
    problems,
  ).flatMap(({ declaration }) => (declaration.declares === "Member" && declaration.kind === "Accessor" ? [declaration] : []));
  expect(member.columns).toMatchObject({
    customGetter: "ThingPrototype__sizeGetterWrap",
    directEntryOfGetter: {
      symbol: "ThingPrototype__getSize",
      declaration:
        'extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ThingPrototype__getSize(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject);',
      headers: ["ZigGeneratedClasses.h"],
      parameters: [
        { value: "NativeObjectOfReceiver", cppType: "void*" },
        { value: "Realm", cppType: "JSC::JSGlobalObject*" },
      ],
      offsetOfNativeObject: "WebCore::JSThing::offsetOfWrapped()",
    },
  });
});

test("it does not matter whether the class definition says what the getter answers", () => {
  expect(entriesOf({ proto: { data: { getter: "getData" } } })).toEqual({ "%Thing%.prototype.data": "ThingPrototype__getData" });
});

test("a getter that is also passed its receiver takes it between the two", () => {
  const [member] = collect({ proto: { timeout: { getter: "getTimeout", this: true, type: "number" } } }, new Problems()).flatMap(
    ({ declaration }) => (declaration.declares === "Member" && declaration.kind === "Accessor" ? [declaration] : []),
  );
  expect(member.columns.directEntryOfGetter).toMatchObject({
    declaration:
      'extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ThingPrototype__getTimeout(void* ptr, JSC::EncodedJSValue thisValue, JSC::JSGlobalObject* lexicalGlobalObject);',
    parameters: [{ value: "NativeObjectOfReceiver" }, { value: "Receiver", cppType: "JSC::EncodedJSValue" }, { value: "Realm" }],
  });
});

test("a getter for which the getter of the table does more is entered through the table", () => {
  expect(
    entriesOf({
      proto: {
        address: { getter: "getAddress", cache: true },
        size: { getter: "getSize", type: "number", checkedAtRuntime: true },
      },
    }),
  ).toEqual({ "%Thing%.prototype.address": null, "%Thing%.prototype.size": null });
});

test("a pure getter touches no heap and throws nothing", () => {
  const signatureOf = (field: ClassDefinition["proto"][string]) =>
    collect({ proto: { size: field } }, new Problems()).flatMap(({ declaration }) =>
      declaration.declares === "Member" && declaration.kind === "Accessor" ? declaration.signatures : [],
    )[0];
  expect(signatureOf({ getter: "getSize", type: "number", pure: true })).toMatchObject({
    mode: "Get",
    capability: "none",
    throws: false,
    reads: ["ExternalState"],
    writes: [],
  });
  expect(signatureOf({ getter: "getSize", type: "number" })).toMatchObject({ capability: "heap", throws: true, writes: ["ExternalState"] });
});

test("a pure getter answers no cell, and its Rust type proves what it answers", () => {
  const needsProof = "Thing.size: a pure getter has a type that the return type of its Rust method proves";
  expect(problemsOf({ proto: { size: { getter: "getSize", type: "int32 | null", pure: true } } })).toEqual([]);
  expect(problemsOf({ proto: { size: { getter: "getSize", pure: true } } })).toEqual([needsProof]);
  expect(problemsOf({ proto: { size: { getter: "getSize", type: "number", checkedAtRuntime: true, pure: true } } })).toEqual([needsProof]);
  expect(problemsOf({ proto: { size: { getter: "getSize", type: "string", pure: true } } })).toEqual([
    "Thing.size: a pure getter allocates nothing, so 'string' is not what it answers",
  ]);
  expect(problemsOf({ proto: { size: { getter: "getSize", type: "number", cache: true, pure: true } } })).toEqual([
    "Thing.size: the getter of the table stores what a cached getter answers, so it is not pure",
  ]);
});

test("the getters of a constructor and of a function that is bound take other things", () => {
  expect(entriesOf({ klass: { count: { getter: "getCount", type: "number" } } })).toEqual({ "%Thing%.count": null });
  expect(entriesOf({ forBind: true, proto: { size: { getter: "getSize", type: "number" } } })).toEqual({ "%Thing%.prototype.size": null });
});
