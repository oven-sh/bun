import { expect, test } from "bun:test";
import type { Schema } from "../../../src/codegen/aot-schema/load.ts";
import { buildEntries, ModelBuilder } from "../../../src/codegen/builtins/build-entries.ts";
import type { Declaration, SourcedDeclaration } from "../../../src/codegen/builtins/declarations.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";

const path = "native:Cpp:Path.cpp:createNodePathBinding";

const answersObject = { getter: b.object.fresh, capability: "heap", throws: true } satisfies b.GetterField;
const functionsTakeAnything = {
  args: { operands: b.any.rest },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { operands: [b.retained] },
} as b.FunctionField;

const writtenIn = (file: string, declarations: readonly Declaration[]): SourcedDeclaration[] =>
  declarations.map(declaration => ({
    declaration,
    source: { file, line: null, origin: "Host", proof: "HandWritten" },
  }));

function build(...rows: readonly SourcedDeclaration[]): ModelBuilder {
  const builder = new ModelBuilder({ schema: {} as Schema, engineFiles: [] });
  buildEntries(builder, [
    ...writtenIn("globals.ts", b.namespace("globalThis", {}, { isGlobalObject: true })),
    ...writtenIn("src/js", [
      {
        declares: "NativeBinding",
        kind: "Cpp",
        file: "Path.cpp",
        symbol: "createNodePathBinding",
        hostNumber: 7,
        answersFunction: false,
      },
    ]),
    ...rows,
  ]);
  return builder;
}

const modesOf = (builder: ModelBuilder, entry = path) =>
  builder.signaturesOf(builder.find(entry)!).map(({ signature }) => signature.mode);

const validator = "native:NewCppFunction:NodeValidator.cpp:jsFunction_validateObject";
const validatorFunction = "%NativeFunctions%.NodeValidatorCppJsFunction_validateObject";
const makesValidator = writtenIn("src/js", [
  {
    declares: "NativeBinding",
    kind: "NewCppFunction",
    file: "NodeValidator.cpp",
    symbol: "jsFunction_validateObject",
    hostNumber: 8,
    answersFunction: true,
  },
  ...b.extend(validator, {
    functionObjectCode: { symbol: "jsFunction_validateObject", header: "NodeValidator.h" },
    length: 2,
  }),
]);

test("a getter says what a native binding answers", () => {
  const builder = build(...writtenIn("values.ts", b.static(path, answersObject)));
  expect(builder.problems.lines).toEqual([]);
  expect(builder.find(path)).toMatchObject({ kind: "NativeBinding", hostNumber: 7, holder: null });
  expect(modesOf(builder)).toEqual(["Get"]);
});

test("another file may say what the functions in the answer do", () => {
  const builder = build(
    ...writtenIn("operands.ts", b.static(path, functionsTakeAnything)),
    ...writtenIn("values.ts", b.static(path, answersObject)),
  );
  expect(builder.problems.lines).toEqual([]);
  expect(builder.find(path)?.kind).toBe("NativeBinding");
  expect(modesOf(builder).toSorted()).toEqual(["Call", "Get"]);
});

test("the answer is written once", () => {
  const builder = build(
    ...writtenIn("first.ts", b.static(path, answersObject)),
    ...writtenIn("second.ts", b.static(path, answersObject)),
  );
  expect(builder.problems.lines).toEqual([`second.ts: ${path} is declared in first.ts and in second.ts`]);
});

test("a binding that makes a function answers an entry of that function", () => {
  const builder = build(...makesValidator, ...writtenIn("operands.ts", b.static(validator, functionsTakeAnything)));
  expect(builder.problems.lines).toEqual([]);
  expect(builder.find(validatorFunction)).toMatchObject({ kind: "Function", scope: "Module" });
  expect(builder.find(validator)).toMatchObject({ kind: "NativeBinding", scope: "Realm", hostNumber: 8 });
  expect(modesOf(builder, validatorFunction)).toEqual(["Call"]);
  expect(modesOf(builder, validator)).toEqual(["Call", "Get"]);
  expect(builder.signaturesOf(builder.find(validator)!).at(-1)?.signature.result).toEqual({
    type: "Builtin",
    path: validatorFunction,
  });
  expect(builder.lengthOf(builder.find(validatorFunction)!)).toBe(2);
});

test("nobody writes what such a binding answers", () => {
  expect(
    build(...makesValidator, ...writtenIn("values.ts", b.static(validator, answersObject))).problems.lines,
  ).toEqual([`values.ts: ${validator} makes a function, so nobody writes what it answers`]);
});

test("a native binding is no property and no constant", () => {
  expect(build(...writtenIn("values.ts", b.static(path, b.property(b.object)))).problems.lines).toEqual([
    `values.ts: ${path} is declared as NativeBinding and as DataProperty`,
  ]);
  expect(build(...writtenIn("values.ts", b.static(path, b.constant(1)))).problems.lines).toEqual([
    `values.ts: ${path} is declared as NativeBinding and as Constant`,
  ]);
});
