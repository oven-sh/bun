// Inputs for the test of `getTypeAtLocation()`: between them, `all.tsx` and `assertion.ts` have every kind of node.
export const linted = ["all.tsx", "assertion.ts"];
export const cases = {
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "es2022", "module": "esnext", "moduleResolution": "bundler", "jsx": "preserve", "types": [], "noEmit": true, "resolveJsonModule": true, "experimentalDecorators": true } }
`,
  "data.json": `{ "a": 1 }\n`,
  "lib.ts": `export const named = 1;
export interface Kind { kind: "k" }
const def = "d" as const;
export default def;
`,
  // `<T>x` isn't TSX.
  "assertion.ts": `declare const obj: { x: 1 } | undefined;\n(<object>obj);\n`,
  "all.tsx": `import def, { named as renamed, type Kind } from "./lib";
import * as space from "./lib";
export { named } from "./lib";
export * as again from "./lib";
declare const obj: { method?(): number; deep?: { x: string } } | undefined;
declare function tag(strings: TemplateStringsArray, ...values: number[]): string;
declare const list: number[];
declare global { namespace JSX { interface IntrinsicElements { div: { id?: string; children?: unknown }; "a:b": { c?: 1 } } interface Element { e: 1 } } }
obj?.method?.();
obj?.deep?.x;
obj!.deep;
(obj as object);
(obj satisfies unknown);
\`a\${1}b\`;
tag\`a\${1}\`;
[...list, 1];
({ ...obj, key: 1, "quoted": 2, [def]: 3, list, method() {}, get got() { return 1; } });
(1, "a");
import.meta;
import("./lib");
async function* gen(this: Kind, first: number, second = "a", ...rest: boolean[]) {
  await first;
  yield second;
  yield* [rest];
  return this;
}
class Base<T> { constructor(public held: T) {} }
class Derived extends Base<number> implements Kind {
  #secret = 1;
  static fixed: string = "a";
  declare kind: "k";
  field = () => this.#secret;
  constructor() { super(1); new.target; }
  method(): void { super.held; #secret in this; }
  get value() { return 1; }
  static { Derived.fixed; }
  [def]() {}
}
const { a: picked, b = 2 } = { a: 1, b: undefined, c: "c" };
const [head, , tail = "t", ...more] = [1, 2, undefined, 4];
let later: Array<string> | null = null;
type Alias<T> = T extends string ? T : [T, number?];
type Mapped<T extends string> = { [K in T]: K };
interface Face extends Kind { (x: number): string; new (x: number): Face; prop: typeof def; readonly [key: string]: unknown }
enum Color { Red, Green = "g" }
namespace Inner { export const value = 1; }
function over(x: number): number;
function over(x: unknown) { return x as number; }
for (const item of list) item;
for (const key in obj) key;
label: for (let i = 0; i < 1; i++) { if (i) continue label; else break label; }
try { throw new Error("e"); } catch (caught) { caught; } finally {}
switch (head) { case 1: break; default: }
const element = <div id="a" {...obj}>text{head}<></></div>;
const arrow = <T,>(x: T): x is T => true;
const fn = function named2() {};
const cls = class Named3 {};
typeof head; void 0; -head; !head; head ? 1 : 2; head ?? 1; head && 1; later ||= []; head + 1;
new Derived(); renamed; space.named; /re/g; 1n; null; undefined; true;
export default arrow;
export const exported = 1;
import json from "./data.json" with { type: "json" };
import lib = require("./lib");
declare function dec(...args: unknown[]): any;
declare const ui: { Box(props: { n?: number }): JSX.Element };
export function exportedFunction(p: number) { return p; }
export class ExportedClass {}
export type ExportedAlias = string;
export interface ExportedFace { a: 1 }
export enum ExportedEnum { A }
export declare const ambient: number;
export namespace ExportedSpace { export type T = 1; }
abstract class Abstract {
  abstract field: number;
  abstract method(): void;
  accessor auto = 1;
  @dec decorated = 1;
  @dec() decoratedMethod(@dec parameter: number) {}
  #privateMethod() {}
  static #count = 0;
  get both() { return 1; }
  set both(value: number) {}
  optional?: string;
  "quoted key" = 1;
  1 = 1;
  overloaded(a: number): void;
  overloaded(a: unknown) {}
  private constructor(private readonly kept: string, protected other = 1) {}
}
type Fn = (a: number, ...b: string[]) => void;
type Ctor = abstract new (a: number) => object;
type Named = [first: number, second?: string, ...rest: boolean[]];
type Keys = keyof Kind;
type Indexed = Kind["kind"];
type Template = \`a\${string}\`;
type Inferred<T> = T extends (infer U)[] ? U : never;
type Imported = import("./lib").Kind;
type Qualified = ExportedSpace.T;
type Inter = Kind & { b: 2 };
type Unique = { readonly s: unique symbol };
type Getter = { get g(): number; set g(v: number) };
type Big = bigint | symbol | never | any | object | this_;
type this_ = 1;
type Neg = -1;
type Read = readonly number[];
type TypeofImport = typeof import("./lib");
interface WithThis { me(): this; method<T>(x: T): asserts x is T }
const satisfied = { a: 1 } as const;
const box = <ui.Box n={1} />;
const spaced = <a:b />;
const kids = <div>{...[1]}{/* empty */}</div>;
do {} while (false);
while (false) {}
debugger;
;
if (json) {} else {}
let uninitialized: string, second = 1;
var hoisted;
[uninitialized, second] = ["a", 2];
({ second, uninitialized = "b", ...hoisted } = { second: 1 });
function defaults({ a = 1 }: { a?: number } = {}, [b]: number[] = []) { return [a, b, arguments]; }
const objectAccessors = { get g() { return 1; }, set g(v: number) {}, async *gen() {}, async am() {}, 1: 1, [\`t\`]: 1 };
new (class {})();
lib.named;
(function () {})();
(() => {})();
second++;
delete objectAccessors[1];
uninitialized!;
uninitialized!!;
class Generic<in out T extends object = object> { value!: T; }
function assertIs(x: unknown): asserts x {}
declare namespace A { namespace B { interface C { c: 1 } class D<T> { d: T } const e: number; namespace F { type G = 1 } } }
declare function generic<T>(x?: T): T;
declare function tagged<T>(strings: TemplateStringsArray): T;
declare const Comp: <T,>(props: { p?: T }) => JSX.Element;
type Three = A.B.C;
type Four = A.B.F.G;
type Query = typeof A.B.e;
class Sub extends A.B.D<string> implements A.B.C { c = 1 as const; }
interface More extends A.B.C, A.B.D<number> {}
generic<number>();
new A.B.D<boolean>();
tagged<string>\`a\`;
const typedElement = <Comp<number> p={1} />;
try {} catch (typed: unknown) {}
try {} catch {}
try {} catch ({ message }) {}
for (const [k, v] of Object.entries({ a: 1 })) { k; v; }
for (var index in {}) {}
let assigned: number; for (assigned of [1]) {}
const nested = { a: { b: [1, { c: "c" }] } };
const { a: { b: [first, { c }] } } = nested as { a: { b: [number, { c: string }] } };
function withThis(this: { t: 1 }) { return this.t; }
const optionalCall = nested.a?.b?.[0];
(nested.a?.b)[0];
nested?.["a"];
const big = 1n, regex = /a/u, templ = \`x\`, nul = null;
label: { break label; }
export { nested as renamedExport, first as "string name" };
export type { Three };
import type Def from "./lib";
import { type Kind as K2 } from "./lib";
declare module "./lib" { interface Kind { extra?: 1 } }
declare global { var globalVar: string }
enum Computed { A = 1 << 1, B = A | 1, "quoted" = 3 }
declare enum Ambient { X }
const enum Const { Y }
abstract class Sig { abstract get g(): number; abstract set g(v: number); static accessor s = 1; [key: string]: unknown; }
function* plain() { const got: string = yield 1; return got; }
async () => { for await (const x of []) x; };
const { a: pickedAgain, ...others } = { a: 1, c: "c" };
others;
function restOfParameter({ x, ...more }: { x: 1; y: 2 }) { return more; }
class EmptyDefault<T extends object = {}> { value!: T; }
const instantiated = generic<string>;
instantiated;
[Symbol.iterator, Symbol.asyncIterator];
const untypedSetters = { get g() { return 1; }, set g(v) {}, set h(v) {} };
`,
};
