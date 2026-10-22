import { expect, test } from "bun:test";
import { checkDirectEntries } from "../../../src/codegen/builtins/check-direct-entries.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type {
  ModelBuiltin,
  ModelCode,
  ModelImplementation,
  ModelOverload,
  ModelParameter,
  ModelType,
} from "../../../src/codegen/builtins/model.ts";
import { realmParameter, type DirectEntrySpec, type DirectParameterSpec } from "../../../src/codegen/builtins/vocabulary.ts";

const hostCall: ModelImplementation = { how: "HostCall", callee: "HostFunction", function: null, customGetter: null };
const codeOfFunction = { symbol: "Bun::Bindgen::Generated::NodeOs::jsSetPriority", length: 2, header: "GeneratedNodeOs.h" };

const nothing = {
  isAnything: false,
  hasAnyObject: false,
  hasAnyFunction: false,
  hasPlainData: false,
  primitives: [],
  integers: null,
  stringLiterals: [],
  parts: [],
} as unknown as ModelType;
const anything = { ...nothing, isAnything: true };
const boolean: ModelType = { ...nothing, primitives: ["Boolean"] };
const number: ModelType = { ...nothing, primitives: ["Number"] };
const integersIn = (minimum: number, maximum: number): ModelType => ({
  ...nothing,
  integers: { minimum: { value: minimum, cppExpression: null }, maximum: { value: maximum, cppExpression: null } },
});
const int32 = integersIn(-(2 ** 31), 2 ** 31 - 1);
const instance = { ...nothing, parts: [{ part: "Instance" }] } as unknown as ModelType;

const taking = (accepted: ModelType, columns: Partial<ModelParameter> = {}) =>
  ({ name: "operand", mode: "Required", conversion: "None", accepted, ...columns }) as ModelParameter;

const value: DirectParameterSpec = { value: "Value", cppType: "JSC::EncodedJSValue" };
const asBoolean: DirectParameterSpec = { value: "Boolean", cppType: "bool" };
const asInt32: DirectParameterSpec = { value: "Int32", cppType: "int32_t" };
const asDouble: DirectParameterSpec = { value: "Double", cppType: "double" };
const rest: DirectParameterSpec = { value: "RestOfValues", cppType: "const JSC::EncodedJSValue*, size_t" };
const wrapped: DirectParameterSpec = { value: "NativeObjectOfReceiver", cppType: "void*" };
const receiverItself: DirectParameterSpec = { value: "Receiver", cppType: "JSC::EncodedJSValue" };
const stringCell: DirectParameterSpec = { value: "Value", cppType: "JSC::JSString*" };
const stringCellOrNothing: DirectParameterSpec = { value: "ValueOrEmpty", cppType: "JSC::JSString*" };
const string: ModelType = { ...nothing, primitives: ["String"] };

const entryTaking = (...parameters: DirectParameterSpec[]): DirectEntrySpec => ({
  symbol: "Bun__thunk",
  declaration: 'extern "C" JSC::EncodedJSValue Bun__thunk(..);',
  headers: [],
  parameters: [realmParameter, ...parameters],
});

interface Columns extends Partial<Omit<ModelOverload, "builtin" | "code">> {
  builtin?: Partial<ModelBuiltin>;
  code?: Partial<ModelCode>;
}

function problemsOf({ builtin, code, ...columns }: Columns): readonly string[] {
  const overload = {
    indexInBuiltin: 0,
    builtin: { text: "f", kind: "Function", origin: "Host", scope: "Module", attachments: { nativeFunction: codeOfFunction }, ...builtin },
    source: { file: "x.bind.ts", line: null },
    mode: "Call",
    receiver: null,
    parameters: [],
    code: { implementation: hostCall, directEntry: entryTaking(), ...code },
    ...columns,
  } as unknown as ModelOverload;
  const problems = new Problems();
  checkDirectEntries({ overloads: [overload] }, problems);
  return problems.lines;
}

const problem = (text: string) => `x.bind.ts: overload 0 of f: ${text}`;
const problemsOfOperands = (direct: readonly DirectParameterSpec[], parameters: readonly ModelParameter[]) =>
  problemsOf({ parameters, code: { directEntry: entryTaking(...direct) } });

test("a call of native code of the host may have a direct entry", () => {
  expect(problemsOf({})).toEqual([]);
  expect(
    problemsOfOperands([value, asBoolean, asInt32, asDouble], [taking(anything), taking(boolean), taking(int32), taking(number)]),
  ).toEqual([]);
  expect(problemsOfOperands([asDouble, rest], [taking(int32), taking(anything, { mode: "Rest" })])).toEqual([]);
});

test("an overload without a direct entry is not looked at, nor one of a native binding", () => {
  expect(problemsOf({ mode: "Get", builtin: { origin: "Engine" }, code: { directEntry: null, implementation: { how: "Generic" } } })).toEqual([]);
  expect(problemsOf({ builtin: { kind: "NativeBinding", origin: "Engine" } })).toEqual([]);
});

test("a parameter is of a kind that the engine knows, and of a C++ type of that kind", () => {
  expect(problemsOfOperands([{ value: "String", cppType: "WTF::StringImpl*" } as unknown as DirectParameterSpec], [taking(anything)])).toEqual([
    problem("String is not one of Realm, NativeObjectOfReceiver, Receiver, Value, ValueOrEmpty, RestOfValues, FrameOfValues, Boolean, Int32, Double"),
  ]);
  expect(problemsOfOperands([{ value: "Int32", cppType: "uint32_t" }], [taking(int32)])).toEqual([
    problem("uint32_t is not handed over as Int32"),
  ]);
});

test("where the function declares a pointer to a cell nothing but such a cell comes", () => {
  const isNoString = problem("operand can be something that Value does not hand over");
  expect(problemsOfOperands([stringCell], [taking(string)])).toEqual([]);
  expect(problemsOfOperands([stringCell], [taking(anything)])).toEqual([isNoString]);
  expect(problemsOfOperands([stringCell], [taking({ ...string, primitives: ["String", "Undefined"] })])).toEqual([isNoString]);
  expect(problemsOfOperands([stringCell], [taking({ ...string, parts: instance.parts })])).toEqual([isNoString]);
  expect(problemsOfOperands([{ value: "Value", cppType: "JSC::JSObject*" }], [taking(instance)])).toEqual([]);
  expect(problemsOfOperands([{ value: "Value", cppType: "JSC::JSObject*" }], [taking(string)])).toEqual([isNoString]);
});

test("an operand that can be left out is handed over as it is or as nothing", () => {
  const leftOut = { ...string, primitives: ["String", "NotPassed"] } as ModelType;
  const isForOptional = problem("operand: ValueOrEmpty is for an operand that can be left out, and for nothing else");
  expect(problemsOfOperands([stringCellOrNothing], [taking(leftOut, { mode: "Optional" })])).toEqual([]);
  expect(problemsOfOperands([stringCellOrNothing], [taking(string)])).toEqual([isForOptional]);
  expect(problemsOfOperands([stringCell], [taking(leftOut, { mode: "Optional" })])).toEqual([isForOptional]);
  expect(
    problemsOfOperands([stringCellOrNothing], [taking({ ...leftOut, primitives: ["String", "Undefined", "NotPassed"] }, { mode: "Optional" })]),
  ).toEqual([problem("operand can be something that ValueOrEmpty does not hand over")]);
  expect(problemsOfOperands([{ value: "ValueOrEmpty", cppType: "JSC::EncodedJSValue" }], [taking(anything, { mode: "Optional" })])).toEqual([]);
  expect(problemsOfOperands([{ value: "ValueOrEmpty", cppType: "JSC::EncodedJSValue" }], [taking(anything)])).toEqual([isForOptional]);
});

test("the parameters fit the registers", () => {
  const six = Array.from({ length: 6 }, () => value);
  expect(problemsOfOperands(six, six.map(() => taking(anything)))).toEqual([
    problem("Bun__thunk has more than 6 parameters"),
    problem("Bun__thunk takes more than fits the 6 general argument registers"),
  ]);
  expect(problemsOfOperands([value, value, value, value, rest], [...six.slice(0, 4).map(() => taking(anything)), taking(anything, { mode: "Rest" })])).toEqual([
    problem("Bun__thunk takes more than fits the 6 general argument registers"),
  ]);
  expect(problemsOfOperands([value, value, value, value, asDouble], [...six.slice(0, 4).map(() => taking(anything)), taking(number)])).toEqual([]);
});

test("the function takes each operand of the overload", () => {
  expect(problemsOfOperands([value], [])).toEqual([problem("Bun__thunk takes 1 arguments, and the overload has 0")]);
  expect(problemsOfOperands([], [taking(anything)])).toEqual([problem("Bun__thunk takes 0 arguments, and the overload has 1")]);
});

test("an operand is all that the overload says and needs no conversion", () => {
  expect(problemsOfOperands([asBoolean], [taking(boolean, { conversion: "ToBoolean" })])).toEqual([
    problem("operand is converted, and the function takes its operands as they are"),
  ]);
  expect(problemsOfOperands([asBoolean], [taking({ ...boolean, primitives: ["Boolean", "Undefined"] }, { mode: "Optional" })])).toEqual([
    problem("operand: ValueOrEmpty is for an operand that can be left out, and for nothing else"),
    problem("operand can be something that Boolean does not hand over"),
  ]);
  expect(problemsOfOperands([asInt32], [taking(number)])).toEqual([problem("operand can be something that Int32 does not hand over")]);
  expect(problemsOfOperands([asInt32], [taking(integersIn(0, 2 ** 32 - 1))])).toEqual([
    problem("operand can be something that Int32 does not hand over"),
  ]);
  expect(problemsOfOperands([asDouble], [taking(anything)])).toEqual([problem("operand can be something that Double does not hand over")]);
});

test("the operands that are left go together, and last", () => {
  const restIsForTheRest = problem("operand: RestOfValues is for the operands that are left, and for nothing else");
  expect(problemsOfOperands([rest], [taking(anything)])).toEqual([restIsForTheRest]);
  expect(problemsOfOperands([value], [taking(anything, { mode: "Rest" })])).toEqual([restIsForTheRest]);
});

test("the symbol is the name of a C function", () => {
  expect(problemsOf({ code: { directEntry: { ...entryTaking(), symbol: "Bun::thunk" } } })).toEqual([
    problem('"Bun::thunk" is not the name of a C function'),
  ]);
});

test("the entry of a function that each module makes anew says which native code the function object has", () => {
  const attachments = { nativeFunction: null } as ModelBuiltin["attachments"];
  expect(problemsOf({ builtin: { attachments } })).toEqual([
    problem("compiled code knows the function that Bun__thunk stands in for by its native code, so the entry has functionObjectCode"),
  ]);
  expect(problemsOf({ builtin: { attachments, scope: "Realm" } })).toEqual([]);
});

test("only the host binds one", () => {
  expect(problemsOf({ builtin: { origin: "Engine" } })).toEqual([
    problem("Bun__thunk is bound with the functions of the host, and the entry is the engine's"),
  ]);
});

test("it stands in for native code", () => {
  expect(problemsOf({ code: { implementation: { how: "Generic" } } })).toEqual([
    problem("Bun__thunk stands in for native code of the host, so the overload is a call of the host"),
  ]);
});

test("without a parameter for it there is no receiver", () => {
  const takesNoReceiver = problem("Bun__thunk takes the arguments of a call and no receiver");
  expect(problemsOf({ mode: "Construct" })).toEqual([takesNoReceiver]);
  expect(problemsOf({ receiver: taking(instance) })).toEqual([takesNoReceiver]);
});

test("what the receiver wraps is taken out of an instance of a class", () => {
  const directEntry = { ...entryTaking(), parameters: [wrapped, realmParameter], offsetOfNativeObject: "WebCore::JSX::offsetOfWrapped()" };
  expect(problemsOf({ mode: "Get", receiver: taking(instance), code: { directEntry } })).toEqual([]);
  expect(problemsOf({ mode: "Get", receiver: taking(anything), code: { directEntry } })).toEqual([
    problem("Bun__thunk takes what the receiver wraps, so the receiver is an instance of a class"),
  ]);
  expect(problemsOf({ mode: "Get", receiver: taking(instance), code: { directEntry: { ...directEntry, offsetOfNativeObject: undefined } } })).toEqual([
    problem("Bun__thunk: offsetOfNativeObject goes with a parameter that is NativeObjectOfReceiver"),
  ]);
  const withReceiver = { ...directEntry, parameters: [wrapped, receiverItself, realmParameter] };
  expect(problemsOf({ mode: "Get", receiver: taking(instance), code: { directEntry: withReceiver } })).toEqual([]);
  expect(problemsOf({ mode: "Get", code: { directEntry: { ...entryTaking(), parameters: [receiverItself, realmParameter] } } })).toEqual([
    problem("Bun__thunk takes the receiver, and the overload has none"),
  ]);
});
