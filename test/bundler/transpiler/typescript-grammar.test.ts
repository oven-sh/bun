import { describe, expect, test } from "bun:test";

// Every source is TypeScript that tsc 6.0.2 parses without a diagnostic.

const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  decorators: new Bun.Transpiler({ loader: "ts", tsconfig }),
};

/** A transpiler, a source, and what Bun prints for the program that tsc reads in the source. */
type Row = [transpiler: keyof typeof transpilers, source: string, expected: string];

/** What `class C { accessor x: T; }` is lowered to where the class has no decorators. */
const accessorX = `import { __privateAdd as __privateAdd_jy12bb7f, __privateGet as __privateGet_t4v9rzz2, __privateSet as __privateSet_3ajc9ey2 } from "bun:wrap";
var _x$1;

class C {
  constructor() {
    __privateAdd_jy12bb7f(this, _x$1, undefined);
  }
  static {
    _x$1 = new WeakMap;
  }
  get x() {
    return __privateGet_t4v9rzz2(this, _x$1);
  }
  set x(v) {
    __privateSet_3ajc9ey2(this, _x$1, v);
  }
}
`;

/** What `class C { static accessor x = 1; }` is lowered to where the class has no decorators. */
const staticAccessorX = `import { __privateAdd as __privateAdd_jy12bb7f, __privateGet as __privateGet_t4v9rzz2, __privateSet as __privateSet_3ajc9ey2 } from "bun:wrap";
var _x$1;

class C {
  static {
    _x$1 = new WeakMap;
  }
  static get x() {
    return __privateGet_t4v9rzz2(this, _x$1);
  }
  static set x(v) {
    __privateSet_3ajc9ey2(this, _x$1, v);
  }
  static {
    __privateAdd_jy12bb7f(this, _x$1, 1);
  }
}
`;

/** The value that `code` passes for the metadata `key`, on one line. */
function design(code: string, key: string): string {
  const match = new RegExp(`\\("design:${key}", ([^]*?)\\),?\\n`).exec(code);
  if (!match) throw new Error(`no design:${key} in\n${code}`);
  return match[1].replace(/\s+/g, " ").replace(/^\[ /, "[").replace(/ \]$/, "]");
}

describe("TypeScript that tsc parses", () => {
  test.each<Row>([
    // A reserved word is the name of a type reference.
    ["ts", "let x: if;", "let x;\n"],
    ["ts", "let x: class;", "let x;\n"],
    ["ts", "let x: function;", "let x;\n"],
    ["ts", "let x: in;", "let x;\n"],
    ["ts", "let x: extends;", "let x;\n"],
    ["ts", "let x: super;", "let x;\n"],
    ["ts", "let x: delete;", "let x;\n"],
    ["ts", "let x: if.x;", "let x;\n"],
    ["ts", "let x: class<T>;", "let x;\n"],
    ["ts", "let x: | if;", "let x;\n"],
    ["ts", "let x: A | if;", "let x;\n"],
    ["ts", "let x: A & class;", "let x;\n"],
    ["ts", "let x: keyof if;", "let x;\n"],
    ["ts", "let x: (if);", "let x;\n"],
    ["ts", "let x: (class);", "let x;\n"],
    ["ts", "let x: `${if}`;", "let x;\n"],
    ["tsx", "let x: if;", "let x;\n"],
    // A reserved word is the label of a rest element of a tuple.
    ["ts", "type X = [...const: A[]];", ""],
    ["ts", "type X = [...in: A[]];", ""],
    ["ts", "type X = [...class: A[]];", ""],
    ["ts", "type X = [...if: A[]];", ""],
    // An import type takes type arguments, and an expression as the value of an attribute.
    ["ts", 'let x: typeof import("x")<C>;', "let x;\n"],
    ["ts", 'type X = typeof import("x")<C>;', ""],
    ["ts", 'let x: import("x")<T>;', "let x;\n"],
    ["ts", 'type X = import("x")<T>;', ""],
    ["ts", 'let x: import("x", { with: { a: "b" } })<T>;', "let x;\n"],
    ["ts", 'let x: import("x", { with: { a: "b" + "c" } });', "let x;\n"],
    ["ts", 'type X = import("x", { with: { a: "b" + "c" } });', ""],
    ["ts", 'let x: import("x").A.<T>;', "let x;\n"],
    ["ts", 'type X = import("x").A.<T>;', ""],
    // The type of an assertion predicate starts on the line after its subject.
    ["ts", "type X = (a) => asserts a\nis B;", ""],
    ["ts", "const f = (a): (a) => asserts a\nis B => 0;", "const f = (a) => 0;\n"],
    ["ts", "const f = (a): asserts a\nis B => 0;", "const f = (a) => 0;\n"],
    ["ts", "const f = (a): asserts this\nis B => 0;", "const f = (a) => 0;\n"],
    ["ts", "function f(): asserts this\nis B { throw 0 }", "function f() {\n  throw 0;\n}\n"],
  ])("type forms: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    // A contextual keyword of an expression is the name of a type alias and of an interface.
    ["ts", "type as = 1", ""],
    ["ts", "declare type as = 1", ""],
    ["ts", "type satisfies = 1", ""],
    ["ts", "interface as {}", ""],
    ["ts", "export interface as {}", ""],
    ["ts", "interface satisfies {}", ""],
    // A parameter of a signature member has an initializer or a modifier.
    ["ts", "type X = { a(b = 1): A };", ""],
    ["ts", "let x: { a(b = 1): A };", "let x;\n"],
    ["ts", "interface I { (a = 1): A }", ""],
    ["ts", "type X = { a(public b: B): A };", ""],
    // An interface extends an expression.
    ["ts", "interface I extends a() {}", ""],
    ["ts", "interface I extends a.b() {}", ""],
  ])("object types: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    // A parameter of a function type has an initializer or a modifier.
    ["ts", "let g: (a = 1) => void;", "let g;\n"],
    ["ts", "let x: ({ a = 1 }) => void;", "let x;\n"],
    ["ts", "let x: (public a: A) => void;", "let x;\n"],
    ["tsx", "let g: (a = 1) => void;", "let g;\n"],
    // An array pattern of a signature has a hole.
    ["ts", "let x: ([a, , b]) => void;", "let x;\n"],
    ["ts", "type X = ([a, , b]) => void;", ""],
    ["ts", "let x: new ([a, , b]) => A;", "let x;\n"],
    ["ts", "type X = { ([a, , b]): void };", ""],
    ["ts", "type X = { new ([a, , b]): A };", ""],
    // A function type with such a parameter is a type argument.
    ["ts", "let x: A<(a = 1) => void>;", "let x;\n"],
    ["ts", "type X = A<([a, , b]) => void>;", ""],
    ["ts", "class C extends B<(a = 1) => void> {}", "class C extends B {\n}\n"],
    // A modifier before a parameter of a function that is no constructor is dropped.
    ["ts", "function f(public a: A) {}", "function f(a) {}\n"],
    // A comma follows the rest parameter of a signature of a declared class.
    ["ts", "declare class C { m(...a,): void; }", ""],
    ["ts", "declare class C { constructor(...a,); }", ""],
    ["ts", "declare class C { m(...a: A[],): void; }", ""],
    ["ts", "declare class C { constructor(...a: A[],); }", ""],
    // A type parameter of a function is named out.
    ["ts", "function f<out>() {}", "function f() {}\n"],
    ["ts", "const f = function <out>() {};", "const f = function() {};\n"],
    ["ts", "function f<out = A>() {}", "function f() {}\n"],
    ["ts", "const f = function <out = A>() {};", "const f = function() {};\n"],
    ["ts", "function f<const out>() {}", "function f() {}\n"],
    ["ts", "const f = function <const out>() {};", "const f = function() {};\n"],
    ["ts", "const f = <out>(a): T => a;", "const f = (a) => a;\n"],
    ["ts", "const f = <out>(a: T) => a;", "const f = (a) => a;\n"],
    ["ts", "const f = <out = A>(a): T => a;", "const f = (a) => a;\n"],
    ["ts", "const f = <out = A>(a: T) => a;", "const f = (a) => a;\n"],
    ["ts", "const f = <const out>(a): T => a;", "const f = (a) => a;\n"],
    ["tsx", "const f = function g<out>() {};", "const f = function g() {};\n"],
    ["tsx", "async function f<out>() {}", "async function f() {}\n"],
    ["tsx", "const f = function g<out = A>() {};", "const f = function g() {};\n"],
    ["tsx", "async function f<const out>() {}", "async function f() {}\n"],
    ["tsx", "const f = <out = A>() => 0;", "const f = () => 0;\n"],
    ["tsx", "const f = async <out = A>() => 0;", "const f = async () => 0;\n"],
  ])("signatures, type parameters and type arguments: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    // The type of a type assertion is named out or is a reserved word.
    ["ts", "const v = <out>x;", "const v = x;\n"],
    ["ts", "<out>x;", "x;\n"],
    ["ts", "const v = <out>(x);", "const v = x;\n"],
    ["ts", "const v = <in>x;", "const v = x;\n"],
    ["ts", "const v = <in>(x);", "const v = x;\n"],
    ["ts", "const v = <if>x;", "const v = x;\n"],
    ["ts", "const v = <class>x;", "const v = x;\n"],
    ["ts", "const v = <enum>x;", "const v = x;\n"],
    // A type parameter of an arrow function is named out.
    ["ts", "const v = <out>(x) => x;", "const v = (x) => x;\n"],
    ["ts", "const v = <out, T>(x) => x;", "const v = (x) => x;\n"],
    ["ts", "const v = <out = A>(x) => x;", "const v = (x) => x;\n"],
    ["tsx", "f(<out, T>(x) => x);", "f((x) => x);\n"],
    ["tsx", "f(<out = A>(x) => x);", "f((x) => x);\n"],
    // The type after as, after satisfies and of a return is a reserved word.
    ["ts", "const v = x as if;", "const v = x;\n"],
    ["ts", "const v = x as var;", "const v = x;\n"],
    ["ts", "const v = x satisfies if;", "const v = x;\n"],
    ["ts", "const v = (): if => x;", "const v = () => x;\n"],
    ["tsx", "x as if;", "x;\n"],
    ["tsx", "x as var;", "x;\n"],
    // A comparison follows the type after as and satisfies.
    ["ts", "const v = x as T <= y;", "const v = x <= y;\n"],
    ["ts", "x as T <= y;", "x <= y;\n"],
    ["ts", "const v = x satisfies T <= y;", "const v = x <= y;\n"],
    ["tsx", "f(x as T <= y);", "f(x <= y);\n"],
    ["tsx", "const v = [x as T <= y];", "const v = [x <= y];\n"],
    // The colon of a conditional follows an operand or the body of an arrow function in parentheses.
    ["ts", "x = a ? 1 + async(b) : c;", "x = a ? 1 + async(b) : c;\n"],
    ["ts", "x = a ? -<T>(b) : c;", "x = a ? -b : c;\n"],
    ["ts", "x = a ? <T>(b) : c => d;", "x = a ? b : (c) => d;\n"],
    ["ts", "x = a ? y => (b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
    ["ts", "x = a ? (y) => (b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
    ["ts", "x = a ? <T>(y: T) => (b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
    ["tsx", "x = a ? y => ({ y }) : z => ({ z });", "x = a ? (y) => ({ y }) : (z) => ({ z });\n"],
  ])("expressions: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    // A comma ends an index signature.
    ["ts", "class C { [k: string]: T, }", "class C {\n}\n"],
    ["ts", "abstract class C extends B { [k: string]: T, }", "class C extends B {\n}\n"],
    ["ts", "const c = class { [k: string]: T, };", "const c = class {\n};\n"],
    ["ts", "declare class C { [k: string]: T, }", ""],
    // A modifier before a parameter of a method is dropped.
    ["ts", "class C { m(public a: A) {} }", "class C {\n  m(a) {}\n}\n"],
    // A class implements an expression.
    ["ts", "class C implements a() {}", "class C {\n}\n"],
    // With experimentalDecorators, accessor is a modifier in a class without decorators.
    ["decorators", "class C { accessor x: T; }", accessorX],
    ["decorators", "class C { static accessor x = 1; }", staticAccessorX],
    ["decorators", "class C { accessor #x: T; }", "class C {\n  #x;\n}\n"],
    ["decorators", "class C { static accessor #x = 1; }", "class C {\n  static #x = 1;\n}\n"],
    ["decorators", "abstract class C extends B { abstract accessor x: T; }", "class C extends B {\n}\n"],
    ["decorators", "declare class C { accessor x: T; }", ""],
  ])("class members: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    // The attributes of an import start on the next line.
    ["ts", 'import A from "x"\nwith { type: "json" };', 'import A from "x";\n'],
    // A statement of a namespace starts with import and is no import.
    ["ts", 'namespace N { import("x"); }', 'var N;\n((N) => {\n  import("x");\n})(N ||= {});\n'],
    ["ts", "namespace N { import.meta; }", "var N;\n((N) => {})(N ||= {});\n"],
    // abstract stands before declare.
    ["ts", "abstract declare class C {}", ""],
    ["ts", "export abstract declare class C {}", ""],
    // The name of an enum member is a string in brackets.
    ["ts", 'enum E { ["x"] }', 'var E;\n((E) => {\n  E[E["x"] = 0] = "x";\n})(E ||= {});\n'],
    ["ts", 'enum E { ["x"] = 1 }', 'var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n})(E ||= {});\n'],
    [
      "ts",
      "enum E { ['x'] = 1, B = E.x }",
      'var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n  E[E["B"] = 1] = "B";\n})(E ||= {});\n',
    ],
    ["ts", "enum E { [`x`] = 1 }", 'var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n})(E ||= {});\n'],
    // A contextual keyword of an expression is the name of a namespace.
    ["ts", "namespace as {}", ""],
    ["ts", "declare namespace as {}", ""],
    ["ts", "namespace as { export const x = 1; }", "var as;\n((as) => {\n  as.x = 1;\n})(as ||= {});\n"],
    [
      "ts",
      "namespace as.b { export const x = 1; }",
      "var as;\n((as) => {\n  let b;\n  ((b) => {\n    b.x = 1;\n  })(b = as.b ||= {});\n})(as ||= {});\n",
    ],
    [
      "ts",
      "namespace satisfies { export const x = 1; }",
      "var satisfies;\n((satisfies) => {\n  satisfies.x = 1;\n})(satisfies ||= {});\n",
    ],
  ])("module syntax: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  // Each tag is the one of tsc with strictNullChecks off; a name that tsc guards has the guard of Bun.
  test.each<[source: string, key: string, expected: string]>([
    // The operands of | and & are the check type of a conditional type.
    ["class C { @d p: number | A extends B ? string : never; }", "type", "String"],
    ["class C { @d p: K & A extends B ? string : never; }", "type", "String"],
    ["class C { @d p: K | A extends B ? string[] : number[]; }", "type", "Array"],
    ["class C { @d p: string | A extends B ? () => void : () => void; }", "type", "Function"],
    ["class C { @d p: K | A extends B ? null : K; }", "type", "Object"],
    ["class C { @d m(a: number | A extends B ? string : string) {} }", "paramtypes", "[String]"],
    ["class C { @d m(): string & A extends B ? never : string { throw 0 } }", "returntype", "String"],
    // The operand of keyof, readonly and unique ends before extends.
    ["class C { @d p: keyof A extends B ? string : never; }", "type", "String"],
    ["class C { @d p: readonly A[] extends B ? string : number; }", "type", "Object"],
    ["class C { @d p: unique symbol extends B ? string : never; }", "type", "String"],
    ["class C { @d m(a: keyof A extends B ? () => void : () => void) {} }", "paramtypes", "[Function]"],
    ["class C { @d m(): readonly A[] extends B ? unknown : string { throw 0 } }", "returntype", "Object"],
    // The type after the colon of a conditional type takes | and &.
    ["class C { @d p: A extends B ? string : never | number; }", "type", "Object"],
    ["class C { @d p: A extends B ? unknown : string & string; }", "type", "Object"],
    // A keyword before a dot is the first name of a type reference.
    ["class C { @d p: any.b; }", "type", 'typeof any === "undefined" || typeof any.b === "undefined" ? Object : any.b'],
    [
      "class C { @d p: string.b; }",
      "type",
      'typeof string === "undefined" || typeof string.b === "undefined" ? Object : string.b',
    ],
    [
      "class C { @d p: bigint.b<T>; }",
      "type",
      'typeof bigint === "undefined" || typeof bigint.b === "undefined" ? Object : bigint.b',
    ],
    ["class C { @d p: undefined.b; }", "type", "Object"],
    [
      "class C { @d m(a: never.b) {} }",
      "paramtypes",
      '[typeof never === "undefined" || typeof never.b === "undefined" ? Object : never.b]',
    ],
    // unique takes the whole type after it.
    ["class C { @d p: unique symbol[]; }", "type", "Object"],
    ["class C { @d p: unique [A]; }", "type", "Object"],
    // The branches of a conditional type merge as the operands of | do.
    ["class C { @d p: X extends Y ? number : never; }", "type", "Number"],
    ["class C { @d p: X extends Y ? K : K; }", "type", "Object"],
    ["class C { @d p: X extends Y ? A : (A | null); }", "type", "Object"],
    ["class C { @d p: (X extends Y ? string : unknown); }", "type", "Object"],
    ["class C { @d p: X extends infer U extends V ? string : never; }", "type", "String"],
    // An operand of | and & counts as what it serializes to.
    ["class C { @d p: string | (never | never); }", "type", "Object"],
    ["class C { @d p: (null | undefined) | string; }", "type", "Object"],
    ["class C { @d p: A.B | C.D; }", "type", "Object"],
    ["class C { @d m(a: A.B & A.C) {} }", "paramtypes", "[Object]"],
    // An import type and unique symbol are Object.
    ["class C { @d p: A | unique symbol; }", "type", "Object"],
    ['class C { @d p: import("x") | A; }', "type", "Object"],
    ['class C { @d p: import("x")["y"]; }', "type", "Object"],
    // A type predicate is Boolean and an assertion predicate is undefined.
    ["class C { @d p: this is B; }", "type", "Boolean"],
    ["class C { @d m(): a is B { throw 0 } }", "returntype", "Boolean"],
    ["class C { @d m(): a is B | C { throw 0 } }", "returntype", "Boolean"],
    ["class C { @d m(): string is B { throw 0 } }", "returntype", "Boolean"],
    ["class C { @d m(): asserts a { throw 0 } }", "returntype", "undefined"],
    ["class C { @d m(): asserts a is B { throw 0 } }", "returntype", "undefined"],
    ["class C { @d m(): asserts this is B { throw 0 } }", "returntype", "undefined"],
    ["class C { @d m(): asserts a | B { throw 0 } }", "returntype", "Object"],
    ["class C { @d m(): A | asserts a { throw 0 } }", "returntype", "Object"],
  ])("decorator metadata: %j passes design:%s", (source, key, expected) => {
    expect(design(transpilers.decorators.transformSync(source), key)).toBe(expected);
  });
});
