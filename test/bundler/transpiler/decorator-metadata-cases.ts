// Programs for decorator-metadata.test.ts. Each is compiled by TypeScript and by Bun, then run: a `Reflect.metadata`
// that logs shows which `design:*` keys each compiler emitted, with which values and in which order.

import { type Case, header, program } from "./decorator-differential";

/** What the type matrix imports. */
const dep = `
log("dep evaluated");
export class XC { static Inner = class Inner {}; static notAClass = 1; }
export class XC2 {}
export enum XE { A, B }
export enum XES { A = "a" }
export const XO = { K: class K {}, deep: { K: class DeepK {} }, n: 1 };
export const XN = 1;
export function XF() {}
export interface XI { a: string }
export type XT = string;
export namespace XNS2 { export class K {} export namespace Inner { export class K {} } }
export default class XD {}
`;

const imports = `
import { XC, XC2, XE, XES, XO, XN, XF, XNS2 } from "./dep.js";
import type { XC as XTC, XI as XTI, XE as XTE } from "./dep.js";
import { type XC as XIC, type XT as XIT } from "./dep.js";
import * as XNS from "./dep.js";
import type * as XTNS from "./dep.js";
import XD from "./dep.js";
import type XTD from "./dep.js";
`;

const declarations = `
class K { a!: string; n!: number; k!: K; }
class K2 {}
abstract class AK {}
class G<T> { t!: T }
class Sub extends K {}
interface I { a: string }
interface I2 extends I {}
interface IG<T> { t: T }
interface ICall { (): void }
interface ICallSub extends ICall {}
interface INew { new (): K }
interface IBoth { (): void; new (): K }
interface IArr extends Array<string> {}
function F() {}
function FT(): string { return ""; }
const V = 1;
const VS = "s";
let VL = "s";
const VK = class {};
const VO = { a: 1, K: class {} };
const VSym = Symbol();

enum EN { A, B }
enum ES { A = "a", B = "b" }
enum EM { A, B = "b" }
enum EC { A = 1 << 2, B = A | 1 }
enum ECmp { A = "x".length }
enum ETpl { A = \`a\` }
enum ERef { A = EN.A, B = ES.A }
enum EEmpty {}
enum EOne { A }
const enum CE { A }
const enum CES { A = "a" }

namespace NS {
  export class K {}
  export class K2 {}
  export interface I {}
  export interface ICall { (): void }
  export enum E { A }
  export enum ES { A = "a" }
  export type T = string;
  export type TK = K;
  export const V = 1;
  export namespace Inner { export class K {} export interface I {} export namespace Deep { export class K {} } }
  export namespace Types { export interface I {} }
}
namespace NT { export interface I {} export type T = number; }
import AK1 = NS.K;
import AI1 = NS.I;
import AN1 = NS.Inner;
import AE1 = NS.E;
import AT1 = NS.T;

class M {} interface M { x: string }
class MN {} namespace MN { export class In {} export type T = string; }
function FI() {} interface FI { a: string }
function FN() {} namespace FN { export class In {} }
const CV = 1; type CV = string;
const CVK = class {}; type CVK = InstanceType<typeof CVK>;
const CVI = class {}; interface CVI {}
enum EMerge { A } namespace EMerge { export class In {} }

type TAny = any;
type TUnknown = unknown;
type TNever = never;
type TVoid = void;
type TUndef = undefined;
type TNull = null;
type TStr = string;
type TNum = number;
type TBool = boolean;
type TBig = bigint;
type TSym = symbol;
type TObj = object;
type TLitS = "a";
type TLitN = 1;
type TLitNeg = -1;
type TLitB = true;
type TLitBig = 1n;
type TLitTpl = \`a\`;
type TTpl = \`a\${string}\`;
type TUS = "a" | "b";
type TUSS = "a" | string;
type TUN = 1 | 2;
type TUB = true | false;
type TUBig = 1n | 2n;
type TUMix = "a" | 1;
type TUSN = string | number;
type TUNull = string | null;
type TUUndef = string | undefined;
type TUVoid = string | void;
type TUNever = string | never;
type TUAny = string | any;
type TUUnknown = string | unknown;
type TNullUndef = null | undefined;
type TVoidUndef = void | undefined;
type TNeverNull = never | null;
type TUK = K | K2;
type TUKNull = K | null;
type TUArr = string[] | number[];
type TUFn = (() => void) | ((a: string) => void);
type TUEnum = EN | ES;
type TUEnumN = EN | number;
type TUEnumMembers = EN.A | EN.B;
type TArr = string[];
type TRArr = readonly string[];
type TTup = [string];
type TTup0 = [];
type TRTup = readonly [string];
type TTupNamed = [a: string, b?: number];
type TTupRest = [...string[]];
type TArrArr = string[][];
type TFn = () => void;
type TFnG = <T>(a: T) => T;
type TNew = new () => K;
type TANew = abstract new () => K;
type TObjLit = { a: 1 };
type TEmptyLit = {};
type TCallLit = { (): void };
type TCallLitProps = { (): void; a: string };
type TNewLit = { new (): K };
type TIndexLit = { [k: string]: K };
type TK = K;
type TG = G<string>;
type TI = I;
type TICall = ICall;
type TINew = INew;
type TEN = EN;
type TES = ES;
type TEM = EM;
type TENA = EN.A;
type TNSK = NS.K;
type TNST = NS.T;
type TAlias2 = TStr;
type TAlias3 = TAlias2;
type TAliasArr = TArr;
type TAliasFn = TFn;
type TGen<T> = T;
type TGenS = TGen<string>;
type TGenK = TGen<K>;
type TGenArr<T> = T[];
type TGenArrS = TGenArr<string>;
type TGenIgnored<T> = string;
type TGenDefault<T = string> = T;
type TGenConstraint<T extends string> = T;
type TGenFn<T> = () => T;
type TGenUnion<T> = T | string;
type TBrand = string & { __b: 1 };
type TBrandN = number & { __b: 1 };
type TBrandArr = string[] & { __b: 1 };
type TBrandFn = (() => void) & { __b: 1 };
type TInter = K & I;
type TInterNever = string & number;
type TInterAny = string & any;
type TInterUnknown = string & unknown;
type TInterLit = string & "a";
type TKeyof = keyof K;
type TKeyofEmpty = keyof {};
type TKeyofAny = keyof any;
type TKeyofNum = keyof { 1: 1 };
type TKeyofIndex = keyof { [k: string]: 1 };
type TIdx = K["a"];
type TIdxN = K["n"];
type TIdxK = K["k"];
type TIdxUnion = K["a" | "n"];
type TIdxTuple = [string, number][0];
type TIdxArr = string[][number];
type TTypeofK = typeof K;
type TTypeofF = typeof F;
type TTypeofV = typeof V;
type TTypeofVS = typeof VS;
type TTypeofVL = typeof VL;
type TTypeofVO = typeof VO;
type TTypeofVSym = typeof VSym;
type TTypeofEN = typeof EN;
type TTypeofENA = typeof EN.A;
type TCondS = K extends I ? string : number;
type TCondN = K extends ICall ? string : number;
type TCondG<T> = T extends string ? 1 : "a";
type TCondGS = TCondG<"x">;
type TCondGN = TCondG<1>;
type TCondGBoth = TCondG<"x" | 1>;
type TCondInfer = string[] extends (infer U)[] ? U : never;
type TMapped = { [P in "a"]: string };
type TMappedArr = { [P in keyof string[]]: number };
type TMappedG<T> = { [P in keyof T]: T[P] };
type TMappedGArr = TMappedG<string[]>;
type TMappedGTup = TMappedG<[string]>;
type TRec = { next: TRec };
type TRecArr = TRecArr[];
type TRecUnion = string | TRecUnion[];
type TParen = (string);
type TParenU = ("a" | "b");
type TRO = readonly string[];
type TUpper = Uppercase<"a">;
type TThisless = { a: string }["a"];
type TUniqueHolder = { readonly s: unique symbol }["s"];
`;

/** Types valid wherever a type is. `T*` type parameters come from the enclosing class of the matrix. */
const types: string[] = [
  // keywords
  ...["any", "unknown", "never", "void", "undefined", "null", "string", "number", "boolean", "bigint", "symbol"],
  "object",
  "this",
  "unique symbol",
  // literals
  ...[`"a"`, `'a'`, "`a`", `""`, "1", "-1", "0", "0x10", "1e3", "1.5", "-1.5", "1n", "-1n", "0n", "true", "false"],
  "`a${string}`",
  "`${number}`",
  "`${string}-${number}`",
  '`${"a" | "b"}`',
  "`${K extends I ? 'a' : 'b'}`",
  // arrays and tuples
  ...["string[]", "string[][]", "K[]", "any[]", "never[]", "(string | number)[]", "(() => void)[]", "{}[]", "this[]"],
  ...["readonly string[]", "readonly K[]", "readonly string[][]", "readonly (string | K)[]", "readonly [string]"],
  ...["readonly []", "[]", "[string]", "[string, number]", "[a: string, b?: number]", "[string?]", "[...string[]]"],
  ...[
    "[string, ...number[]]",
    "[...[string], number]",
    "[a: string, ...rest: K[]]",
    "[[string]]",
    "[K]",
    "[() => void]",
  ],
  ...["readonly string", "readonly K", "readonly (string[])", "readonly (readonly string[])", "readonly TArr"],
  ...["readonly unknown", "readonly never", "readonly (string | null)[]", "readonly XC", "readonly Date"],
  // functions
  ...[
    "() => void",
    "(a: string) => K",
    "(...a: string[]) => void",
    "(a?: string) => void",
    "({ a }: { a: 1 }) => void",
  ],
  ...["([a]: [1]) => void", "(this: K) => void", "<T>() => T", "<T extends K>(a: T) => T", "<const T>(a: T) => T"],
  ...["new () => K", "new (a: string) => K", "new <T>() => T", "abstract new () => K", "abstract new <T>() => T"],
  ...["() => () => void", "() => string | number", "(a: unknown) => a is string", "(a: unknown) => asserts a"],
  ...["(a: unknown) => asserts a is string", "() => typeof K", "() => K[]", "() => new () => K"],
  // object types
  ...["{}", "{ a: string }", "{ a: string; b: number }", "{ a: string, b: number }", "{ (): void }", "{ new (): K }"],
  ...["{ [k: string]: K }", "{ readonly a: 1 }", "{ a?: 1 }", "{ m(): void }", "{ get a(): string }"],
  ...["{ set a(v: string) }", "{ <T>(a: T): T }", "{ -readonly [P in keyof K]-?: K[P] }", '{ [P in "a"]: K }'],
  ...['{ [P in "a" as `x${P}`]: K }', "{ readonly [P in keyof K]?: K[P] }", "{ a: { b: { c: K } } }"],
  // type operators and queries
  ...["typeof K", "typeof K.prototype", "typeof V", "typeof VO.a", "typeof F", "typeof globalThis", "typeof NS"],
  ...["typeof NS.K", "typeof G<string>", "typeof XC", "typeof this", "typeof EN", "typeof EN.A"],
  ...['typeof import("./dep")', 'typeof import("./dep").XC', 'import("./dep")', 'import("./dep").XC'],
  ...['import("./dep").XI', 'import("./dep").XNS2.K', 'import("./dep", { with: { "resolution-mode": "import" } }).XC'],
  ...[
    "keyof K",
    "keyof typeof K",
    "keyof any",
    "keyof {}",
    "keyof K[]",
    "keyof string",
    "keyof (K | K2)",
    "keyof K | K",
  ],
  ...["keyof K & string", "keyof keyof K"],
  ...['K["a"]', 'K["a"]["length"]', 'K["k"]["k"]', 'string["length"]', "K[keyof K]", "string[][number]", 'K["a"][]'],
  ...[
    'K[]["length"]',
    "[string, number][0]",
    'K["a" | "n"]',
    '(K | K2)["a"]',
    'K["a"] | string',
    'NS.K["a"]',
    'XC["a"]',
  ],
  // parentheses
  ...[
    "(string)",
    "((string))",
    "(((K)))",
    "(string | number)",
    "(string | null)",
    "(K)",
    "(() => void)",
    "(new () => K)",
  ],
  ...["(string)[]", "((string)[])", "(K | null)[]", "(typeof K)", "(typeof K)[]", "(keyof K)[]", "(any)", "(never)"],
  ...[
    "(null)",
    "(undefined)",
    "(void)",
    "(unknown)",
    "(XC)",
    "(NS.K)",
    "(Date)",
    "(readonly string[])",
    "(unique symbol)",
  ],
  // local classes
  ...["K", "K2", "AK", "Sub", "G<string>", "G<K>", "G<G<string>>", "G<G<G<string>>>", "G<() => void>", "G<string[]>"],
  ...["G<[string]>", "G<{ a: 1 }>", 'G<"a">', "G<typeof K>", "G<K | null>", "G", "K<string>", "Matrix"],
  // local interfaces
  ...["I", "I2", "IG<string>", "ICall", "ICallSub", "INew", "IBoth", "IArr"],
  // local values used as types
  ...["F", "FT", "V", "VS", "VL", "VK", "VO", "VO.K", "VO.a", "VSym"],
  // enums
  ...["EN", "ES", "EM", "EC", "ECmp", "ETpl", "ERef", "EEmpty", "EOne", "CE", "CES"],
  ...[
    "EN.A",
    "EN.B",
    "ES.A",
    "EM.A",
    "EM.B",
    "EC.A",
    "ECmp.A",
    "EOne.A",
    "CE.A",
    "CES.A",
    "ERef.A",
    "ERef.B",
    "EN.Missing",
  ],
  // namespaces
  ...["NS.K", "NS.K2", "NS.I", "NS.ICall", "NS.E", "NS.ES", "NS.E.A", "NS.T", "NS.TK", "NS.V", "NS.Missing", "NS"],
  ...["NS.Inner.K", "NS.Inner.I", "NS.Inner.Missing", "NS.Inner.Deep.K", "NS.Inner.Deep.Missing", "NS.Inner"],
  ...["NS.Missing.K", "NS.Missing.Deep.K", "NS.Missing.Deep.Deeper.K", "NS.Types.I", "NS.Types.Missing", "NS.Types"],
  ...["NS.K.Missing", "NS.K.prototype", "NT.I", "NT.T", "NT.Missing", "NT.Missing.K", "NT", "NS.K<string>"],
  ...["AK1", "AI1", "AN1.K", "AN1.I", "AN1.Deep.K", "AE1", "AE1.A", "AT1", "AN1"],
  // merged declarations
  ...["M", "MN", "MN.In", "MN.T", "FI", "FN", "FN.In", "CV", "CVK", "CVI", "EMerge", "EMerge.In", "EMerge.A"],
  // type parameters
  ...[
    "T",
    "TPS",
    "TPN",
    "TPB",
    "TPK",
    "TPA",
    "TPF",
    "TPD",
    "TPU",
    "TPLit",
    "TPT",
    "TPEN",
    "TPNull",
    "TPKeyof",
    "TPObj",
  ],
  ...["T[]", "T | null", "T | string", "TPS | string", "TPS | TPS", "T & K", 'T["a"]', "TPK | K", "G<T>", "keyof T"],
  // aliases
  ...[...declarations.matchAll(/^type (\w+)(<[^=]*>)? =/gm)].map(m =>
    m[2] ? `${m[1]}<${m[2].includes("extends string") ? '"a"' : "K"}>` : m[1],
  ),
  ...["TGen<string>", "TGen<number>", "TGen<string[]>", "TGen<() => void>", "TGen<EN>", "TGen<T>", "TGen<TPS>"],
  ...[
    "TGenArr<K>",
    "TGenDefault",
    "TGenUnion<string>",
    "TGenUnion<number>",
    "TGenFn<K>",
    "TCondG<string>",
    "TCondG<T>",
  ],
  ...["TMappedG<K>", "TMappedG<string>", "TMappedG<K[]>", "TStr[]", "TStr | TStr", "TStr | string", "TStr | TNum"],
  ...[
    "TStr | null",
    "TArr | TArr",
    "TArr | string[]",
    "TFn | TFn",
    "TFn | (() => void)",
    "TK | K",
    "TK | TK",
    "TNull | K",
  ],
  ...["TNever | K", "TAny | K", "TUnknown | K", "TUnknown & K", "TNever & K", "TVoid | K", "TUndef | TNull"],
  // globals
  ...["Object", "Function", "String", "Number", "Boolean", "Symbol", "BigInt", "Array", "Array<string>", "Array<K>"],
  ...["ReadonlyArray<string>", "Promise<string>", "Promise<void>", "Promise", "PromiseLike<string>", "Date", "RegExp"],
  ...[
    "Error",
    "TypeError",
    "Map<string, K>",
    "Set<K>",
    "WeakMap<K, K>",
    "WeakSet<K>",
    "WeakRef<K>",
    "ReadonlyMap<K, K>",
  ],
  ...["Uint8Array", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Float64Array", "BigInt64Array", "ArrayBufferView"],
  ...["Iterable<K>", "Iterator<K>", "AsyncIterable<K>", "Generator<K>", "AsyncGenerator<K>", "IterableIterator<K>"],
  ...[
    "Record<string, K>",
    "Partial<K>",
    "Required<K>",
    "Readonly<K>",
    'Pick<K, "a">',
    'Omit<K, "a">',
    "NonNullable<K>",
  ],
  ...["NonNullable<string | null>", "ReturnType<typeof F>", "ReturnType<typeof FT>", "Parameters<typeof F>"],
  ...["InstanceType<typeof K>", "ConstructorParameters<typeof K>", "Awaited<Promise<string>>", 'Exclude<"a" | 1, 1>'],
  ...['Extract<"a" | 1, 1>', 'Uppercase<"a">', 'Lowercase<"A">', 'Capitalize<"a">', "ThisType<K>", "NoInfer<string>"],
  ...[
    "PropertyKey",
    "PropertyDescriptor",
    "TemplateStringsArray",
    "ClassDecorator",
    "MethodDecorator",
    "ThisParameterType<typeof F>",
  ],
  ...[
    "Intl.DateTimeFormat",
    "Intl.NumberFormat",
    "Intl.Collator",
    "Intl.Missing",
    "Intl.DateTimeFormatOptions",
    "Intl",
  ],
  ...[
    "JSON",
    "Math",
    "Reflect",
    "Atomics",
    "Proxy",
    "ProxyHandler<K>",
    "ProxyConstructor",
    "globalThis.Date",
    "globalThis",
  ],
  ...["globalThis.Missing", "globalThis.Intl.DateTimeFormat", "WebAssembly.Module", "WebAssembly.Missing"],
  ...["URL", "URLSearchParams", "Request", "Response", "Headers", "Blob", "File", "FormData", "AbortController"],
  ...[
    "AbortSignal",
    "Event",
    "EventTarget",
    "TextEncoder",
    "ReadableStream",
    "WebSocket",
    "Buffer",
    "Element",
    "Window",
  ],
  ...["HTMLElement", "Document", "NodeJS.Timeout", "NodeJS.ProcessEnv", "JSX.Element", "React.ReactNode", "Bun.Server"],
  ...["console", "process", "undefined2", "Missing", "Missing<string>", "Missing.K", "Missing.K.K", "Missing.A.B.C.D"],
  ...["NaN", "Infinity", "async", "of", "type", "as", "is", "asserts", "declare"],
  ...["namespace", "abstract", "out", "accessor", "satisfies", "override", "get"],
  ...["set", "from", "global", "constructor", "prototype"],
  ...["asserts.K", "is.K", "abstract.K", "type.K", "string.K", "any.K"],
  // imports
  ...["XC", "XC2", "XE", "XES", "XO", "XN", "XF", "XD", "XC<string>", "XC[]", "XC | null", "XC | undefined", "XC | XC"],
  ...[
    "XC | XC2",
    "XC & XC",
    "XC.Inner",
    "XC.notAClass",
    "XC.Missing",
    "XC.Missing.K",
    "XE.A",
    "XES.A",
    "XO.K",
    "XO.deep.K",
  ],
  ...["XO.n", "XO.missing", "XO.missing.K", "XO.deep.missing.K", "XN.K", "XNS2.K", "XNS2.Inner.K", "XNS2.Missing"],
  ...["XTC", "XTI", "XTE", "XIC", "XIT", "XTD", "XTC.Inner", "XTE.A", "XTC | null", "XTC[]", "XTC | XTC", "XTC | XC"],
  ...["XNS", "XNS.XC", "XNS.XE", "XNS.XI", "XNS.XT", "XNS.XN", "XNS.XO", "XNS.XO.K", "XNS.Missing", "XNS.Missing.K"],
  ...["XNS.XNS2.K", "XNS.XNS2.Inner.K", "XNS.default", "XNS.XC.Inner", "XNS.XE.A", "XNS.XC | null", "XNS.XC | XNS.XC"],
  ...["XNS.XC | XNS.XC2", "XNS.XC | XC", "XTNS", "XTNS.XC", "XTNS.XI", "XTNS.XE", "XTNS.XNS2.K", "XTNS.Missing"],
  // conditional types
  ...["K extends I ? string : string", "K extends I ? string : number", "K extends I ? K : K", "K extends I ? K : K2"],
  ...[
    "K extends I ? never : string",
    "K extends I ? string : never",
    "K extends I ? any : string",
    "K extends I ? string : any",
  ],
  ...["K extends I ? unknown : string", "K extends I ? null : string", "K extends I ? string : undefined"],
  ...[
    "K extends I ? never : never",
    "K extends I ? null : undefined",
    "K extends I ? void : void",
    "K extends I ? XC : XC",
  ],
  ...[
    "K extends I ? XC : never",
    "K extends I ? Missing : Missing",
    "K extends I ? Missing : never",
    "K extends I ? Date : Date",
  ],
  ...["K extends I ? Missing.K : Missing.K", "K extends I ? NS.K : NS.K", "K extends I ? XNS.XC : XNS.XC"],
  ...["K extends I ? string : K extends I ? string : string", "K extends I ? K extends I ? string : string : string"],
  ...["K extends I ? string : K extends I ? number : string", "K extends (infer U)[] ? U : never"],
  ...["K extends (infer U extends string)[] ? U : string", "K extends I ? (K extends I ? XC : XC) : XC"],
  ...[
    "K extends I ? Missing | Missing : Missing",
    "K extends I ? Missing[] : Missing[]",
    "K extends I ? G<Missing> : G<Missing>",
  ],
  ...[
    "K extends I ? () => Missing : () => void",
    "(K extends I ? Missing : Missing) | Missing",
    "Missing | (K extends I ? Missing : Missing)",
  ],
  ...["(K extends I ? XC : XC) | XC", "(K extends I ? K : K) | K", "K extends string | number ? string : string"],
  ...[
    "K | K2 extends I ? string : string",
    "string | K extends I ? string : string",
    "K extends I ? string | number : string",
  ],
  ...[
    "K extends I ? string : string | number",
    "K extends I ? string : string | string",
    "K extends I ? string & K : string",
  ],
  ...[
    "K extends () => infer R ? R : string",
    "K extends new () => infer R ? string : string",
    "T extends string ? T : T",
  ],
  ...[
    "K extends I ? string[] : number[]",
    "K extends I ? [string] : number[]",
    "K extends I ? () => void : new () => K",
  ],
  ...['K extends I ? "a" : "b"', 'K extends I ? "a" : string', "K extends I ? 1 : 2", "K extends I ? true : false"],
  ...[
    "K extends I ? 1n : bigint",
    "K extends I ? symbol : symbol",
    "K extends I ? object : string",
    "K extends I ? {} : {}",
  ],
  // unions and intersections that need more than two parts, or a shape the pairs below do not have
  ...["| string", "| string | number", "& string", "& K & K", "| K", "| null", "| null | K", "| (| K)", "& (& K)"],
  ...[
    "string | string | string",
    "string | string | number",
    "K | K | K",
    "K | K | K2",
    "K | null | K",
    "null | K | null",
  ],
  ...["null | undefined | K", "K | null | undefined", "null | undefined | never", "never | never", "null | null"],
  ...[
    "undefined | undefined",
    "void | void",
    "void | undefined",
    "void | null",
    "void | never",
    "void | string",
    "K | void",
  ],
  ...[
    "string | (string | string)",
    "string | (string | number)",
    "(string | null) | string",
    "(K | null) | (K | undefined)",
  ],
  ...[
    "(null) | K",
    "K | (null)",
    "(never) | K",
    "(any) | K",
    "K | (any)",
    "(unknown) | K",
    "((null)) | K",
    "(undefined) | (null)",
  ],
  ...["string & string & string", "K & K & K", "K & unknown & K", "unknown & unknown", "unknown & K", "K & unknown"],
  ...["never & K", "K & never", "K & K2 & never", "any & never", "never & any", "any & K", "K & any", "unknown & any"],
  ...[
    "(never) & K",
    "K & (never)",
    "(unknown) & K",
    "null & K",
    "K & null",
    "undefined & K",
    "null & undefined",
    "null & null",
  ],
  ...[
    "string | number & K",
    "string & K | number",
    "K & K | K",
    "K | K & K",
    "K & K2 | K",
    "K | K & K2",
    "(K | K) & K",
  ],
  ...["K & (K | K)", "(K | K2) & K", "K & never | K", "K | never & K", "K | K & never", "never & K | never & K"],
  ...[
    "unknown & K | K",
    "K | unknown & K",
    "any & K | K",
    "string & {} | string",
    "string | string & {}",
    "(string & {}) | string",
  ],
  ...[
    '"a" | (string & {})',
    '"a" | "b" | (string & {})',
    "K | K[]",
    "K[] | K[]",
    "K[] | K2[]",
    "K[] | [K]",
    "K[] | readonly K[]",
  ],
  ...[
    "(() => void) | (() => string)",
    "(() => void) | (new () => K)",
    "(() => void) | Function",
    "Function | Function",
  ],
  ...[
    "Function | (() => void)",
    "Object | K",
    "K | Object",
    "Object | Object",
    "Object & K",
    "String | string",
    "string | String",
  ],
  ...[
    "String | String",
    "Number | number",
    "Boolean | boolean",
    "Symbol | symbol",
    "BigInt | bigint",
    "Array<K> | K[]",
    "K[] | Array<K>",
  ],
  ...[
    "Array<K> | Array<K>",
    "Promise<K> | Promise<K>",
    "Promise<K> | Promise<string>",
    "Promise<K> | K",
    "Promise<K> | null",
  ],
  ...[
    "Date | Date",
    "Date | null",
    "Date | string",
    "Date | Date | null",
    "Date | RegExp",
    "Missing | Missing",
    "Missing | null",
  ],
  ...[
    "Missing | Missing2",
    "Missing.K | Missing.K",
    "Missing.K | Missing.K2",
    "Missing.K | Missing2.K",
    "Missing.A.B | Missing.A.B",
  ],
  ...[
    "Missing.A.B | Missing.A.C",
    "Missing | Missing.K",
    "Missing.A.B.C | Missing.A.B.C",
    "NS.K | NS.K",
    "NS.K | NS.K2",
    "NS.K | null",
  ],
  ...[
    "NS.K | K",
    "K | NS.K",
    "NS.Inner.K | NS.Inner.K",
    "NS.Inner.K | NS.K",
    "NS.K & NS.K",
    "NS.Missing | NS.Missing",
    "XO.K | XO.K",
  ],
  ...[
    "EN | EN",
    "EN | number",
    "EN | ES",
    "EN | null",
    "EN.A | EN.B",
    "EN.A | 1",
    "ES.A | string",
    "ES | string",
    "EN | K",
  ],
  ...[
    "I | I",
    "I | K",
    "K | I",
    "I | null",
    "I & K",
    "K & I",
    "ICall | ICall",
    "ICall | (() => void)",
    "ICall | null",
    "ICall | I",
  ],
  ...[
    "T | T",
    "T | K",
    "K | T",
    "T & T",
    "TPS | null",
    "TPK | null",
    "this | this",
    "this | K",
    "K | this",
    "this | null",
  ],
  ...[
    "typeof K | typeof K",
    "typeof K | K",
    "K | typeof K",
    "keyof K | keyof K",
    'K["a"] | K["a"]',
    "unique symbol | symbol",
  ],
  ...[
    "symbol | unique symbol",
    "`a` | `b`",
    "`a${string}` | string",
    '"a" | `b${string}`',
    "1 | -1",
    "1n | -1n",
    "1 | 1n",
  ],
  ...[
    "true | false",
    "true | boolean",
    "true | 1",
    '"a" | "b" | "c" | 1',
    "0 | 1 | 2 | null",
    '"a" | undefined',
    "true | null",
  ],
  ...[
    "{} | {}",
    "{} | null",
    "{ a: 1 } | K",
    "K | { a: 1 }",
    "[K] | [K]",
    "[K] | null",
    "readonly K[] | null",
    "readonly K[] | K[]",
  ],
];

/** Parts for every pair `A | B`, `A & B` and `X extends Y ? A : B`. */
const parts: string[] = [
  ...["any", "unknown", "never", "void", "undefined", "null", "string", '"a"', "number", "1", "boolean", "true"],
  ...["bigint", "1n", "symbol", "object", "{}", "this", "string[]", "[string]", "() => void", "K", "K2", "I", "ICall"],
  ...["NS.K", "NS.K2", "EN", "ES", "TStr", "TK", "TNull", "TNever", "TAny", "T", "TPS", "Object", "Function", "String"],
  ...[
    "Date",
    "Promise<K>",
    "Array<K>",
    "Missing",
    "Missing2",
    "Missing.K",
    "Missing.A.B",
    "XC",
    "XC2",
    "XE",
    "XTC",
    "XNS.XC",
  ],
  ...["XNS.XI", "(K | null)", "(K & K)", "(string | number)", "typeof K", "keyof K", "`a${string}`", "readonly K[]"],
];

/** Types valid only as a return type. */
const returnTypes: string[] = [
  ...["a is string", "a is K", "a is any", "a is never", "a is XC", "a is Missing", "this is K", "this is string"],
  ...["asserts a", "asserts a is string", "asserts a is K", "asserts this", "asserts this is K", "asserts a is XC"],
  ...["asserts", "asserts | null", "asserts[]", "is", "a", "asserts.K", "asserts<string>"],
];

const typeParameters =
  "<T, TPS extends string, TPN extends number, TPB extends boolean, TPK extends K, TPA extends any[], " +
  'TPF extends () => void, TPD = string, TPU extends string | number, TPLit extends "a" | "b", TPT extends TPS, ' +
  "TPEN extends EN, TPNull extends null, TPKeyof extends keyof K, TPObj extends object>";

type Position = "prop" | "param" | "return" | "rest";

/** One member per type, in classes of at most 1000 members. */
function matrix(name: string, list: string[], position: Position): Case[] {
  const member = {
    prop: (type: string, i: number) => `  @d m${i}: ${type};`,
    param: (type: string, i: number) => `  @d m${i}(a: ${type}) {}`,
    return: (type: string, i: number) => `  @d m${i}(a?: any): ${type} { return null!; }`,
    rest: (type: string, i: number) => `  @d m${i}(...a: ${type}) {}`,
  }[position];
  const matrices: Case[] = [];
  for (let start = 0; start < list.length; start += 1000) {
    const types = list.slice(start, start + 1000);
    matrices.push({
      name: `${name}/${position}/${start}`,
      types,
      files: {
        "dep.ts": header + dep,
        "main.ts": `${header}${imports}${declarations}class Matrix${typeParameters} {\n${types.map(member).join("\n")}\n}`,
      },
    });
  }
  return matrices;
}

function pairs(): string[] {
  const list: string[] = [];
  const inPair = (part: string) => (part.includes("=>") ? `(${part})` : part);
  for (const a of parts) {
    for (const b of parts) {
      list.push(`${inPair(a)} | ${inPair(b)}`, `${inPair(a)} & ${inPair(b)}`, `K extends I ? ${a} : ${b}`);
    }
  }
  return list;
}

function triples(): string[] {
  const few = ["any", "unknown", "never", "null", "undefined", "void", "string", "K", "K2", "Missing", "XC", "Object"];
  const list: string[] = [];
  for (const a of few) {
    for (const b of few) {
      for (const c of few) {
        list.push(`${a} | ${b} | ${c}`, `${a} & ${b} & ${c}`, `${a} | ${b} & ${c}`, `${a} & ${b} | ${c}`);
        list.push(`(${a} | ${b}) & ${c}`, `${a} & (${b} | ${c})`, `K extends I ? ${a} | ${b} : ${c}`);
      }
    }
  }
  return list;
}

/** A program of its own, because it may throw, or because what matters is the whole program. */
const members = `
class K {}
class K2 {}
`;

/** Which keys each kind of declaration gets, and in which order. */
const shapes: Case[] = [
  // properties
  program("property", `class C { @d a: string; @d b; @d c = 1; @d d: number = 1; @d e?: string; @d f!: string; }`),
  program("property/static", `class C { @d static a: string; @d static b = 1; @d static readonly c: number = 1; }`),
  program(
    "property/modifiers",
    `class C { @d public a: string; @d private b: number; @d protected c: boolean; @d readonly e: string; @d public static readonly f: number; @d override g: string; }`,
  ),
  program("property/declare", `class C { @d declare a: string; @d declare static b: number; }`),
  program("property/abstract", `abstract class C { @d abstract a: string; @d abstract b; }`),
  program(
    "property/keys",
    `const k = "computed"; const s = Symbol("s");
class C { @d "quoted": string; @d 1: number; @d [k]: boolean; @d [s]: string; @d ["lit"]: number; @d 0x10: string; @d 1n: string; @d [1 + 1]: K; }
class K {}`,
  ),
  program("property/several decorators", `class C { @d @d @d a: string; }`),
  program(
    "property/decorator call",
    `const f = () => d; class C { @f() a: string; @(d) b: number; @f() @d c: boolean; }`,
  ),
  program(
    "property/arrow initializer",
    `class C { @d a = () => {}; @d b: () => void = () => {}; @d c = function () {}; }`,
  ),
  program(
    "property/no semicolons",
    `class K {}\nclass C {\n  @d a: string\n  @d b: number\n  @d c\n  @d e: K\n  m() {}\n}`,
  ),
  program("property/type then newline", `class K {}\nclass C {\n  @d a: K\n  ["b"]: string\n  @d c: K\n}`),

  // methods
  program(
    "method",
    `${members}class C { @d a() {} @d b(x: string, y: number): boolean { return true; } @d c(x): K { return null!; } }`,
  ),
  program("method/static", `${members}class C { @d static a(x: K): K2 { return null!; } }`),
  program(
    "method/async",
    `class C { @d async a() {} @d async b(): Promise<string> { return ""; } @d async c(): Promise<void> {} }`,
  ),
  program(
    "method/generator",
    `class C { @d *a() {} @d *b(): Generator<string> {} @d async *c() {} @d async *e(): AsyncGenerator<string> {} @d *f(): Iterable<number> {} }`,
  ),
  program("method/optional", `class C { @d a?() {} @d b?(x: string): number { return 1; } }`),
  program("method/abstract", `abstract class C { @d abstract a(x: string): number; @d abstract b(); }`),
  program(
    "method/overloads",
    `class C { a(x: string): string; a(x: number): number; @d a(x: any): any {} }
class E { @d a(x: string): string; a(x: number): number; a(x: any): any {} }
class F { @d a(x: string): string; @d a(x: number): number; @d a(x: boolean): boolean { return x; } }`,
  ),
  program(
    "method/type parameters",
    `class K {}\nclass C { @d a<T>(x: T): T { return x; } @d b<T extends string>(x: T): T { return x; } @d c<K>(x: K): K { return x; } }`,
  ),
  program(
    "method/keys",
    `const k = "computed"; const s = Symbol("s");
class C { @d "quoted"(x: string) {} @d 1(x: number) {} @d [k](x: boolean) {} @d [s](): string { return ""; } @d constructor2() {} @d "constructor2"() {} }`,
  ),
  program(
    "method/named get set async static",
    `class C { @d get() {} @d set(x: string) {} @d async() {} @d static() {} @d static static(x: number) {} @d readonly() {} @d declare() {} @d abstract() {} @d accessor() {} }`,
  ),
  program(
    "method/this parameter",
    `${members}class C { @d a(this: C) {} @d b(this: C, x: string) {} @d c(this: K, x: string, y: K2): void {} @d static e(this: typeof C, x: number) {} }`,
  ),
  program(
    "method/parameters",
    `${members}class C { @d a(x?: string) {} @d b(x: string = "") {} @d c(x = 1) {} @d e(x = new K()) {} @d f({ x }: { x: string }) {} @d g([x]: string[]) {} @d h({ x }) {} @d i([x]) {} @d j({ x }: K = new K()) {} @d k(x?: K, y?: K2) {} @d l(x: K | undefined = undefined) {} }`,
  ),
  program(
    "method/rest",
    `${members}class C { @d a(...x) {} @d b(...x: string[]) {} @d c(...x: K[]) {} @d e(y: number, ...x: K[]) {} @d f(...x: Array<K>) {} @d g(...x: [string, number]) {} @d h(...x: any) {} @d i(...x: readonly K[]) {} @d j(...x: ReadonlyArray<K>) {} @d k(...x: K[][]) {} @d l(...x: (K | null)[]) {} @d m(...x: Array<K | K2>) {} @d n(...x: Array<string>) {} @d o(...[x]: K[]) {} @d q(...{ length }: K[]) {} @d r(...x: K[] | K2[]) {} @d s(...x: (K[])) {} @d t(...x: Array) {} @d u(...x: Array<K, K2>) {} @d v(...x: globalThis.Array<K>) {} @d w(...x: Set<K>) {} @d y(...x: [...K[]]) {} }`,
  ),
  program(
    "method/rest with a local Array",
    `class K {}\nclass Array<T> {}\nclass C { @d a(...x: Array<K>) {} @d b(x: Array<K>) {} }`,
  ),
  program(
    "method/return",
    `${members}class C { @d a(): void {} @d b(): undefined {} @d c(): never { throw 1; } @d e(): null { return null; } @d f(): any {} @d g(): unknown { return 1; } @d h(): this { return this; } @d i(): K | null { return null; } }`,
  ),
  program("method/several decorators", `class C { @d @d a(@p @p x: string, @p y: number) {} }`),

  // parameter decorators
  program(
    "parameter decorator/method",
    `${members}class C { a(@p x: string) {} b(@p x: K, y: K2): number { return 1; } c(x: K, @p y: K2): string { return ""; } e(x: K, y: K2, @p z: number) {} }`,
  ),
  program(
    "parameter decorator/with a method decorator",
    `${members}class C { @d a(@p x: K, y: K2): K { return x; } @d b(x: K, @p y: K2): K2 { return y; } }`,
  ),
  program("parameter decorator/static method", `${members}class C { static a(x: K, @p y: K2): K { return x; } }`),
  program(
    "parameter decorator/constructor",
    `${members}class C { constructor(@p x: K, y: K2) {} }\nclass E { constructor(x: K, @p y: K2) {} }\nclass F { constructor(x: K, y: string, @p z: K2) {} }`,
  ),
  program(
    "parameter decorator/constructor with a class decorator",
    `${members}@d class C { constructor(@p x: K, @p y: K2) {} }`,
  ),
  program(
    "parameter decorator/setter",
    `${members}class C { set a(@p v: K) {} }\nclass E { get a(): K2 { return null!; } set a(@p v: K) {} }\nclass F { set a(@p v: K) {} get a(): K2 { return null!; } }`,
  ),
  program("parameter decorator/rest", `${members}class C { a(x: string, @p ...y: K[]) {} b(@p ...y: K2[]) {} }`),
  program(
    "parameter decorator/this parameter",
    `${members}class C { a(this: C, @p x: K) {} b(this: C, x: K, @p y: K2) {} }`,
  ),
  program(
    "parameter decorator/async and generator",
    `${members}class C { async a(@p x: K) {} *b(@p x: K) {} async *c(@p x: K) {} }`,
  ),
  program(
    "parameter decorator/default value",
    `${members}class C { a(@p x: K = new K(), y = 1) {} b(x = 1, @p y: K2 = new K2()) {} }`,
  ),
  program("parameter decorator/destructuring", `${members}class C { a(@p { x }: K, [y]: K2[]) {} }`),
  program(
    "parameter decorator/overloads",
    `${members}class C { a(x: string): void; a(@p x: K): void {} }\nclass E { constructor(x: string); constructor(@p x: K) {} }`,
  ),
  program(
    "parameter decorator/parameter property",
    `${members}class C { constructor(@p public x: K, @p private readonly y: K2, protected z: string) {} }`,
  ),
  program(
    "parameter decorator/nested function is not the method",
    `${members}class C { a(x: K) { return function (y: K2) {}; } @d b(x: K) { return (y: K2): string => ""; } }`,
  ),
  program(
    "parameter decorator/return type only",
    `${members}class C { a(@p x): K { return x; } b(@p x): Promise<K> { return x; } async c(@p x) {} }`,
  ),

  // accessors
  program(
    "accessor/getter",
    `${members}class C { @d get a(): K { return null!; } @d get b() { return 1; } @d static get c(): string { return ""; } }`,
  ),
  program("accessor/setter", `${members}class C { @d set a(v: K) {} @d set b(v) {} @d static set c(v: string) {} }`),
  program(
    "accessor/pair, getter first and decorated",
    `${members}class C { @d get a(): K { return null!; } set a(v: K) {} }`,
  ),
  program(
    "accessor/pair, getter first, setter decorated",
    `${members}class C { get a(): K { return null!; } @d set a(v: K) {} }`,
  ),
  program(
    "accessor/pair, setter first and decorated",
    `${members}class C { @d set a(v: K) {} get a(): K { return null!; } }`,
  ),
  program(
    "accessor/pair, setter first, getter decorated",
    `${members}class C { set a(v: K) {} @d get a(): K { return null!; } }`,
  ),
  program(
    "accessor/pair, different types, getter decorated",
    `${members}class C { @d get a(): K { return null!; } set a(v: K2) {} }`,
  ),
  program(
    "accessor/pair, different types, setter decorated",
    `${members}class C { get a(): K { return null!; } @d set a(v: K2) {} }`,
  ),
  program(
    "accessor/pair, different types, setter first",
    `${members}class C { set a(v: K2) {} @d get a(): K { return null!; } }`,
  ),
  program(
    "accessor/pair, only the getter has a type, getter decorated",
    `${members}class C { @d get a(): K { return null!; } set a(v) {} }`,
  ),
  program(
    "accessor/pair, only the getter has a type, setter decorated",
    `${members}class C { get a(): K { return null!; } @d set a(v) {} }`,
  ),
  program(
    "accessor/pair, only the setter has a type, getter decorated",
    `${members}class C { @d get a() { return null!; } set a(v: K) {} }`,
  ),
  program(
    "accessor/pair, only the setter has a type, setter decorated",
    `${members}class C { get a() { return null!; } @d set a(v: K) {} }`,
  ),
  program("accessor/pair, no types", `class C { @d get a() { return 1; } set a(v) {} }`),
  program(
    "accessor/pair, static and instance are different properties",
    `${members}class C { @d get a(): K { return null!; } static set a(v: K2) {} }\nclass E { @d static get a(): K { return null!; } set a(v: K2) {} }`,
  ),
  program(
    "accessor/pair, other members between",
    `${members}class C { @d get a(): K { return null!; } m() {} x = 1; set a(v: K2) {} }`,
  ),
  program(
    "accessor/pair, keys",
    `${members}const k = "c"; const s = Symbol();
class C { @d get "a"(): K { return null!; } set a(v: K2) {} }
class E { @d get a(): K { return null!; } set "a"(v: K2) {} }
class F { @d get 1(): K { return null!; } set 1(v: K2) {} }
class G { @d get 1(): K { return null!; } set "1"(v: K2) {} }
class H { @d get [k](): K { return null!; } set [k](v: K2) {} }
class J { @d get ["a"](): K { return null!; } set a(v: K2) {} }
class L { @d get [s](): K { return null!; } set [s](v: K2) {} }
class N { @d get 1(): K { return null!; } set 1.0(v: K2) {} }
class O { @d get 0x1(): K { return null!; } set 1(v: K2) {} }
class Q { @d get [1](): K { return null!; } set 1(v: K2) {} }`,
  ),
  program(
    "accessor/setter with a this parameter",
    `${members}class C { @d set a(this: C, v: K) {} }\nclass E { @d get a(): K2 { return null!; } set a(this: E, v: K) {} }`,
  ),
  program("accessor/getter with a this parameter", `${members}class C { @d get a(this: C): K { return null!; } }`),
  program("accessor/setter with a default value", `${members}class C { @d set a(v: K = new K()) {} }`),
  program("accessor/setter with a return type", `${members}class C { @d set a(v: K): K2 {} }`),
  program("accessor/abstract", `${members}abstract class C { @d abstract get a(): K; @d abstract set b(v: K2); }`),
  program("accessor/abstract pair", `${members}abstract class C { @d abstract get a(): K; abstract set a(v: K2); }`),
  program(
    "accessor/two getters",
    `${members}class C { @d get a(): K { return null!; } get a(): K2 { return null!; } }`,
  ),
  program(
    "accessor/two setters",
    `${members}class C { @d get a(): K { return null!; } set a(v: K2) {} set a(v: string) {} }`,
  ),
  program(
    "accessor/getter and a method of the same name",
    `${members}class C { @d get a(): K { return null!; } a(v: K2) {} }`,
  ),
  program(
    "accessor/getter and a property of the same name",
    `${members}class C { @d get a(): K { return null!; } a: K2; }`,
  ),

  // classes
  program("class/no constructor", `@d class C {}`),
  program("class/empty constructor", `@d class C { constructor() {} }`),
  program("class/constructor", `${members}@d class C { constructor(x: K, y: K2, z: string) {} }`),
  program("class/derived without a constructor", `${members}class B { constructor(x: K) {} }\n@d class C extends B {}`),
  program(
    "class/derived with a constructor",
    `${members}class B { constructor(x: K) {} }\n@d class C extends B { constructor(y: K2) { super(null!); } }`,
  ),
  program(
    "class/constructor overloads",
    `${members}@d class C { constructor(x: K); constructor(x: K2); constructor(x: any) {} }`,
  ),
  program("class/constructor declaration only", `${members}@d class C { constructor(x: K); }`),
  program("class/quoted constructor", `${members}@d class C { "constructor"(x: K) {} }`),
  program("class/computed constructor is a method", `${members}@d class C { ["constructor"](x: K) {} }`),
  program(
    "class/parameter properties",
    `${members}@d class C { constructor(public x: K, private y: K2, readonly z: string, protected w?: number) {} }`,
  ),
  program(
    "class/constructor parameters",
    `${members}@d class C { constructor(x?: K, y: K2 = new K2(), z = 1, { a }: { a: 1 } = null!, ...rest: K[]) {} }`,
  ),
  program("class/constructor with a this parameter", `${members}@d class C { constructor(this: C, x: K) {} }`),
  program("class/several decorators", `${members}@d @d class C { constructor(x: K) {} }`),
  program("class/abstract", `${members}@d abstract class C { constructor(x: K) {} }`),
  program("class/type parameters", `@d class C<T, U extends string> { constructor(x: T, y: U) {} }`),
  program("class/private constructor", `${members}@d class C { private constructor(x: K) {} }`),
  program(
    "class/members are not decorated by the class decorator",
    `${members}@d class C { a: K; m(x: K): K2 { return null!; } get g(): K { return null!; } }`,
  ),
  program(
    "class/everything",
    `${members}@d class C { @d a: K; @d static b: K2; constructor(@p x: K) {} @d m(@p x: K): K2 { return null!; } @d static n(@p x: K2) {} @d get g(): K { return null!; } @d static set s(v: K2) {} }`,
  ),
  program("class/export", `${members}@d export class C { constructor(x: K) {} }`),
  program("class/export after the decorator", `${members}export @d class C { constructor(x: K) {} }`),
  program("class/export default", `${members}@d export default class C { constructor(x: K) {} }`),
  program("class/export default after the decorator", `${members}export default @d class C { constructor(x: K) {} }`),
  program("class/export default without a name", `${members}@d export default class { constructor(x: K) {} }`),
  program("class/export default without a name, members", `${members}export default class { @d a: K; @d m(x: K2) {} }`),
  program("class/declare", `declare class K {}\n@d declare class C { constructor(x: K); @d a: K; }\nlog("ran");`),
  program(
    "class/refers to itself",
    `@d class C { @d a: C; @d static b: C; constructor(x: C) {} @d m(x: C): C { return x; } }`,
  ),
  program(
    "class/refers to itself in a union",
    `@d class C { @d a: C | null; @d b: C | C; @d c: C[]; constructor(x: C | undefined) {} }`,
  ),
  program(
    "class/decorated class renamed by the decorator",
    `const r = (c: any) => class Replaced {};\n@r class C { @d a: C; constructor(x: C) {} }\nlog(C.name);`,
  ),
  program(
    "class/static block",
    `${members}class C { static { log("static block"); } @d static a: K = (log("static field"), null!); @d b: K2; }`,
  ),
  program(
    "class/order of evaluation",
    `const f = (n: string) => (log("eval " + n), d);\nclass K {}\n@f("class") class C { @f("a") a: K; @f("static b") static b: K; constructor(@f("ctor param") x: K) {} @f("m") m(@f("m param") x: K) {} @f("static n") static n() {} @f("g") get g(): K { return null!; } }`,
  ),

  // class expressions
  program(
    "class expression/members",
    `${members}const C = class { @d a: K; @d m(x: K2): K { return null!; } @d static s: K2; };`,
  ),
  program(
    "class expression/named",
    `${members}const C = class Named { @d a: Named; @d m(x: K2): Named { return null!; } };`,
  ),
  program(
    "class expression/parameter decorator",
    `${members}const C = class { constructor(@p x: K) {} m(@p x: K2) {} };`,
  ),
  program(
    "class expression/in a call",
    `${members}function id<T>(x: T) { return x; }\nconst C = id(class { @d a: K; });`,
  ),
  program("class expression/extends", `${members}class C extends (class { @d a: K; }) { @d b: K2; }`),
  program(
    "class expression/in a field initializer",
    `${members}class C { @d a: K = new (class { @d b: K2; })() as any; }\nnew C();`,
  ),
  program(
    "class expression/in a decorator argument",
    `${members}const f = (x: any) => d;\nclass C { @f(class { @d b: K2; }) a: K; }`,
  ),
  program("class expression/returned", `${members}function make() { return class { @d a: K; }; }\nmake(); make();`),
  program("class expression/arrow body", `${members}const make = () => class { @d a: K; };\nmake();`),
  program("class expression/default export", `${members}export default (class { @d a: K; });`),

  // not classes
  program("object literal members are not decorated", `${members}class C { @d a: K = { m(x: K2) {} } as any; }`),
];

/** Where the name in a type is looked up, and what it finds. */
const scopes: Case[] = [
  // In a block, because Bun moves a class to the top of the file if it can.
  program("scope/class declared later", `{\nclass C { @d a: K; }\nclass K {}\n}`),
  program("scope/class declared later, parameter", `{\nclass C { @d m(x: K) {} }\nclass K {}\n}`),
  program("scope/class declared later, constructor", `{\n@d class C { constructor(x: K) {} }\nclass K {}\n}`),
  program("scope/class declared later, union with null", `{\nclass C { @d a: K | null; }\nclass K {}\n}`),
  program("scope/class declared later, array", `{\nclass C { @d a: K[]; }\nclass K {}\n}`),
  program(
    "scope/class declared later, type argument",
    `{\nclass C { @d a: Promise<K>; @d b: G<K>; }\nclass G<T> {}\nclass K {}\n}`,
  ),
  program("scope/class declared later in a namespace", `class C { @d a: NS.K; }\nnamespace NS { export class K {} }`),
  program("scope/enum declared later", `class C { @d a: E; @d b: E.A; }\nenum E { A }`),
  program("scope/string enum declared later", `class C { @d a: E; }\nenum E { A = "a" }`),
  program("scope/interface declared later", `class C { @d a: I; }\ninterface I {}`),
  program("scope/alias declared later", `class C { @d a: T; @d b: U; }\ntype T = string;\ntype U = T[];`),
  program("scope/function declared later", `class C { @d a: F; }\nfunction F() {}`),
  program("scope/var declared later", `class C { @d a: V; }\nvar V = class {};`),
  program("scope/let declared later", `class C { @d a: V; }\nlet V = class {};`),
  program("scope/import declared later", `class C { @d a: X; }\nimport { X } from "./dep.js";`, {
    "dep.ts": `export class X {}`,
  }),
  program("scope/two classes that refer to each other", `class A { @d b: B; }\nclass B { @d a: A; }`),
  program(
    "scope/two classes that refer to each other in a function",
    `function f() { class A { @d b: B; } class B { @d a: A; } }\nf();`,
  ),
  program("scope/used in a function called later", `function f() { class C { @d a: K; } }\nclass K {}\nf();`),
  program("scope/used in a function called earlier", `{\nfunction f() { class C { @d a: K; } }\nf();\nclass K {}\n}`),

  program("scope/function", `class K {}\nfunction f() { class K {} class C { @d a: K; } }\nf();`),
  program(
    "scope/function, local class shadows",
    `class K { static tag = "outer"; }\nfunction f() { class K { static tag = "inner"; } class C { @d a: K; } }\nf();`,
  ),
  program(
    "scope/function, local interface shadows a class",
    `class K {}\nfunction f() { interface K {} class C { @d a: K; } }\nf();`,
  ),
  program(
    "scope/function, local alias shadows a class",
    `class K {}\nfunction f() { type K = string; class C { @d a: K; } }\nf();`,
  ),
  program(
    "scope/function, local enum shadows a class",
    `class K {}\nfunction f() { enum K { A } class C { @d a: K; } }\nf();`,
  ),
  program(
    "scope/function, local class shadows an alias",
    `type K = string;\nfunction f() { class K {} class C { @d a: K; } }\nf();`,
  ),
  program(
    "scope/function, local class shadows an import",
    `import { K } from "./dep.js";\nfunction f() { class K {} class C { @d a: K; } }\nf();`,
    { "dep.ts": `log("dep evaluated");\nexport class K {}` },
  ),
  program(
    "scope/function, local variable shadows a class",
    `class K {}\nfunction f() { const K = 1; class C { @d a: K; } }\nf();`,
  ),
  program(
    "scope/function, parameter shadows a class",
    `class K {}\nfunction f(K: number) { class C { @d a: K; } }\nf(1);`,
  ),
  program(
    "scope/function, parameter shadows an interface",
    `interface K {}\nfunction f(K: any) { class C { @d a: K; } }\nf(class P {});`,
  ),
  program(
    "scope/function, type parameter shadows a class",
    `class K {}\nfunction f<K>() { class C { @d a: K; } }\nf();`,
  ),
  program(
    "scope/function, type parameter with a constraint",
    `function f<T extends string>() { class C { @d a: T; } }\nf();`,
  ),
  program(
    "scope/arrow function, type parameter shadows a class",
    `class K {}\nconst f = <K,>() => { class C { @d a: K; } };\nf();`,
  ),
  program("scope/method, type parameter shadows a class", `class K {}\nclass C { @d m<K>(x: K): K { return x; } }`),
  program(
    "scope/method, type parameter shadows a global",
    `class C { @d m<Date>(x: Date): Date { return x; } @d n<Promise>(): Promise { return null!; } }`,
  ),
  program(
    "scope/method, type parameter shadows an import",
    `import { K } from "./dep.js";\nclass C { @d m<K>(x: K): K { return x; } }`,
    { "dep.ts": `log("dep evaluated");\nexport class K {}` },
  ),
  program("scope/method, type parameter of another method", `class K {}\nclass C { m<K>(x: K) {} @d n(x: K) {} }`),
  program(
    "scope/class, type parameter shadows a class",
    `class K {}\nclass C<K> { @d a: K; @d m(x: K): K { return x; } }`,
  ),
  program(
    "scope/class, type parameter shadows a global",
    `class C<Date, Map> { @d a: Date; @d b: Map; constructor(x: Date) {} }`,
  ),
  program(
    "scope/class, type parameter shadows an import",
    `import { K } from "./dep.js";\n@d class C<K> { @d a: K; constructor(x: K) {} }`,
    { "dep.ts": `log("dep evaluated");\nexport class K {}` },
  ),
  program(
    "scope/class, type parameter in a static member",
    `class K {}\nclass C<K> { @d static a: K; @d static m(x: K) {} }`,
  ),
  program(
    "scope/class, type parameter of an outer class",
    `class K {}\nclass O<K> { m() { class C { @d a: K; } } }\nnew O().m();`,
  ),
  program("scope/class, type parameter named like the class", `class C<C> { @d a: C; }`),
  program(
    "scope/class, type parameter with a qualified name",
    `namespace K { export class In {} }\nclass C<K> { @d a: K.In; }`,
  ),
  program(
    "scope/class, member named like the type",
    `class K {}\nclass C { K = 1; @d a: K; static K = 2; @d static b: K; }`,
  ),
  program("scope/method, parameter named like the type", `class K {}\nclass C { @d m(K: K, x: K): K { return K; } }`),
  program("scope/constructor, parameter named like the type", `class K {}\n@d class C { constructor(K: K, x: K) {} }`),
  program(
    "scope/method, local named like the type",
    `class K {}\nclass C { @d m(x: K): K { const K = 1; return x; } }`,
  ),
  program("scope/infer shadows a class", `class K {}\nclass C { @d a: string[] extends (infer K)[] ? K : K; }`),
  program("scope/mapped type parameter shadows a class", `class K {}\nclass C { @d a: { [K in "a"]: K }; }`),
  program("scope/function type parameter shadows a class", `class K {}\nclass C { @d a: <K>() => K; @d b: K; }`),

  program(
    "scope/block",
    `class K { static tag = "outer"; }\n{ class K { static tag = "inner"; } class C { @d a: K; } }`,
  ),
  program("scope/block, interface shadows a class", `class K {}\n{ interface K {} class C { @d a: K; } }`),
  program(
    "scope/block, class declared later in the block",
    `class K {}\ntry { { class C { @d a: K; } class K {} } } catch (e: any) { log(e.name); }`,
  ),
  program("scope/if", `class K {}\nif (true) { class K {} class C { @d a: K; } }`),
  program("scope/for", `class K {}\nfor (const K of [1]) { class C { @d a: K; } }`),
  program("scope/switch", `class K {}\nswitch (1) { case 1: class K {} class C { @d a: K; } }`),
  program("scope/catch", `class K {}\ntry { throw 1; } catch (K) { class C { @d a: K; } }`),
  program("scope/static block", `class K {}\nclass O { static { class K {} class C { @d a: K; } } }`),
  program("scope/class expression name", `class K {}\nconst X = class K { @d a: K; };`),
  program("scope/function expression name", `class K {}\nconst X = function K() { class C { @d a: K; } };\nX();`),
  program("scope/label is not a binding", `class K {}\nK: { class C { @d a: K; } }`),

  program("scope/namespace", `namespace NS { export class K {} class C { @d a: K; @d b: NS.K; } }`),
  program("scope/namespace, not exported", `namespace NS { class K {} class C { @d a: K; } }`),
  program(
    "scope/namespace, shadows",
    `class K { static tag = "outer"; }\nnamespace NS { export class K { static tag = "inner"; } class C { @d a: K; } }`,
  ),
  program(
    "scope/namespace, interface shadows a class",
    `class K {}\nnamespace NS { export interface K {} class C { @d a: K; } }`,
  ),
  program(
    "scope/namespace, exported from another block",
    `namespace NS { export class K {} }\nnamespace NS { class C { @d a: K; @d b: NS.K; } }`,
  ),
  program(
    "scope/namespace, exported from another block, a type and then a value",
    `namespace NS { export class K { v = 7; } }\nnamespace NS { class C { @d m(k: K) {} } export const k = new K(); }\nshow(NS.k.v);`,
  ),
  program(
    "scope/namespace, exported enum from another block",
    `namespace NS { export enum E { A } }\nnamespace NS { class C { @d a: E; @d b: E.A; } }`,
  ),
  program(
    "scope/namespace, exported interface from another block",
    `class K {}\nnamespace NS { export interface K {} }\nnamespace NS { class C { @d a: K; } }`,
  ),
  program(
    "scope/namespace, not exported from another block",
    `class K { static tag = "outer"; }\nnamespace NS { class K {} }\nnamespace NS { class C { @d a: K; } }`,
  ),
  program(
    "scope/namespace, nested",
    `namespace A { export namespace B { export class K {} } class C { @d a: B.K; @d b: A.B.K; } }`,
  ),
  program(
    "scope/namespace, dotted",
    `namespace A.B { export class K {} class C { @d a: K; @d b: B.K; @d c: A.B.K; } }`,
  ),
  program(
    "scope/namespace, outer member",
    `namespace A { export class K {} export namespace B { class C { @d a: K; @d b: A.K; } } }`,
  ),
  program(
    "scope/namespace, exported class decorated",
    `namespace NS { export class K {} @d export class C { @d a: K; constructor(x: K) {} } }`,
  ),
  program("scope/namespace, exported variable", `namespace NS { export const K = class {}; class C { @d a: K; } }`),
  program(
    "scope/namespace, import alias",
    `namespace NS { export class K {} export interface I {} }\nnamespace O { import K = NS.K; import I = NS.I; class C { @d a: K; @d b: I; } }`,
  ),
  program(
    "scope/namespace, exported import alias",
    `namespace NS { export class K {} }\nnamespace O { export import K = NS.K; }\nclass C { @d a: O.K; }`,
  ),
  program(
    "scope/namespace, merged with a class",
    `class NS {}\nnamespace NS { export class K {} class C { @d a: K; @d b: NS; @d c: NS.K; } }`,
  ),
  program(
    "scope/namespace, merged with a function",
    `function NS() {}\nnamespace NS { export class K {} }\nclass C { @d a: NS.K; @d b: NS; }`,
  ),
  program(
    "scope/namespace, merged with an enum",
    `enum NS { A }\nnamespace NS { export class K {} }\nclass C { @d a: NS.K; @d b: NS; @d c: NS.A; }`,
  ),
  program(
    "scope/namespace, types only",
    `namespace NS { export interface I {} export type T = string; }\nclass C { @d a: NS.I; @d b: NS.T; @d c: NS.Missing; }`,
  ),
  program(
    "scope/namespace, types only, nested",
    `namespace NS { export namespace In { export interface I {} } }\nclass C { @d a: NS.In.I; @d b: NS.In.Missing; }`,
  ),
  program("scope/namespace, empty", `namespace NS {}\nclass C { @d a: NS.K; }`),
  program(
    "scope/namespace, const enum only",
    `namespace NS { export const enum E { A } }\nclass C { @d a: NS.E; @d b: NS.E.A; }`,
  ),
  program("scope/module keyword", `module NS { export class K {} }\nclass C { @d a: NS.K; }`),

  program("scope/declare class", `declare class K {}\nclass C { @d a: K; }`),
  program(
    "scope/declare class that exists",
    `(globalThis as any).DK = class DK {};\ndeclare class DK {}\nclass C { @d a: DK; }`,
  ),
  program("scope/declare class, union with null", `declare class K {}\nclass C { @d a: K | null; }`),
  program("scope/declare abstract class", `declare abstract class K {}\nclass C { @d a: K; }`),
  program(
    "scope/declare const with a construct signature",
    `declare const K: { new (): K };\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/declare var with a construct signature",
    `declare var K: { new (): K; prototype: K };\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/declare const with a constructor type",
    `declare const K: new () => K;\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/declare const without a construct signature",
    `declare const K: { a: 1 };\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/declare const of an interface with a construct signature",
    `interface KC { new (): K }\ndeclare const K: KC;\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/declare const typeof a class",
    `class B {}\ndeclare const K: typeof B;\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program("scope/declare const any", `declare const K: any;\ninterface K {}\nclass C { @d a: K; }`),
  program("scope/declare const without a type of that name", `declare const K: { new (): {} };\nclass C { @d a: K; }`),
  program("scope/declare function", `declare function K(): void;\nclass C { @d a: K; }`),
  program("scope/declare function and interface", `declare function K(): void;\ninterface K {}\nclass C { @d a: K; }`),
  program("scope/declare enum", `declare enum E { A }\nclass C { @d a: E; @d b: E.A; }`),
  program("scope/declare const enum", `declare const enum E { A }\nclass C { @d a: E; @d b: E.A; }`),
  program("scope/declare string enum", `declare enum E { A = "a" }\nclass C { @d a: E; }`),
  program("scope/declare namespace", `declare namespace NS { class K {} }\nclass C { @d a: NS.K; }`),
  program(
    "scope/declare namespace, interface",
    `declare namespace NS { interface I {} type T = string; enum E { A } }\nclass C { @d a: NS.I; @d b: NS.T; @d c: NS.E; }`,
  ),
  program("scope/declare namespace, missing", `declare namespace NS { class K {} }\nclass C { @d a: NS.Missing; }`),
  program(
    "scope/declare namespace that exists",
    `(globalThis as any).DNS = { K: class DNSK {} };\ndeclare namespace DNS { class K {} }\nclass C { @d a: DNS.K; }`,
  ),
  program("scope/declare module", `declare module "x" { export class K {} }\nclass C { @d a: K; }`),
  program("scope/declare global class", `declare global { class GK {} }\nclass C { @d a: GK; }\nexport {};`),
  program("scope/declare global interface", `declare global { interface GI {} }\nclass C { @d a: GI; }\nexport {};`),
  program(
    "scope/declare global interface named like a global",
    `declare global { interface Date { x: 1 } }\nclass C { @d a: Date; }\nexport {};`,
  ),
  program(
    "scope/declare global var",
    `declare global { var GV: { new (): GV }; interface GV {} }\nclass C { @d a: GV; }\nexport {};`,
  ),

  program(
    "scope/interface named like a global class",
    `interface Date {}\ninterface Map<K, V> {}\ninterface Request {}\nclass C { @d a: Date; @d b: Map<string, string>; @d c: Request; }`,
  ),
  program(
    "scope/alias named like a global class",
    `type Date = string;\ntype Promise<T> = T;\ntype Event = { a: 1 };\nclass C { @d a: Date; @d b: Promise<string>; @d c: Event; @d async m(): Promise<string> { return ""; } }`,
  ),
  program(
    "scope/class named like a global class",
    `class Date {}\nclass Promise<T> {}\nclass Object {}\nclass String {}\nclass C { @d a: Date; @d b: Promise<string>; @d c: Object; @d e: String; @d f: Object | string; @d g: string; @d h: object; }`,
  ),
  program(
    "scope/class named Object in a union",
    `class Object {}\nclass K {}\nclass C { @d a: Object | K; @d b: K | Object; @d c: Object | Object; @d e: Object | null; @d f: Object & K; }`,
  ),
  program(
    "scope/class named like a serialized global",
    `class Function {}\nclass Array {}\nclass Number {}\nclass Boolean {}\nclass Symbol {}\nclass BigInt {}\nclass C { @d a: () => void; @d b: string[]; @d c: number; @d e: boolean; @d f: symbol; @d g: bigint; @d m() {} }`,
  ),
  program("scope/class named Promise and an async method", `class Promise {}\nclass C { @d async m() {} }`),
  program("scope/enum named like a global class", `enum Date { A }\nclass C { @d a: Date; }`),
  program(
    "scope/type import named like a global class",
    `import type { Date, Promise } from "./dep.js";\nclass C { @d a: Date; @d b: Promise; }`,
    {
      "dep.ts": `log("dep evaluated");\nexport class Date {}\nexport class Promise {}`,
    },
  ),
  program("scope/variable named like a global class", `const Date = 1;\nclass C { @d a: Date; }`),
  program(
    "scope/undefined is shadowed",
    `function f(undefined: any) { class C { @d a: undefined; @d b: void; @d m() {} } }\nf(1);`,
  ),

  program("scope/merged class and interface", `class K {}\ninterface K { a: string }\nclass C { @d a: K; }`),
  program("scope/merged interface then class", `interface K { a: string }\nclass K {}\nclass C { @d a: K; }`),
  program(
    "scope/merged interfaces, one has a call signature",
    `interface K { a: string }\ninterface K { (): void }\nclass C { @d a: K; }`,
  ),
  program("scope/merged enums", `enum E { A }\nenum E { B = 1 }\nclass C { @d a: E; }`),
  program("scope/merged enums, number and string", `enum E { A }\nenum E { B = "b" }\nclass C { @d a: E; }`),
  program("scope/alias and variable", `const K = class {};\ntype K = string;\nclass C { @d a: K; }`),
  program("scope/alias and function", `function K() {}\ntype K = number;\nclass C { @d a: K; }`),
  program("scope/interface and variable holding a class", `const K = class {};\ninterface K {}\nclass C { @d a: K; }`),
  program("scope/interface and let holding a class", `let K = class {};\ninterface K {}\nclass C { @d a: K; }`),
  program("scope/interface and variable holding a number", `const K = 1;\ninterface K {}\nclass C { @d a: K; }`),
  program(
    "scope/interface and variable holding a function",
    `const K = function () {};\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/interface and variable holding an arrow function",
    `const K = () => {};\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/interface and variable holding another class",
    `class B {}\nconst K = B;\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/interface and variable holding a call",
    `function make() { return class {}; }\nconst K = make();\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/interface and annotated variable",
    `class B {}\nconst K: typeof B = B;\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program(
    "scope/interface and variable annotated any",
    `const K: any = class {};\ninterface K {}\nclass C { @d a: K; }`,
  ),
  program("scope/interface and function", `function K() {}\ninterface K {}\nclass C { @d a: K; }`),
  program("scope/interface and namespace", `namespace K { export const a = 1; }\ninterface K {}\nclass C { @d a: K; }`),
  program("scope/alias and namespace", `namespace K { export const a = 1; }\ntype K = string;\nclass C { @d a: K; }`),
  program(
    "scope/alias and enum-like object",
    `const E = { A: "a" } as const;\ntype E = (typeof E)[keyof typeof E];\nclass C { @d a: E; }`,
  ),
  program("scope/interface and import", `import { K } from "./dep.js";\ninterface K {}\nclass C { @d a: K; }`, {
    "dep.ts": `export class K {}`,
  }),

  program("scope/export class", `export class K {}\nexport class C { @d a: K; }`),
  program("scope/export default class", `export default class K {}\nclass C { @d a: K; }`),
  program("scope/export enum", `export enum E { A }\nexport class C { @d a: E; }`),
  program(
    "scope/export interface and alias",
    `export interface I {}\nexport type T = string;\nexport class C { @d a: I; @d b: T; }`,
  ),
  program("scope/export namespace", `export namespace NS { export class K {} }\nexport class C { @d a: NS.K; }`),
  program("scope/exported under another name", `class K {}\nexport { K as L };\nclass C { @d a: K; @d b: L; }`),
  program(
    "scope/unicode and escapes",
    `class Ünï {}\nclass $ {}\nclass _ {}\nclass K2 {}\nclass C { @d a: Ünï; @d b: $; @d c: _; @d e: \\u{4b}2; }`,
  ),
];

const classDep = { "dep.ts": `log("dep evaluated");\nexport class X {}\nexport class Y {}\nexport default class D {}` };

/** What an import turns into, and whether it stays. */
const importCases: Case[] = [
  program("import/class", `import { X } from "./dep.js";\nclass C { @d a: X; }`, classDep),
  program("import/class, renamed", `import { X as Z } from "./dep.js";\nclass C { @d a: Z; }`, classDep),
  program("import/class, string name", `import { "X" as Z } from "./dep.js";\nclass C { @d a: Z; }`, classDep),
  program("import/default", `import D from "./dep.js";\nclass C { @d a: D; }`, classDep),
  program("import/default as", `import { default as D } from "./dep.js";\nclass C { @d a: D; }`, classDep),
  program("import/namespace", `import * as ns from "./dep.js";\nclass C { @d a: ns.X; }`, classDep),
  program("import/namespace, default", `import * as ns from "./dep.js";\nclass C { @d a: ns.default; }`, classDep),
  program("import/default and named", `import D, { X } from "./dep.js";\nclass C { @d a: D; @d b: X; }`, classDep),
  program(
    "import/default and namespace",
    `import D, * as ns from "./dep.js";\nclass C { @d a: D; @d b: ns.X; }`,
    classDep,
  ),
  program("import/one of two is used", `import { X, Y } from "./dep.js";\nclass C { @d a: X; }`, classDep),
  program("import/parameter", `import { X } from "./dep.js";\nclass C { @d m(x: X) {} }`, classDep),
  program("import/return type", `import { X } from "./dep.js";\nclass C { @d m(): X { return null!; } }`, classDep),
  program("import/constructor", `import { X } from "./dep.js";\n@d class C { constructor(x: X) {} }`, classDep),
  program("import/parameter decorator", `import { X, Y } from "./dep.js";\nclass C { m(@p x: X, y: Y) {} }`, classDep),
  program(
    "import/return type, with a parameter decorator only",
    `import { X } from "./dep.js";\nclass C { m(@p x: string): X { return null!; } }`,
    classDep,
  ),
  program("import/never in parentheses", `import { X } from "./dep.js";\nclass C { @d a: (never) | X; }`, classDep),
  program("import/null in parentheses", `import { X } from "./dep.js";\nclass C { @d a: (null) | X; }`, classDep),
  program("import/getter", `import { X } from "./dep.js";\nclass C { @d get a(): X { return null!; } }`, classDep),
  program("import/setter", `import { X } from "./dep.js";\nclass C { @d set a(v: X) {} }`, classDep),
  program(
    "import/setter of a decorated getter",
    `import { X, Y } from "./dep.js";\nclass C { @d get a(): X { return null!; } set a(v: Y) {} }`,
    classDep,
  ),
  program(
    "import/getter of a decorated setter",
    `import { X, Y } from "./dep.js";\nclass C { get a(): X { return null!; } @d set a(v: Y) {} }`,
    classDep,
  ),
  program("import/rest parameter", `import { X } from "./dep.js";\nclass C { @d m(...x: X[]) {} }`, classDep),
  program(
    "import/rest parameter, Array",
    `import { X } from "./dep.js";\nclass C { @d m(...x: Array<X>) {} }`,
    classDep,
  ),

  // Nothing refers to the import at run time, so it goes away, and with it the module's side effects.
  program("import/unused", `import { X } from "./dep.js";\nclass C { @d a: string; }`, classDep),
  program(
    "import/not decorated",
    `import { X } from "./dep.js";\nclass C { a: X; m(x: X): X { return x; } }`,
    classDep,
  ),
  program(
    "import/not decorated, another member is",
    `import { X } from "./dep.js";\nclass C { a: X; @d b: string; m(x: X) {} }`,
    classDep,
  ),
  program(
    "import/class decorator does not reach members",
    `import { X } from "./dep.js";\n@d class C { a: X; m(x: X) {} }`,
    classDep,
  ),
  program(
    "import/member decorator does not reach the constructor",
    `import { X } from "./dep.js";\nclass C { @d a: string; constructor(x: X) {} }`,
    classDep,
  ),
  program("import/array", `import { X } from "./dep.js";\nclass C { @d a: X[]; }`, classDep),
  program(
    "import/type argument",
    `import { X } from "./dep.js";\nclass C { @d a: Promise<X>; @d b: Array<X>; @d c: Map<string, X>; }`,
    classDep,
  ),
  program("import/type argument of an import", `import { X, Y } from "./dep.js";\nclass C { @d a: X<Y>; }`, classDep),
  program(
    "import/function type",
    `import { X } from "./dep.js";\nclass C { @d a: () => X; @d b: (x: X) => void; @d c: new () => X; }`,
    classDep,
  ),
  program(
    "import/object type",
    `import { X } from "./dep.js";\nclass C { @d a: { x: X }; @d b: { [k: string]: X }; }`,
    classDep,
  ),
  program("import/tuple", `import { X } from "./dep.js";\nclass C { @d a: [X]; @d b: [x: X]; }`, classDep),
  program("import/typeof", `import { X } from "./dep.js";\nclass C { @d a: typeof X; }`, classDep),
  program("import/keyof", `import { X } from "./dep.js";\nclass C { @d a: keyof X; }`, classDep),
  program("import/indexed access", `import { X } from "./dep.js";\nclass C { @d a: X["a"]; }`, classDep),
  program(
    "import/type predicate",
    `import { X } from "./dep.js";\nclass C { @d m(x: any): x is X { return true; } @d n(x: any): asserts x is X {} }`,
    classDep,
  ),
  program(
    "import/condition of a conditional type",
    `import { X, Y } from "./dep.js";\nclass C { @d a: X extends Y ? string : string; }`,
    classDep,
  ),
  program(
    "import/branches of a conditional type",
    `import { X } from "./dep.js";\nclass C { @d a: string extends number ? X : X; }`,
    classDep,
  ),
  program(
    "import/one branch of a conditional type",
    `import { X } from "./dep.js";\nclass C { @d a: string extends number ? X : never; }`,
    classDep,
  ),
  program(
    "import/different branches of a conditional type",
    `import { X, Y } from "./dep.js";\nclass C { @d a: string extends number ? X : Y; }`,
    classDep,
  ),
  program("import/union with null", `import { X } from "./dep.js";\nclass C { @d a: X | null; }`, classDep),
  program(
    "import/union with undefined",
    `import { X } from "./dep.js";\nclass C { @d a: X | undefined; @d b?: X; }`,
    classDep,
  ),
  program("import/union with itself", `import { X } from "./dep.js";\nclass C { @d a: X | X; }`, classDep),
  program("import/union with never", `import { X } from "./dep.js";\nclass C { @d a: X | never; }`, classDep),
  program("import/union with string", `import { X } from "./dep.js";\nclass C { @d a: X | string; }`, classDep),
  program("import/union, string first", `import { X } from "./dep.js";\nclass C { @d a: string | X; }`, classDep),
  program(
    "import/union with any",
    `import { X } from "./dep.js";\nclass C { @d a: X | any; @d b: any | X; }`,
    classDep,
  ),
  program(
    "import/union with unknown",
    `import { X } from "./dep.js";\nclass C { @d a: X | unknown; @d b: unknown | X; }`,
    classDep,
  ),
  program("import/union of two imports", `import { X, Y } from "./dep.js";\nclass C { @d a: X | Y; }`, classDep),
  program(
    "import/union of three, the last differs",
    `import { X, Y } from "./dep.js";\nclass C { @d a: X | X | Y; }`,
    classDep,
  ),
  program(
    "import/union with an object type",
    `import { X } from "./dep.js";\nclass C { @d a: X | {}; @d b: {} | X; }`,
    classDep,
  ),
  program("import/union with an array of it", `import { X } from "./dep.js";\nclass C { @d a: X | X[]; }`, classDep),
  program(
    "import/union in parentheses",
    `import { X } from "./dep.js";\nclass C { @d a: (X | null); @d b: (X) | null; @d c: ((X)); }`,
    classDep,
  ),
  program(
    "import/nested union",
    `import { X } from "./dep.js";\nclass C { @d a: (X | null) | (X | undefined); }`,
    classDep,
  ),
  program("import/intersection with itself", `import { X } from "./dep.js";\nclass C { @d a: X & X; }`, classDep),
  program(
    "import/intersection with an object type",
    `import { X } from "./dep.js";\nclass C { @d a: X & { a: 1 }; }`,
    classDep,
  ),
  program(
    "import/intersection with never",
    `import { X } from "./dep.js";\nclass C { @d a: X & never; @d b: never & X; }`,
    classDep,
  ),
  program(
    "import/intersection with unknown",
    `import { X } from "./dep.js";\nclass C { @d a: X & unknown; @d b: unknown & X; }`,
    classDep,
  ),
  program("import/intersection of two imports", `import { X, Y } from "./dep.js";\nclass C { @d a: X & Y; }`, classDep),
  program(
    "import/namespace, union with itself",
    `import * as ns from "./dep.js";\nclass C { @d a: ns.X | ns.X; }`,
    classDep,
  ),
  program(
    "import/namespace, union with null",
    `import * as ns from "./dep.js";\nclass C { @d a: ns.X | null; }`,
    classDep,
  ),
  program("import/namespace, array", `import * as ns from "./dep.js";\nclass C { @d a: ns.X[]; }`, classDep),
  program("import/namespace, not decorated", `import * as ns from "./dep.js";\nclass C { a: ns.X; }`, classDep),
  program("import/readonly", `import { X } from "./dep.js";\nclass C { @d a: readonly X[]; }`, classDep),
  program(
    "import/also used as a value",
    `import { X } from "./dep.js";\nclass C { @d a: X[]; }\nlog(X.name);`,
    classDep,
  ),
  program("import/declare field", `import { X } from "./dep.js";\nclass C { @d declare a: X; }`, classDep),
  program(
    "import/abstract member",
    `import { X } from "./dep.js";\nabstract class C { @d abstract a: X; @d abstract m(x: X): X; }`,
    classDep,
  ),
  program(
    "import/overload signature",
    `import { X, Y } from "./dep.js";\nclass C { m(x: X): void; @d m(x: Y): void {} }`,
    classDep,
  ),
  program(
    "import/constructor overload signature",
    `import { X, Y } from "./dep.js";\n@d class C { constructor(x: X); constructor(x: Y) {} }`,
    classDep,
  ),
  program("import/this parameter", `import { X, Y } from "./dep.js";\nclass C { @d m(this: X, y: Y) {} }`, classDep),
  program("import/shadowed by a type parameter", `import { X } from "./dep.js";\nclass C<X> { @d a: X; }`, classDep),

  // type-only imports
  program("import type/class", `import type { X } from "./dep.js";\nclass C { @d a: X; }`, classDep),
  program("import type/inline", `import { type X } from "./dep.js";\nclass C { @d a: X; }`, classDep),
  program(
    "import type/inline, next to a value",
    `import { type X, Y } from "./dep.js";\nclass C { @d a: X; @d b: Y; }`,
    classDep,
  ),
  program("import type/default", `import type D from "./dep.js";\nclass C { @d a: D; }`, classDep),
  program(
    "import type/namespace",
    `import type * as ns from "./dep.js";\nclass C { @d a: ns.X; @d b: ns.Missing; }`,
    classDep,
  ),
  program(
    "import type/union with null",
    `import type { X } from "./dep.js";\nclass C { @d a: X | null; @d b: X | X; @d c: X[]; }`,
    classDep,
  ),
  program(
    "import type/constructor",
    `import type { X } from "./dep.js";\n@d class C { constructor(x: X) {} }`,
    classDep,
  ),
  program("import type/qualified", `import type { X } from "./dep.js";\nclass C { @d a: X.Y; @d b: X.Y.Z; }`, classDep),
  program("import type/named like a global", `import type { Date } from "./dep.js";\nclass C { @d a: Date; }`, {
    "dep.ts": `export class Date {}`,
  }),
  program("import type/import equals", `import type X = require("./dep");\nclass C { @d a: X; @d b: X.Y; }`, classDep),
  program(
    "import type/re-exported",
    `import type { X } from "./dep.js";\nexport type { X };\nclass C { @d a: X; }`,
    classDep,
  ),

  // what the module exports
  program("import/enum", `import { E } from "./dep.js";\nclass C { @d a: E; @d b: E.A; }`, {
    "dep.ts": `log("dep evaluated");\nexport enum E { A }`,
  }),
  program("import/string enum", `import { E } from "./dep.js";\nclass C { @d a: E; @d b: E.A; }`, {
    "dep.ts": `log("dep evaluated");\nexport enum E { A = "a" }`,
  }),
  program("import/const enum", `import { E } from "./dep.js";\nclass C { @d a: E; @d b: E.A; }`, {
    "dep.ts": `log("dep evaluated");\nexport const enum E { A }`,
  }),
  program(
    "import/object",
    `import { O } from "./dep.js";\nclass C { @d a: O; @d b: O.K; @d c: O.n; @d e: O.missing; @d f: O.missing.K; }`,
    {
      "dep.ts": `export const O = { K: class K {}, n: 1 };`,
    },
  ),
  program(
    "import/number, string, null, undefined",
    `import { n, s, z, u } from "./dep.js";\nclass C { @d a: n; @d b: s; @d c: z; @d e: u; @d f: z.K; @d g: u.K; @d h: n.K; }`,
    {
      "dep.ts": `export const n = 1, s = "s", z = null, u = undefined;`,
    },
  ),
  program("import/function", `import { f, g, h } from "./dep.js";\nclass C { @d a: f; @d b: g; @d c: h; }`, {
    "dep.ts": `export function f() {}\nexport const g = () => {};\nexport async function h() {}`,
  }),
  program(
    "import/namespace object",
    `import { NS } from "./dep.js";\nclass C { @d a: NS.K; @d b: NS.In.K; @d c: NS.Missing; @d e: NS.Missing.K; @d f: NS; }`,
    {
      "dep.ts": `export namespace NS { export class K {} export namespace In { export class K {} } }`,
    },
  ),
  program("import/interface", `import { I } from "./dep.js";\nclass C { @d a: I; }`, {
    "dep.ts": `log("dep evaluated");\nexport interface I {}`,
  }),
  program("import/alias", `import { T } from "./dep.js";\nclass C { @d a: T; }`, {
    "dep.ts": `log("dep evaluated");\nexport type T = string;`,
  }),
  program(
    "import/interface through a namespace import",
    `import * as ns from "./dep.js";\nclass C { @d a: ns.I; @d b: ns.T; }`,
    {
      "dep.ts": `log("dep evaluated");\nexport interface I {}\nexport type T = string;`,
    },
  ),
  program(
    "import/interface and a class from the same module",
    `import { I, X } from "./dep.js";\nclass C { @d a: I; @d b: X; }`,
    {
      "dep.ts": `log("dep evaluated");\nexport interface I {}\nexport class X {}`,
    },
  ),
  program("import/missing export", `import { Missing } from "./dep.js";\nclass C { @d a: Missing; }`, classDep),
  program("import/re-exported class", `import { X } from "./mid.js";\nclass C { @d a: X; }`, {
    ...classDep,
    "mid.ts": `export { X } from "./dep.js";`,
  }),
  program("import/re-exported with a star", `import { X } from "./mid.js";\nclass C { @d a: X; }`, {
    ...classDep,
    "mid.ts": `export * from "./dep.js";`,
  }),
  program("import/re-exported interface", `import { I } from "./mid.js";\nclass C { @d a: I; }`, {
    "dep.ts": `export interface I {}`,
    "mid.ts": `export type { I } from "./dep.js";`,
  }),
  program("import/re-exported as a type", `import { X } from "./mid.js";\nclass C { @d a: X; }`, {
    ...classDep,
    "mid.ts": `export type { X } from "./dep.js";`,
  }),
  program("import/cycle", `import { B } from "./b.js";\nexport class A { @d b: B; }`, {
    "b.ts": `import { A } from "./main.js";\nexport class B { @d a: A; }`,
  }),
  program("import/cycle, entered from the other side", `import "./b.js";`, {
    "a.ts": `import { B } from "./b.js";\nexport class A { @d b: B; }`,
    "b.ts": `import { A } from "./a.js";\nexport class B { @d a: A; }`,
  }),
  program("import/cycle through a namespace import", `import * as b from "./b.js";\nexport class A { @d b: b.B; }`, {
    "b.ts": `import * as a from "./main.js";\nexport class B { @d a: a.A; }`,
  }),
  program(
    "import/json",
    `import data from "./data.json" with { type: "json" };\nclass C { @d a: data; @d b: data.K; }`,
    { "data.json": `{ "K": 1 }` },
  ),

  // import equals
  program(
    "import equals/namespace member",
    `namespace NS { export class K {} export interface I {} export enum E { A } export type T = string; }\nimport K = NS.K; import I = NS.I; import E = NS.E; import T = NS.T;\nclass C { @d a: K; @d b: I; @d c: E; @d e: T; }`,
  ),
  program(
    "import equals/namespace",
    `namespace NS { export namespace In { export class K {} } }\nimport In = NS.In;\nclass C { @d a: In.K; @d b: In.Missing; }`,
  ),
  program(
    "import equals/chain",
    `namespace NS { export class K {} }\nimport A = NS; import B = A.K; import B2 = B;\nclass C { @d a: B; @d b: A.K; @d c: B2; }`,
  ),
  program(
    "import equals/of an import",
    `import * as ns from "./dep.js";\nimport X = ns.X;\nclass C { @d a: X; }`,
    classDep,
  ),
  program(
    "import equals/exported",
    `namespace NS { export class K {} }\nexport import K = NS.K;\nclass C { @d a: K; }`,
  ),
  program("import equals/missing", `namespace NS {}\nimport K = NS.K;\nclass C { @d a: K; }`),
];

/** Text that is hard to skip over. */
const syntax: Case[] = [
  program(
    "syntax/comments",
    `class K {}\nclass C { @d a /* x */ : /* y */ K /* z */; @d b: // c\n K; @d m(/* a */ x /* b */: /* c */ K /* d */, /* e */): /* f */ K /* g */ { return x; } }`,
  ),
  program(
    "syntax/newlines",
    `class K {}\nclass C {\n  @d\n  a\n  :\n  K\n  ;\n  @d\n  m\n  (\n  x\n  :\n  K\n  )\n  :\n  K\n  { return x; }\n}`,
  ),
  program("syntax/newline before brackets", `class K {}\nclass C {\n  @d a: K\n  [0]: string\n}`),
  program(
    "syntax/newline inside a union",
    `class K {}\nclass C {\n  @d a:\n    | K\n    | null\n  @d b: K |\n    K\n  @d c: K\n    | K\n}`,
  ),
  program("syntax/newline before is", `class C {\n  @d m(x: any): x\n  is: string\n}`),
  program("syntax/newline after asserts", `class C {\n  @d m(x: any): asserts\n  x: string\n}`),
  program("syntax/newline before extends", `class K {}\nclass C {\n  @d a: K\n  extends: string\n}`),
  program(
    "syntax/newline before a dot",
    `namespace NS { export class K {} }\nclass C {\n  @d a: NS\n    .K\n  @d b: NS.\n    K\n}`,
  ),
  program(
    "syntax/closing angle brackets",
    `class G<T> {}\nclass C { @d a: G<G<string>>; @d b: G<G<G<string>>>; @d c: G<G<G<G<string>>>>= null!; @d e: G<string>= null!; @d f: G<G<string>>= null!; }`,
  ),
  program(
    "syntax/arrow function in a type argument",
    `class G<T> {}\nclass C { @d a: G<() => void>; @d b: G<(x: G<string>) => G<number>>; @d c: G<new () => G<string>>; }`,
  ),
  program(
    "syntax/less than in an initializer",
    `class K {}\nclass C { @d a: K = (1 < 2 ? null! : null!); @d b: number = 1 < 2 ? 1 : 2; }`,
  ),
  program(
    "syntax/object type then initializer",
    `class C { @d a: { x: number } = { x: 1 }; @d b: {} = {}; @d c: [] = []; @d e: () => void = () => {}; }`,
  ),
  program(
    "syntax/function type returning a union",
    `class K {}\nclass C { @d a: () => K | null; @d b: (() => K) | null; @d c: null | (() => K); @d e: new () => K | null; }`,
  ),
  program(
    "syntax/function type in a union without parentheses",
    `class K {}\nclass C { @d a: K | (() => void); @d b: string | ((x: K) => K) | null; }`,
  ),
  program(
    "syntax/parenthesized or arrow",
    `class K {}\nclass C { @d a: (K); @d b: (K) => void; @d c: (x: K) => void; @d e: (K | null); @d f: (K)[]; @d g: ({}); @d h: ({}) => void; @d i: ([]) => void; @d j: ([]); @d k: (x?) => void; @d l: (...x) => void; @d m: () => void; @d n: (this) => void; @d o: (this: K) => void; @d q: (this); }`,
  ),
  program(
    "syntax/optional and definite",
    `class K {}\nclass C { @d a?: K; @d b!: K; @d c?; @d e!: K | null; @d m?(x?: K): K; @d n?(): void {} }`,
  ),
  program(
    "syntax/conditional type in a parameter with a default",
    `class K {}\nclass C { @d m(x: K extends K ? K : K = null!, y: string = "") {} }`,
  ),
  program(
    "syntax/conditional type with a function type",
    `class K {}\nclass C { @d a: K extends () => infer R ? R : K; @d b: K extends K ? () => void : () => void; @d c: K extends K ? (x: K) => K : (y: K) => K; }`,
  ),
  program(
    "syntax/conditional type, infer with a constraint",
    `class K {}\nclass C { @d a: K extends [infer U extends string] ? K : K; @d b: K extends [infer U extends string ? 1 : 2] ? K : K; @d c: K extends (infer U extends K ? K : K) ? K : K; }`,
  ),
  program(
    "syntax/template literal type",
    "class K {}\nclass C { @d a: `a`; @d b: `a${string}`; @d c: `${K extends K ? `x${string}` : 'y'}`; @d e: `}${'{'}`; @d f: `a` | `b`; @d g: `${number}`[]; }",
  ),
  program(
    "syntax/numbers",
    `class C { @d a: 0b1; @d b: 0o7; @d c: 1_000; @d e: .5; @d f: 1.; @d g: - 1; @d h: -0x1; @d i: 1e-3; @d j: -1_0n; }`,
  ),
  program("syntax/strings", `class C { @d a: "\\""; @d b: '\\''; @d c: "a\\nb"; @d e: "}"; @d f: ";"; @d g: "=>"; }`),
  program(
    "syntax/keywords as property names in types",
    `class C { @d a: { class: 1; function: 2; if: 3; new: 4; typeof: 5; import: 6; void: 7; null: 8 }; @d b: { new(): void }; @d c: { new: () => void }; @d e: { get: 1; set: 2 }; @d f: { get(): 1; set(): 2 }; @d g: { readonly: 1 }; @d h: { readonly readonly: 1 }; }`,
  ),
  program(
    "syntax/tuple labels that are keywords",
    `class C { @d a: [new: 1, typeof: 2, import: 3, function: 4, keyof: 5, readonly: 6, infer: 7, void?: 8]; }`,
  ),
  program(
    "syntax/qualified names with keywords",
    `namespace NS { export namespace _class { export class K {} } }\nconst o = { class: class A {}, new: { typeof: class B {} }, default: class D {} };\nclass C { @d a: o.class; @d b: o.new.typeof; @d c: o.default; @d e: o.void; @d f: o.if.else; }`,
  ),
  program(
    "syntax/type arguments on a qualified name",
    `namespace NS { export class G<T> {} export namespace In { export class G<T> {} } }\nclass C { @d a: NS.G<string>; @d b: NS.In.G<NS.G<string>>; @d c: NS.G<string>[]; @d e: NS.G<string> | null; @d f: NS.G<string> | NS.G<number>; }`,
  ),
  program(
    "syntax/typeof with type arguments and members",
    `class G<T> { static s = 1; }\nclass C { #p = 1; @d a: typeof G<string>; @d b: typeof G.s; @d c: typeof this.a; @d e: typeof C.prototype.a; @d f: typeof G[]; @d g: typeof G | null; @d h: typeof G["s"]; m() { class E { @d x: typeof this; } } }`,
  ),
  program(
    "syntax/import type",
    `class C { @d a: import("./dep").X; @d b: import("./dep").X[]; @d c: import("./dep").X | null; @d e: import("./dep").G<string>; @d f: typeof import("./dep"); @d g: import("./dep"); @d h: import("./dep").N.X; @d i: typeof import("./dep").X; }`,
    classDep,
  ),
  program(
    "syntax/unique symbol",
    `class C { @d static readonly a: unique symbol = Symbol(); @d b: unique symbol; @d f: unique symbol | null; @d g: unique symbol[]; }`,
  ),
  program(
    "syntax/abstract constructor type",
    `class K {}\nclass C { @d a: abstract new () => K; @d b: abstract; @d c: (abstract new () => K) | null; @d e: abstract | null; @d f: abstract new () => K | null; }`,
  ),
  program(
    "syntax/asserts and is as names",
    `class asserts {}\nclass is {}\nclass C { @d a: asserts; @d b: is; @d m(x: any): asserts { return x; } @d n(x: any): is { return x; } @d o(asserts: any): asserts is is { return true; } @d q(is: any): is is is { return true; } }`,
  ),
  program(
    "syntax/predicate in a property's function type",
    `class C { @d a: (x: any) => x is string; @d b: (x: any) => asserts x; @d c: (this: any) => this is string; }`,
  ),
  program(
    "syntax/this type",
    `class C { @d a: this; @d b: this[]; @d c: this | null; @d e: this["a"]; @d m(x: this): this { return this; } @d n(): this is C { return true; } @d o(): asserts this {} @d q(): asserts this is C {} @d r(): this | undefined { return this; } }`,
  ),
  program(
    "syntax/readonly",
    `class K {}\nclass C { @d a: readonly K[]; @d b: readonly [K]; @d c: readonly K[][]; @d e: readonly K[] | null; @d f: null | readonly K[]; @d g: readonly K[] | readonly K[]; @d h: readonly K[] | K; @d readonly k: readonly K[]; @d l: readonly string; @d m: readonly K; @d n: readonly (K | null); @d o: readonly readonly K[]; @d q: readonly K["a"]; @d r: readonly (() => void); @d s: readonly { a: 1 }; @d t: readonly typeof K; @d u: readonly keyof K; @d v: readonly unique symbol; @d w: readonly 1; @d x: readonly null; @d y: readonly void; }`,
  ),
  program(
    "syntax/keyof",
    `class K {}\nclass C { @d a: keyof K; @d b: keyof K[]; @d c: keyof K | null; @d e: keyof K | keyof K; @d h: keyof typeof K; @d i: (keyof K)[]; @d j: keyof K & string; @d k: keyof readonly K[]; }`,
  ),
  program(
    "syntax/postfix JSDoc types",
    `class K {}\nclass C { @d a: K!; @d c: string!; @d f: K! | null; @d g: K![]; }`,
  ),
  program(
    "syntax/accessor types in object types",
    `class C { @d a: { get x(): string; set x(v: string) }; @d b: { get: string }; @d c: { get<T>(): T }; }`,
  ),
  program(
    "syntax/mapped types",
    `class K {}\nclass C { @d a: { [P in keyof K]: K[P] }; @d b: { +readonly [P in keyof K]+?: K[P] }; @d c: { -readonly [P in keyof K]-?: K[P] }; @d e: { [P in keyof K as \`x\${P & string}\`]: K[P] }; @d f: { [P in "a"]: K }["a"]; @d g: { [P in "a"]: K }[]; }`,
  ),
  program(
    "syntax/index signatures",
    `class K {}\nclass C { @d a: { [k: string]: K }; @d b: { [k: number]: K; [k: string]: K }; @d c: { readonly [k: string]: K }; @d e: { [k: symbol]: K }; @d f: { [k: \`a\${string}\`]: K }; }`,
  ),
  program(
    "syntax/generic call and construct signatures",
    `class K {}\nclass C { @d a: { <T>(x: T): T }; @d b: { new <T>(x: T): K }; @d c: <T,>(x: T) => T; @d e: <T extends K = K>(x: T) => T; @d f: <const T, U>(x: T) => U; }`,
  ),
  program(
    "syntax/decorator before modifiers",
    `class K {}\nclass C { @d public a: K; @d static c: K; @d public static readonly g: K; }`,
  ),
  program(
    "syntax/decorator expressions",
    `class K {}\nconst o = { d, f: () => d, n: { d } };\nclass C { @o.d a: K; @o.f() b: K; @o.n.d c: K; @(o["d"]) e: K; @(1, d) f: K; @o.f<string>() g: K; @o!.d h: K; }`,
  ),
  program(
    "syntax/field named like a modifier with a type",
    `class K {}\nclass C { @d static: K; @d readonly: K; @d declare: K; @d abstract: K; @d public: K; @d async: K; @d get: K; @d set: K; @d accessor: K; @d override: K; @d type: K; @d of: K; }`,
  ),
  program(
    "syntax/semicolon insertion after a type",
    `class K {}\nclass C {\n  @d a: K\n  @d b: string\n  static c: number\n  @d e: K\n  *g() {}\n  @d f: K\n  async h() {}\n  @d i: K\n  get j() { return 1; }\n  @d k: typeof K\n  l() {}\n}`,
  ),
  program(
    "syntax/deep nesting",
    `class K {}\nclass C { @d a: ${"(".repeat(50)}K${")".repeat(50)}; @d b: ${"[".repeat(50)}K${"]".repeat(50)}; @d c: K${"[]".repeat(50)}; @d e: ${"K | (".repeat(30)}K${")".repeat(30)}; }`,
  ),
  program(
    "syntax/long qualified name",
    `const a: any = { b: { c: { d: { e: { f: { g: class Deep {} } } } } } };\nclass C { @d x: a.b.c.d.e.f.g; @d y: a.b.c.x.e.f.g; @d z: a.b.c.d.e.f.x; @d w: a.b.c.d.e.f.g.h; @d v: a.b.c.d.e.f.g.h.i; }`,
  ),
  program(
    "syntax/qualified name with getters",
    `const a: any = { get b() { log("get b"); return { get c() { log("get c"); return class K {}; } }; } };\nclass C { @d x: a.b.c; @d y: a.b; }`,
  ),
  program(
    "syntax/qualified name through null and primitives",
    `const a: any = { n: null, u: undefined, z: 0, s: "", f: false, t: true, num: 1, str: "x" };\nclass C { @d a: a.n.K; @d b: a.u.K; @d c: a.z.K; @d e: a.s.K; @d f: a.f.K; @d g: a.t.K; @d h: a.num.K; @d i: a.str.K; @d j: a.n; @d k: a.z; @d l: a.str.length; @d m: a.str.constructor; @d n: a.n.K.L; @d o: a.z.K.L; }`,
  ),
  program(
    "syntax/value that is callable but not a class",
    `const a: any = { arrow: () => {}, bound: function () {}.bind(null), async: async () => {}, gen: function* () {}, proxy: new Proxy(class P {}, {}), method: { m() {} }.m };\nclass C { @d a: a.arrow; @d b: a.bound; @d c: a.async; @d e: a.gen; @d f: a.proxy; @d g: a.method; }`,
  ),
];

/** `design:*` keys belong to `experimentalDecorators`. */
const other: Case[] = [
  program(
    "helpers/Reflect.metadata is missing",
    `const saved = Reflect.metadata;\ndelete (Reflect as any).metadata;\nclass C { @d a: string; }\n(Reflect as any).metadata = saved;`,
  ),
  program(
    "helpers/Reflect.decorate exists",
    `(Reflect as any).decorate = (ds: any[], t: any, k: any, desc: any) => { log("Reflect.decorate " + ds.length); return desc; };\ntry { class C { @d a: string; } } finally { delete (Reflect as any).decorate; }`,
  ),
];

export const cases: Case[] = [
  ...matrix("types", types, "prop"),
  ...matrix("types", types, "param"),
  ...matrix("types", types, "return"),
  ...matrix("types", types, "rest"),
  ...matrix("return types", returnTypes, "return"),
  ...matrix("pairs", pairs(), "prop"),
  ...matrix("triples", triples(), "param"),
  ...shapes,
  ...scopes,
  ...importCases,
  ...syntax,
  ...other,
];
