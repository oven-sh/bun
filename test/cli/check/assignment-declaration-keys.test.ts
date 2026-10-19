// The key of an assignment that declares something: `this[("a")] = v` in a class of a JavaScript file,
// `exports[("a")] = v` in a CommonJS module, and `f[("a")] = v` or `f[k] = v` for a function `f`.
//
// typescript-go has two functions for the name of such a key. `GetElementOrPropertyAccessName` looks through
// parentheses, and names what `this[..]` and `exports[..]` declare. The checker's `tryGetElementAccessExpressionName`
// does not look through them, but follows a constant or an enum member, and the declaration transformer asks it which
// member of `f` to declare. So `this[("a")]` and `exports[("a")]` declare `a`, and `f[("a")]` declares no member.
//
// Each program but one shows what the declaration transformer does: in what a project that references the program is
// told, or in the errors of the transformer itself. The one is `exports[0] = undefined`, an error of the checker.
// `lines` is what tsc 7.0.2 prints for the files, with the arguments. differential-cases.json has the same programs,
// for tsc itself to be asked.
//
// In a file of its own, with projects that load no library: a debug build then takes under two seconds for each
// program, of the five that a test has by default. The project references of check.test.ts load the library, and take
// about four when only they run.
import { afterAll, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { endChildren } from "../children";
import { linesOf } from "./differential";

afterAll(endChildren);

type Files = Record<string, string>;

// Instead of the library files, which a debug build takes seconds to read.
const globals =
  "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
    .split(" ")
    .map(name => `interface ${name} {}\n`)
    .join("") +
  `declare var Object: { defineProperty(o: unknown, key: string, descriptor: { value: unknown }): void };\n`;
const options = {
  strict: true,
  target: "esnext",
  module: "nodenext",
  moduleResolution: "nodenext",
  noLib: true,
  types: [],
};
const config = (more: object = {}, rest: object = {}) =>
  JSON.stringify({ compilerOptions: { ...options, ...more }, ...rest });

// `pkg` emits declarations and `app` reads them: what `app/main.ts` is told shows what they declare.
const referenced = (pkg: Files, main: string): Files => ({
  "tsconfig.json": `{ "files": [], "references": [{ "path": "./pkg" }, { "path": "./app" }] }`,
  "pkg/tsconfig.json": config({ composite: true, allowJs: true, checkJs: true, outDir: "out", rootDir: "." }),
  "pkg/globals.d.ts": globals,
  ...Object.fromEntries(Object.entries(pkg).map(([name, text]) => [`pkg/${name}`, text])),
  "app/tsconfig.json": config(
    { composite: true, allowJs: true, outDir: "out", rootDir: "." },
    { references: [{ path: "../pkg" }] },
  ),
  "app/globals.d.ts": globals,
  "app/main.ts": main,
});

// One project: what the declaration transformer itself reports.
const alone = (more: object, files: Files): Files => ({
  "tsconfig.json": config({ declaration: true, noEmit: true, ...more }),
  "globals.d.ts": globals,
  ...files,
});

// Types that no declaration file can name: TS4094 or TS4032 is reported where a declaration has one.
const hidden = `class Hidden {
  private x = 1;
}
export function make() {
  return new Hidden();
}
interface Recursive {
  self: Recursive;
}
export declare function recursive(): Recursive;
`;

const expandoIsNotDeclared =
  "Assigning properties to functions without declaring them is not supported with --isolatedDeclarations. " +
  "Add an explicit declaration for the properties assigned to this function.";

const needsAnImport = (at: string, name: string) =>
  `${at}: error TS2883: The inferred type of '${name}' cannot be named without a reference to 'Inner' from ` +
  "'outer/node_modules/inner'. This is likely not portable. A type annotation is necessary.";

const cases: Record<string, { args?: string[]; files: Files; lines: string[] }> = {
  // The name is spelled as the source has it, without the parentheses: `"a"`, `'b'`, `0x10`.
  "this[(key)] = value declares a property of the class": {
    args: ["-b"],
    files: referenced(
      {
        "index.js": `export class C {
  declared = "s";
  constructor() {
    this[("a")] = 1;
    this[(('b'))] = "s";
    this[(0x10)] = true;
    this[("d-e")] = 1;
    /** @type {string | undefined} */
    this[("documented")] = undefined;
    this[("twice")] = 1;
    this.twice = "s";
    this[("x")] = this[("y")] = 1;
    const later = () => {
      this[("arrow")] = 1;
    };
    later();
  }
  method() {
    this[("declared")] = "t";
    this[("m")] = 1;
  }
  static init() {
    this[("s")] = 1;
  }
  static {
    this[("block")] = 1;
  }
}
export class Derived extends C {
  constructor() {
    super();
    this[("a")] = 2;
    this[("own")] = 3;
  }
  static init() {
    this[("a")] = "static";
    this[("declared")] = "same";
    this[("method")] = 1;
  }
}
`,
      },
      `import { C, Derived } from "../pkg/index.js";
const c = new C();
export const a: never = c.a;
export const b: never = c.b;
export const hex: never = c[16];
export const dashed: never = c["d-e"];
export const documented: never = c.documented;
export const twice: never = c.twice;
export const x: never = c.x;
export const y: never = c.y;
export const arrow: never = c.arrow;
export const declared: never = c.declared;
export const m: never = c.m;
export const s: never = C.s;
export const block: never = C.block;
export const own: never = new Derived().own;
export const inherited: never = new Derived().a;
export const staticA: never = Derived.a;
export const staticDeclared: never = Derived.declared;
export const staticMethod: never = Derived.method;
`,
    ),
    lines: [
      "app/main.ts(3,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(4,14): error TS2322: Type 'string' is not assignable to type 'never'.",
      "app/main.ts(5,14): error TS2322: Type 'boolean' is not assignable to type 'never'.",
      "app/main.ts(6,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(7,14): error TS2322: Type 'string | undefined' is not assignable to type 'never'.",
      "  Type 'undefined' is not assignable to type 'never'.",
      "app/main.ts(8,14): error TS2322: Type 'string | number' is not assignable to type 'never'.",
      "  Type 'string' is not assignable to type 'never'.",
      "app/main.ts(9,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(10,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(11,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(12,14): error TS2322: Type 'string' is not assignable to type 'never'.",
      "app/main.ts(13,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(14,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(15,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(16,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(17,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(18,14): error TS2322: Type 'string' is not assignable to type 'never'.",
      "app/main.ts(19,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(19,46): error TS2339: Property 'declared' does not exist on type 'typeof Derived'.",
      "app/main.ts(20,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(20,44): error TS2339: Property 'method' does not exist on type 'typeof Derived'.",
    ],
  },
  // `constructor`, a key that is no literal, a target that is in parentheses as a whole, and `??=` declare nothing.
  // A key whose parenthesis is not closed declares `"a"`.
  "this[(key)] = value declares nothing unless the key is a literal": {
    args: ["-b"],
    files: referenced(
      {
        "index.js": `const k = "named";
export class C {
  constructor() {
    this[("constructor")] = 1;
    this[(k)] = 1;
    (this["whole"]) = 1;
    this[("compound")] ??= 1;
    this[("a"] = 1;
  }
}
`,
      },
      `import { C } from "../pkg/index.js";
const c = new C();
export const named: never = c.named;
export const whole: never = c.whole;
export const compound: never = c.compound;
export const a: never = c.a;
`,
    ),
    lines: [
      "pkg/index.js(8,14): error TS1005: ')' expected.",
      "app/main.ts(3,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(3,31): error TS2339: Property 'named' does not exist on type 'C'.",
      "app/main.ts(4,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(4,31): error TS2339: Property 'whole' does not exist on type 'C'.",
      "app/main.ts(5,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(5,34): error TS2339: Property 'compound' does not exist on type 'C'.",
      "app/main.ts(6,14): error TS2322: Type 'number' is not assignable to type 'never'.",
    ],
  },
  // `Object.defineProperty(exports, ("defined"), d)` is no declaration: `IsBindableObjectDefinePropertyCall` does not
  // look through parentheses.
  "exports[(key)] = value exports the name": {
    args: ["-b"],
    files: referenced(
      {
        "index.cjs": `function g() {}
exports[("a")] = 1;
module.exports[("b")] = 2;
module[("exports")][(("c"))] = 3;
exports[(0)] = 4;
exports[("d-e")] = 5;
exports[("default")] = 6;
exports[("class")] = 7;
exports[("alias")] = g;
exports[("Box")] = class {
  size = 1;
};
exports[("twice")] = 1;
exports.twice = "s";
{
  exports[("nested")] = 8;
}
Object.defineProperty(exports, ("defined"), { value: 9 });
Object.defineProperty(exports, "e", { value: 10 });
Object.defineProperty(exports, "f-g", { value: 11 });
exports.of = class {
  size = 1;
};
exports["from"] = class {
  size = 1;
};
`,
      },
      `import lib = require("../pkg/index.cjs");
export const a: never = lib.a;
export const b: never = lib.b;
export const c: never = lib.c;
export const zero: never = lib[0];
export const dashed: never = lib["d-e"];
export const byDefault: never = lib.default;
export const keyword: never = lib.class;
export const alias: never = lib.alias;
export const size: never = new lib.Box().size;
export const twice: never = lib.twice;
export const nested: never = lib.nested;
export const defined: never = lib.defined;
export const e: never = lib.e;
export const dashedDefined: never = lib["f-g"];
export const dotKeyword: never = new lib.of();
export const quotedKeyword: never = new lib.from();
export const box: never = new lib.Box();
`,
    ),
    lines: [
      "app/main.ts(2,14): error TS2322: Type '1' is not assignable to type 'never'.",
      "app/main.ts(3,14): error TS2322: Type '2' is not assignable to type 'never'.",
      "app/main.ts(4,14): error TS2322: Type '3' is not assignable to type 'never'.",
      "app/main.ts(5,14): error TS2322: Type '4' is not assignable to type 'never'.",
      "app/main.ts(6,14): error TS2322: Type '5' is not assignable to type 'never'.",
      "app/main.ts(7,14): error TS2322: Type '6' is not assignable to type 'never'.",
      "app/main.ts(8,14): error TS2322: Type '7' is not assignable to type 'never'.",
      "app/main.ts(9,14): error TS2322: Type '() => void' is not assignable to type 'never'.",
      "app/main.ts(10,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(11,14): error TS2322: Type '\"s\" | 1' is not assignable to type 'never'.",
      "  Type '\"s\"' is not assignable to type 'never'.",
      "app/main.ts(12,14): error TS2322: Type '8' is not assignable to type 'never'.",
      "app/main.ts(13,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(13,35): error TS2339: Property 'defined' does not exist on type 'typeof import(\"/pkg/out/index\")'.",
      "app/main.ts(14,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(15,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(16,14): error TS2322: Type 'of' is not assignable to type 'never'.",
      "app/main.ts(17,14): error TS2322: Type '_class' is not assignable to type 'never'.",
      "app/main.ts(18,14): error TS2322: Type 'Box' is not assignable to type 'never'.",
    ],
  },
  // A function or a class keeps the members of its other assignments. A variable that gets no member keeps its own
  // type, which has the property.
  "f[(key)] = value declares no member of f": {
    args: ["-b"],
    files: referenced(
      {
        "typed.ts": `export function f() {}
f[("p")] = 1;
f["q"] = 2;
export const arrow = () => {};
arrow[("p")] = 1;
export const both = () => {};
both[(("p"))] = 1;
both.q = "s";
function target() {}
export function chained() {}
chained.first = chained.second = target;
`,
        "untyped.js": `export function f() {}
f[("p")] = 1;
f["q"] = 2;
export const expression = function () {};
expression[("p")] = 1;
export class K {}
K[("p")] = 1;
K["q"] = 2;
function target() {}
export function aliased() {}
aliased[("p")] = target;
`,
      },
      `import * as typed from "../pkg/typed.js";
import * as untyped from "../pkg/untyped.js";
export const f: never = typed.f;
export const fp: never = typed.f.p;
export const fq: never = typed.f.q;
export const arrow: never = typed.arrow;
export const both: never = typed.both;
export const bothP: never = typed.both.p;
export const first: never = typed.chained.first;
export const second: never = typed.chained.second;
export const g: never = untyped.f;
export const gp: never = untyped.f.p;
export const expression: never = untyped.expression;
export const kp: never = untyped.K.p;
export const kq: never = untyped.K.q;
export const aliased: never = untyped.aliased.p;
`,
    ),
    lines: [
      "app/main.ts(3,14): error TS2322: Type 'typeof f' is not assignable to type 'never'.",
      "app/main.ts(4,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(4,34): error TS2339: Property 'p' does not exist on type 'typeof f'.",
      "app/main.ts(5,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(6,14): error TS2322: Type '{ (): void; p: number; }' is not assignable to type 'never'.",
      "app/main.ts(7,14): error TS2322: Type 'typeof both' is not assignable to type 'never'.",
      "app/main.ts(8,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(8,40): error TS2339: Property 'p' does not exist on type 'typeof both'.",
      "app/main.ts(9,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(9,43): error TS2339: Property 'first' does not exist on type 'typeof chained'.",
      "app/main.ts(10,14): error TS2322: Type '() => void' is not assignable to type 'never'.",
      "app/main.ts(11,14): error TS2322: Type 'typeof f' is not assignable to type 'never'.",
      "app/main.ts(12,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(12,36): error TS2339: Property 'p' does not exist on type 'typeof f'.",
      "app/main.ts(13,14): error TS2322: Type '{ (): void; p: number; }' is not assignable to type 'never'.",
      "app/main.ts(14,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(14,36): error TS2339: Property 'p' does not exist on type 'typeof K'.",
      "app/main.ts(15,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(16,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(16,47): error TS2339: Property 'p' does not exist on type '() => void'.",
    ],
  },
  // The member has the name that `tryGetElementAccessExpressionName` finds, and the type of the property that the
  // assignment declares, which is another name or none: `A` for the property `0`, `w` for no property. A constant
  // from a pattern and one declared later name no member. The member for `f.inner.deep` is `deep`, of `f`.
  "f[key] = value, where a constant or an enum member is the key": {
    args: ["-b"],
    files: referenced(
      {
        "index.ts": `export enum E {
  A,
}
const wide: string = "w";
const { bound } = { bound: "b" } as const;
export function f() {}
f[E.A] = 1;
f[wide] = 2;
f[bound] = 3;
f[later] = 4;
f[1e500] = 5;
const later = "l";
export const arrow = () => {};
arrow[E.A] = 1;
`,
        "nested.js": `export function f() {}
f.inner = function () {};
f.inner.deep = 1;
`,
        "merged.ts": `export function f() {}
export namespace f {
  export let p = 1;
}
const k = "p";
f[k] = 2;
`,
        "alias.ts": `namespace N {
  export let x: string | number = "s";
}
export function f() {}
export namespace f {
  export import p = N.x;
}
const k = "p";
f[k] = 2;
`,
        "prototype.js": `const k = "prototype";
export class K {}
K[k] = 1;
`,
        "twice.ts": `export function f() {}
const k = "p";
f[k] = 1;
f[k] = "s";
`,
      },
      `import { f, arrow } from "../pkg/index.js";
import * as nested from "../pkg/nested.js";
import * as merged from "../pkg/merged.js";
import * as alias from "../pkg/alias.js";
import { K } from "../pkg/prototype.js";
import * as twice from "../pkg/twice.js";
export const host: never = f;
export const A: never = f.A;
export const w: never = f.w;
export const b: never = f.b;
export const l: never = f.l;
export const infinity: never = f.Infinity;
export const other: never = arrow;
export const inner: never = nested.f.inner;
export const deep: never = nested.f.deep;
export const p: never = merged.f.p;
export const aliased: never = alias.f.p;
export const prototype: never = K.prototype;
export const both: never = twice.f.p;
`,
    ),
    lines: [
      "pkg/index.ts(8,1): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ (): void; 0: number; b: number; l: number; Infinity: number; }'.",
      "  No index signature with a parameter of type 'string' was found on type '{ (): void; 0: number; b: number; l: number; Infinity: number; }'.",
      "pkg/index.ts(10,3): error TS2448: Block-scoped variable 'later' used before its declaration.",
      "pkg/index.ts(10,3): error TS2454: Variable 'later' is used before being assigned.",
      "app/main.ts(7,14): error TS2322: Type 'typeof f' is not assignable to type 'never'.",
      "app/main.ts(8,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(9,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(10,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(10,27): error TS2339: Property 'b' does not exist on type 'typeof f'.",
      "app/main.ts(11,14): error TS2322: Type 'any' is not assignable to type 'never'.",
      "app/main.ts(11,27): error TS2339: Property 'l' does not exist on type 'typeof f'.",
      "app/main.ts(12,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(13,14): error TS2322: Type 'typeof arrow' is not assignable to type 'never'.",
      "app/main.ts(14,14): error TS2322: Type '{ (): void; deep: number; }' is not assignable to type 'never'.",
      "app/main.ts(15,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(16,14): error TS2322: Type 'number' is not assignable to type 'never'.",
      "app/main.ts(17,14): error TS2322: Type 'string | number' is not assignable to type 'never'.",
      "  Type 'string' is not assignable to type 'never'.",
      "app/main.ts(18,14): error TS2322: Type 'K' is not assignable to type 'never'.",
      "app/main.ts(19,14): error TS2322: Type 'string | number' is not assignable to type 'never'.",
      "  Type 'string' is not assignable to type 'never'.",
      "pkg/out/alias.d.ts(9,5): error TS2440: Import declaration conflicts with local declaration of 'p'.",
      "pkg/out/merged.d.ts(3,9): error TS2300: Duplicate identifier 'p'.",
      "pkg/out/merged.d.ts(6,9): error TS2300: Duplicate identifier 'p'.",
      "pkg/out/prototype.d.ts(4,9): error TS2300: Duplicate identifier 'prototype'.",
    ],
  },
  // Without a project that references it: one error for each declaration that is emitted with the type. The variable
  // `g` keeps its type, with the property. The function `f` gets a member for `q` alone.
  "a key in parentheses, where the type of the value cannot be named": {
    files: alone(
      { allowJs: true, checkJs: true },
      {
        "hidden.ts": hidden,
        "this.js": `import { make } from "./hidden.js";
export class C {
  constructor() {
    this[("a")] = make();
  }
}
export class S {
  static init() {
    this[("s")] = make();
  }
}
`,
        "exports.cjs": `const { make } = require("./hidden.js");
exports[("a")] = make();
exports["k"] = make();
module.exports[("b")] = make();
`,
        "variable.js": `import { make } from "./hidden.js";
export const g = () => {};
g[("p")] = make();
`,
        "function.ts": `import { recursive } from "./hidden.js";
export function f() {}
f[("p")] = recursive();
f["q"] = recursive();
`,
      },
    ),
    lines: [
      "exports.cjs(2,1): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.",
      "exports.cjs(3,1): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.",
      "exports.cjs(4,1): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.",
      "function.ts(4,1): error TS4032: Property '\"q\"' of exported interface has or is using name 'Recursive' from private module '\"/hidden\"'.",
      "this.js(2,14): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.",
      "this.js(7,14): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.",
      "variable.js(2,14): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.",
    ],
  },
  // `@private` on an assignment is a modifier of it: the declaration has no type, so nothing is left to name.
  // `@protected` and `@readonly` keep the type. So does `@private` in a TypeScript file, where it is no modifier.
  "a `@private` assignment, where the type of the value cannot be named": {
    files: alone(
      { allowJs: true, checkJs: true },
      {
        "hidden.ts": hidden,
        "this.js": `import { make } from "./hidden.js";
export class C {
  constructor() {
    /** @private */
    this[("a")] = make();
    /** @private */
    this["b"] = make();
    /** @private */
    this.c = make();
  }
}
export class Control {
  constructor() {
    /** @protected */
    this.d = make();
  }
}
`,
        "exports.cjs": `const { make } = require("./hidden.js");
/** @private */
exports[("a")] = make();
/** @private */
exports.b = make();
/** @readonly */
exports.control = make();
`,
        "function.js": `import { make, recursive } from "./hidden.js";
export function f() {}
/** @private */
f.p = recursive();
export const g = () => {};
/** @private */
g.p = make();
`,
        "control.ts": `import { recursive } from "./hidden.js";
export function f() {}
/** @private */
f.p = recursive();
`,
      },
    ),
    lines: [
      "control.ts(4,1): error TS4032: Property 'p' of exported interface has or is using name 'Recursive' from private module '\"/hidden\"'.",
      "exports.cjs(7,1): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.",
      "this.js(12,14): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.",
    ],
  },
  // The name in the message is the key, as the source has it. `module.exports = value` has no name.
  "a key in parentheses, where the type of the value needs an import that cannot be written": {
    files: alone(
      { allowJs: true, checkJs: true },
      {
        "node_modules/outer/index.d.ts": `import { Inner } from "inner";\nexport declare function make(): Inner;\n`,
        "node_modules/outer/node_modules/inner/index.d.ts": `export interface Inner {\n  x: number;\n}\n`,
        "index.cjs": `const { make } = require("outer");
exports[("a")] = make();
exports["b"] = make();
exports.c = make();
Object.defineProperty(exports, "d", { value: make() });
`,
        "whole.cjs": `const { make } = require("outer");
module.exports = make();
`,
      },
    ),
    lines: [
      needsAnImport("index.cjs(2,1)", '"a"'),
      needsAnImport("index.cjs(3,1)", '"b"'),
      needsAnImport("index.cjs(4,1)", "c"),
      needsAnImport("index.cjs(5,1)", '"d"'),
      needsAnImport("whole.cjs(2,1)", "(Missing)"),
    ],
  },
  // `undefined` is no error for an export that another assignment declares too, whatever the key is.
  "exports[0] = undefined, before another assignment to it": {
    files: alone(
      { allowJs: true, checkJs: true },
      {
        "index.cjs": `exports[0] = undefined;
exports[0] = 1;
exports[("a")] = undefined;
exports[("a")] = 1;
`,
      },
    ),
    lines: [],
  },
  // TS9013 is for a member that is emitted, and for the type of a variable that keeps its property.
  "f[(key)] = value under isolatedDeclarations": {
    files: alone(
      { isolatedDeclarations: true },
      {
        "index.ts": `export function f(): void {}
f[("p")] = 1;
f["q"] = 2;
export const g = (): void => {};
g[("p")] = 1;
export const h = (): void => {};
h["q"] = 1;
export function only(): void {}
only[("p")] = 1;
`,
      },
    ),
    lines: [
      `index.ts(2,1): error TS9023: ${expandoIsNotDeclared}`,
      `index.ts(3,1): error TS9023: ${expandoIsNotDeclared}`,
      "index.ts(3,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      "index.ts(5,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      `index.ts(7,1): error TS9023: ${expandoIsNotDeclared}`,
      "index.ts(7,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      `index.ts(9,1): error TS9023: ${expandoIsNotDeclared}`,
    ],
  },
  // A key that is no literal: the member is named by the constant or the enum member, and TS9013 is for the member.
  // `fw[wide]` and `fl[later]` name no member. A variable keeps its type, so TS9013 is for every key.
  "f[key] = value under isolatedDeclarations, where a constant or an enum member is the key": {
    files: alone(
      { isolatedDeclarations: true },
      {
        "index.ts": `const k = "p";
const wide: string = "w";
export enum E {
  A,
}
export function fk(): void {}
fk[k] = 1;
export function fw(): void {}
fw[wide] = 1;
export function fe(): void {}
fe[E.A] = 1;
export function fl(): void {}
fl[later] = 1;
export const ak = (): void => {};
ak[k] = 1;
export const ae = (): void => {};
ae[E.A] = 1;
export const al = (): void => {};
al[later] = 1;
const later = "l";
`,
      },
    ),
    lines: [
      `index.ts(7,1): error TS9023: ${expandoIsNotDeclared}`,
      "index.ts(7,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      "index.ts(9,1): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '() => void'.",
      "  No index signature with a parameter of type 'string' was found on type '() => void'.",
      "index.ts(9,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      `index.ts(11,1): error TS9023: ${expandoIsNotDeclared}`,
      "index.ts(11,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      `index.ts(13,1): error TS9023: ${expandoIsNotDeclared}`,
      "index.ts(13,4): error TS2448: Block-scoped variable 'later' used before its declaration.",
      "index.ts(13,4): error TS2454: Variable 'later' is used before being assigned.",
      `index.ts(15,1): error TS9023: ${expandoIsNotDeclared}`,
      "index.ts(15,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      `index.ts(17,1): error TS9023: ${expandoIsNotDeclared}`,
      "index.ts(17,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      "index.ts(19,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.",
      "index.ts(19,4): error TS2448: Block-scoped variable 'later' used before its declaration.",
      "index.ts(19,4): error TS2454: Variable 'later' is used before being assigned.",
    ],
  },
};

// On one thread: the checks run at once, and a debug build is slow to start a thread for every core in each of them.
// differential-cases.json runs the programs on all the threads too.
test.concurrent.each(Object.keys(cases))("%s", async title => {
  const { args = [], files, lines } = cases[title];
  using dir = tempDir("bun-check-assignment-keys", files);
  expect(await linesOf([bunExe(), "check", ...args, "--threads=1"], String(dir), String(dir))).toEqual(lines);
});
