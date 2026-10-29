import { expect, test } from "bun:test";
import { checkInstanceTests } from "../../../src/codegen/builtins/check-instance-tests.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type { BuiltinFlag, ModelBuiltin, ModelClass } from "../../../src/codegen/builtins/model.ts";

function classOf(token: string, columns: Partial<ModelClass> = {}): ModelClass {
  return {
    id: 0,
    token,
    origin: "Engine",
    parent: null,
    constructor: null,
    prototype: null,
    jsType: "CellType",
    typedArrayType: "NotTypedArray",
    instanceTest: "None",
    sharingMode: null,
    instanceCppClass: null,
    prototypeCppExpression: null,
    instanceStructureCppExpression: null,
    isPrimitiveWrapper: false,
    isNeverPristine: false,
    pristineTest: "Mark",
    hasClosureInstances: false,
    definesCharactersOnNewInstances: false,
    slots: [],
    stateHeap: null,
    types: [],
    ...columns,
  };
}

const testedByCellType = (token: string, jsType: string, columns: Partial<ModelClass> = {}) =>
  classOf(token, { jsType, instanceTest: "JSTypeEquals", ...columns });

const buffer = (token: string, sharingMode: "Default" | "Shared") =>
  classOf(token, { jsType: "ArrayBufferType", instanceTest: "SharingModeEquals", sharingMode });

function problemsOf(...classes: ModelClass[]): readonly string[] {
  const problems = new Problems();
  checkInstanceTests({ classes }, problems);
  return problems.lines;
}

const samePassingCells = (first: string, second: string, cellType: string) =>
  `the instance tests of ${first} and ${second} both pass for a cell of type ${cellType}, and neither class extends the other`;

test("two unrelated classes may not be tested by one cell type", () => {
  expect(problemsOf(testedByCellType("Map", "JSMapType"), testedByCellType("Set", "JSSetType"))).toEqual([]);
  expect(problemsOf(testedByCellType("Map", "JSMapType"), testedByCellType("Set", "JSMapType"))).toEqual([
    samePassingCells("Map", "Set", "JSMapType"),
  ]);
});

test("a class may be tested by the cell type of a class it extends", () => {
  const view = testedByCellType("Uint8Array", "Uint8ArrayType");
  const middle = classOf("Middle", { parent: view });
  expect(problemsOf(view, testedByCellType("Buffer", "Uint8ArrayType", { parent: view }))).toEqual([]);
  expect(problemsOf(testedByCellType("Buffer", "Uint8ArrayType", { parent: middle }), middle, view)).toEqual([]);
});

test("the sharing mode tells two classes with one cell type apart", () => {
  expect(problemsOf(buffer("ArrayBuffer", "Default"), buffer("SharedArrayBuffer", "Shared"))).toEqual([]);
  expect(problemsOf(buffer("ArrayBuffer", "Default"), buffer("OtherBuffer", "Default"))).toEqual([
    samePassingCells("ArrayBuffer", "OtherBuffer", "ArrayBufferType"),
  ]);
  expect(problemsOf(buffer("SharedArrayBuffer", "Shared"), testedByCellType("AnyBuffer", "ArrayBufferType"))).toEqual([
    samePassingCells("SharedArrayBuffer", "AnyBuffer", "ArrayBufferType"),
  ]);
});

test("a class whose test does not read the cell type may share it", () => {
  const untested = classOf("TypeError", { jsType: "ErrorInstanceType" });
  const testedByClassInfo = classOf("DOMException", {
    jsType: "ErrorInstanceType",
    instanceTest: "ClassInfoInherits",
    instanceCppClass: { name: "JSDOMException", header: "JSDOMException.h" },
  });
  expect(problemsOf(testedByCellType("Error", "ErrorInstanceType"), untested, testedByClassInfo)).toEqual([]);
});

test("only a class of array buffer cells has a sharing mode", () => {
  const message = (token: string) =>
    `the class ${token} has a sharing mode, so its cell type is ArrayBufferType and it names no C++ class`;
  expect(
    problemsOf(classOf("Map", { jsType: "JSMapType", instanceTest: "SharingModeEquals", sharingMode: "Shared" })),
  ).toEqual([message("Map")]);
  const namesCppClass = classOf("Pool", {
    jsType: "ArrayBufferType",
    instanceTest: "ClassInfoInherits",
    instanceCppClass: { name: "JSPool", header: "JSPool.h" },
    sharingMode: "Default",
  });
  expect(problemsOf(namesCppClass)).toEqual([message("Pool")]);
});

test("a host class with locked prototypes names the Structure of its instances or is never pristine", () => {
  const prototypeOf = (flags: readonly BuiltinFlag[], above: ModelBuiltin | null) =>
    ({
      flags,
      sameObjectAs: null,
      prototype: above === null ? { link: "Null" } : { link: "Builtin", builtin: above },
    }) as ModelBuiltin;
  const objectPrototype = prototypeOf(["IsLockedObject"], null);
  const locked = prototypeOf(["HasLockedMembers"], objectPrototype);
  const hostClass = (token: string, columns: Partial<ModelClass> = {}) =>
    classOf(token, { origin: "Host", prototype: locked, ...columns });
  expect(
    problemsOf(
      hostClass("Named", { instanceStructureCppExpression: "globalObject->namedStructure()" }),
      hostClass("Never", { isNeverPristine: true }),
      hostClass("Wrapper", { isPrimitiveWrapper: true }),
      hostClass("Open", { prototype: prototypeOf([], objectPrototype) }),
      hostClass("BelowOpen", { prototype: prototypeOf(["IsLockedObject"], prototypeOf([], objectPrototype)) }),
      hostClass("WithoutPrototype", { prototype: null }),
      classOf("OfTheEngine", { prototype: locked }),
    ),
  ).toEqual([]);
  expect(problemsOf(hostClass("Missing"))).toEqual([
    "every prototype of the class Missing is locked, so it names the Structure of its instances (instanceStructureCppExpression) or is never pristine",
  ]);
});
