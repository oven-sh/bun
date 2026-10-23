import { expect, test } from "bun:test";
import { Type, type FunctionDefinition } from "../../../src/codegen/bindgen-lib-internal.ts";
import * as b from "../../../src/codegen/bindgen-lib.ts";
import { declareFunction } from "../../../src/codegen/builtins/collect-bindgen.ts";
import type { MemberDeclaration } from "../../../src/codegen/builtins/declarations.ts";

const boolean = { type: "Primitive", primitive: "Boolean" };
const number = { type: "Primitive", primitive: "Number" };
const int32 = { type: "Integers", minimum: -(2 ** 31), maximum: 2 ** 31 - 1 };
const anything = { type: "Anything" };

function declare(fn: FunctionDefinition): MemberDeclaration {
  fn.name = "f";
  fn.origin = { stem: "x", namespace: "X", rustModule: "x", crate: "bun_runtime" };
  const [member] = declareFunction(fn, "Bun.f").filter(declaration => declaration.declares === "Member");
  return member;
}

const summarize = ({ signatures }: MemberDeclaration) =>
  signatures.map(({ parameters, isSpecialCase = false, directEntry }) => ({
    accepted: parameters.map(({ type }) => type.accepted),
    isSpecialCase,
    handedOver: directEntry?.parameters.map(({ value }) => value) ?? null,
  }));

test("a function whose arguments are taken as they are is entered with them", () => {
  const member = declare(b.fn({ args: { flag: b.bool, fd: b.i32, time: b.f64, anything: b.any } }));
  expect(summarize(member)).toEqual([
    {
      accepted: [boolean, int32, number, anything],
      isSpecialCase: false,
      handedOver: ["Realm", "Boolean", "Int32", "Double", "Value"],
    },
  ]);
  expect(member.signatures[0].directEntry).toMatchObject({
    symbol: "Bun__Bindgen__X__f",
    parameters: [
      { cppType: "JSC::JSGlobalObject*" },
      { cppType: "bool" },
      { cppType: "int32_t" },
      { cppType: "double" },
      { cppType: "JSC::EncodedJSValue" },
    ],
  });
  expect(member.signatures[0].directEntry?.declaration).toStartWith(
    'extern "C" SYSV_ABI JSC::EncodedJSValue Bun__Bindgen__X__f(JSC::JSGlobalObject*, ',
  );
  expect(member.dispatches).toEqual([{ mode: "Call", root: { signature: 0 } }]);
});

test("a function without arguments takes the realm", () => {
  expect(summarize(declare(b.fn({ returns: b.f64 })))).toEqual([
    { accepted: [], isSpecialCase: false, handedOver: ["Realm"] },
  ]);
});

test("arguments that converting would leave as they are have an overload of their own", () => {
  const member = declare(b.fn({ args: { value: b.any, force: b.bool.loose.default(false), time: b.f64.loose } }));
  const [special, general] = summarize(member);
  expect(special).toEqual({
    accepted: [anything, boolean, number],
    isSpecialCase: true,
    handedOver: ["Realm", "Value", "Boolean", "Double"],
  });
  expect(general).toMatchObject({ isSpecialCase: false, handedOver: null });
  expect(member.signatures[0].parameters.map(({ type }) => [type.mode, type.conversion])).toEqual([
    ["Required", "None"],
    ["Required", "None"],
    ["Required", "None"],
  ]);
  expect(member.signatures[1].parameters.map(({ type }) => type.conversion)).toEqual(["None", "ToBoolean", "ToNumber"]);
  const otherwise = { tested: anything, then: { signature: 1 } };
  expect(member.dispatches).toEqual([
    {
      mode: "Call",
      root: {
        argument: 1,
        branches: [
          { tested: boolean, then: { argument: 2, branches: [{ tested: number, then: { signature: 0 } }, otherwise] } },
          otherwise,
        ],
      },
    },
  ]);
});

test("what only the host function can make for the thunk leaves the function without an entry", () => {
  for (const type of [
    b.string,
    b.string.utf8,
    b.u32,
    b.usize,
    b.i32.validateInteger(0, 10),
    b.bool.optional,
    b.array(b.f64),
  ]) {
    expect(summarize(declare(b.fn({ args: { flag: b.bool, operand: type } })))).toMatchObject([
      { isSpecialCase: false, handedOver: null },
    ]);
  }
  expect(summarize(declare(b.fn({ args: { fd: b.i32.validateInteger() } })))).toMatchObject([
    { handedOver: ["Realm", "Int32"] },
  ]);
});

test("the realm and five arguments are the most", () => {
  const argumentsNamed = (...names: string[]) => Object.fromEntries(names.map(name => [name, b.any]));
  expect(summarize(declare(b.fn({ args: argumentsNamed("a", "b", "c", "d", "e") })))[0].handedOver).toHaveLength(6);
  expect(summarize(declare(b.fn({ args: argumentsNamed("a", "b", "c", "d", "e", "f") })))[0].handedOver).toBeNull();
});

test("each signature of a function has its own thunk", () => {
  const member = declare(
    b.overloads(
      { args: { fd: b.i32, flag: b.bool }, rustPath: "x::a" },
      { args: { flag: b.bool.loose }, rustPath: "x::b" },
    ),
  );
  expect(member.signatures.map(({ directEntry }) => directEntry?.symbol ?? null)).toEqual([
    "Bun__Bindgen__X__f1",
    "Bun__Bindgen__X__f2",
    null,
  ]);
});

test("a dictionary whose members are all there is answered as an object of one layout", () => {
  const origin = { stem: "x", namespace: "X", rustModule: "x", crate: "bun_runtime" };
  const named = <Dictionary extends ReturnType<typeof b.dictionary>>(dictionary: Dictionary, stem = "x") =>
    Object.assign(dictionary, { name: "Stats", origin: { ...origin, stem } });
  const resultOf = (returns: b.Type) => declare(b.fn({ returns, capability: "heap" })).signatures[0].result;
  expect(resultOf(named(b.dictionary({ hits: b.u32, name: b.string })))).toEqual({
    type: "Layout",
    layout: "Stats",
    isOrdinaryObject: true,
    freshness: "Yes",
  });
  expect(resultOf(named(b.dictionary({ hits: b.u32, name: b.string.optional })))).toEqual({ type: "PlainData" });
  expect(resultOf(named(b.dictionary({ hits: b.u32 }), "another"))).toEqual({ type: "PlainData" });
});

test("an argument that a null pointer stands in for can be left out of a direct call", () => {
  class CellType extends Type {
    readonly idlType = "Cell";
    readonly tsType = "string";
    get parameterType() {
      return b.string.parameterType;
    }
    get directForm() {
      return { value: "Value", cppType: "JSC::JSString*", type: { type: "Primitive", primitive: "String" } } as const;
    }
    get nullRepresentation() {
      return "pointer" as const;
    }
    layout = () => ({ size: 8, align: 8 });
    rustExternType = () => "*mut core::ffi::c_void";
    rustType = () => "()";
  }
  const string = { type: "Primitive", primitive: "String" };
  const notPassed = { type: "Primitive", primitive: "NotPassed" };
  const member = declare(b.fn({ args: { path: new CellType(), suffix: new CellType().optional } }));
  const stringOrNothing = { type: "Union", members: [string, notPassed] };
  expect(summarize(member)[0]).toEqual({
    accepted: [string, stringOrNothing],
    isSpecialCase: true,
    handedOver: ["Realm", "Value", "ValueOrEmpty"],
  });
  expect(member.signatures[0].parameters.map(({ type }) => type.mode)).toEqual(["Required", "Optional"]);
  expect(member.dispatches[0].root).toEqual({
    argument: 1,
    branches: [
      { tested: stringOrNothing, then: { signature: 0 } },
      { tested: anything, then: { signature: 1 } },
    ],
  });
  const followed = declare(b.fn({ args: { suffix: new CellType().optional, path: new CellType() } }));
  expect(summarize(followed)[0]).toMatchObject({ handedOver: ["Realm", "Value", "Value"] });
});

test("a value that may be left out is handed over as it is or as nothing, in one overload", () => {
  const member = declare(
    b.fn({ args: { value: b.any, name: b.any.orAbsent, options: b.any.orAbsent }, capability: "js", throws: true }),
  );
  expect(summarize(member)).toEqual([
    {
      accepted: [anything, anything, anything],
      isSpecialCase: false,
      handedOver: ["Realm", "Value", "ValueOrEmpty", "ValueOrEmpty"],
    },
  ]);
  expect(member.signatures[0].parameters.map(({ type }) => type.mode)).toEqual(["Required", "Optional", "Optional"]);
  expect(member.signatures[0].directEntry?.parameters.slice(1).map(({ cppType }) => cppType)).toEqual(
    Array(3).fill("JSC::EncodedJSValue"),
  );
});

test("one that another argument follows is always there", () => {
  const member = declare(b.fn({ args: { name: b.any.orAbsent, value: b.f64 }, capability: "js" }));
  expect(summarize(member)).toEqual([
    { accepted: [anything, number], isSpecialCase: false, handedOver: ["Realm", "Value", "Double"] },
  ]);
});

test("a function whose body is C++ is entered at that function", () => {
  const member = declare(
    b.overloads(
      {
        args: { value: b.f64, name: b.any.orAbsent },
        capability: "js",
        throws: true,
        cppSymbol: "Bun__Checks__checkNumber",
      },
      {
        args: { value: b.any.orAbsent, name: b.any.orAbsent },
        capability: "js",
        throws: true,
        cppSymbol: "Bun__Checks__check",
      },
    ),
  );
  expect(member.signatures.map(({ directEntry }) => directEntry?.symbol)).toEqual([
    "Bun__Checks__checkNumber",
    "Bun__Checks__check",
  ]);
  expect(member.signatures[0].directEntry?.declaration).toStartWith(
    'extern "C" SYSV_ABI JSC::EncodedJSValue Bun__Checks__checkNumber(JSC::JSGlobalObject*, ',
  );
  expect(() => b.fn({ rustPath: "crate::check", cppSymbol: "Bun__Checks__check" })).toThrow(
    "rustPath or cppSymbol, not both",
  );
  expect(() => b.fn({ cppInlineBody: { name: "Bun::Checks::check", header: "Checks.h" } })).toThrow(
    "cppInlineBody goes with a cppSymbol",
  );
});
