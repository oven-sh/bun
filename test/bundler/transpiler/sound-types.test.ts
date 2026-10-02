import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { itBundled } from "../expectBundled";

const Undefined = 1,
  Null = 2,
  Boolean_ = 4,
  Number_ = 8,
  String_ = 16,
  Symbol_ = 32,
  BigInt_ = 64,
  Function_ = 128,
  Array_ = 256,
  OtherObject = 512;
const typedArray = (kind: number) => OtherObject | ((kind + 1) << 10);
const Uint8Array_ = typedArray(1),
  Int32Array_ = typedArray(5),
  Float64Array_ = typedArray(9);
const AnyObject = Function_ | Array_ | OtherObject;
const NonNullish = 1023 & ~(Undefined | Null);
const Top = null;

const shim = /* js */ `
  globalThis.$$t = function (value, mask) {
    const tag =
      value === undefined ? 1
      : value === null ? 2
      : typeof value === "boolean" ? 4
      : typeof value === "number" ? 8
      : typeof value === "string" ? 16
      : typeof value === "symbol" ? 32
      : typeof value === "bigint" ? 64
      : typeof value === "function" ? 128
      : Array.isArray(value) ? 256
      : 512;
    if (!(tag & mask)) throw new TypeError("tag " + tag + " is not in mask " + mask);
    if (tag === 512 && mask >> 10) {
      const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
      if (!(value instanceof kinds[(mask >> 10) - 1])) throw new TypeError("not the typed array of mask " + mask);
    }
    return value;
  };
`;
(0, eval)(shim);

const transpilers = {
  off: new Bun.Transpiler({ loader: "ts" }),
  basic: new Bun.Transpiler({ loader: "ts", soundTypes: true }),
  full: new Bun.Transpiler({ loader: "ts", soundTypes: "full" }),
  infer: new Bun.Transpiler({ loader: "ts", soundTypes: "infer" }),
};

function emit(source: string, level: keyof typeof transpilers = "basic"): string {
  return transpilers[level].transformSync(source).trim();
}

function run(source: string, level: keyof typeof transpilers = "basic"): unknown[] {
  const reported: unknown[] = [];
  new Function("out", emit(source, level))((...values: unknown[]) => reported.push(...values));
  return reported;
}

function maskOf(type: string, declarations = ""): number | null {
  const output = emit(`${declarations}\nexport function probe(value: ${type}) {}`);
  const checks = [...output.matchAll(/\$\$t\(value, (\d+)\)/g)];
  expect(checks.length).toBeLessThanOrEqual(1);
  return checks.length ? Number(checks[0][1]) : Top;
}

describe("type -> mask", () => {
  test.each([
    ["number", Number_],
    ["1", Number_],
    ["-1", Number_],
    ["string", String_],
    ["'a'", String_],
    ["`a`", String_],
    ["`a${string}b`", String_],
    ["boolean", Boolean_],
    ["true", Boolean_],
    ["false", Boolean_],
    ["bigint", BigInt_],
    ["1n", BigInt_],
    ["-1n", BigInt_],
    ["symbol", Symbol_],
    ["unique symbol", Symbol_],
    ["undefined", Undefined],
    ["null", Null],
    ["void", Top],
    ["any", Top],
    ["unknown", Top],
    ["never", Top],
    ["this", Top],
    ["object", AnyObject],
    ["{}", NonNullish],
    ["Object", NonNullish],
    ["{ a: number }", AnyObject],
    ["{ a?: number }", AnyObject],
    ["{ [key: string]: number }", AnyObject],
    ["{ [K in 'a' | 'b']: number }", AnyObject],
    ["{ [K in keyof Unresolved]: number }", Top],
    ["{ readonly [K in keyof Unresolved]?: Unresolved[K] }", Top],
    ["{ readonly a: number; b(): void }", AnyObject],
    ["{ (a: number): void }", Function_],
    ["{ <T>(a: T): void }", Function_],
    ["{ new (a: number): object }", Function_],
    ["{ (a: number): void; extra: number }", Function_],
    ["{ length: number }", NonNullish],
    ["{ toString(): string }", NonNullish],
    ["{ length: number; a: number }", AnyObject],
    ["() => void", Function_],
    ["(a: number, b?: string) => number", Function_],
    ["<T>(a: T) => T", Function_],
    ["new () => object", Function_],
    ["abstract new () => object", Function_],
    ["Function", Function_],
    ["number[]", Array_],
    ["number[][]", Array_],
    ["readonly number[]", Array_],
    ["[number, string]", Array_],
    ["readonly [a: number, b?: string]", Array_],
    ["[]", Array_],
    ["Array<number>", Array_],
    ["ReadonlyArray<number>", Array_],
    ["(number | string)[]", Array_],
    ["unknown[]", Array_],
    ["Promise<number>", OtherObject],
    ["Map<string, number>", OtherObject],
    ["Set<string>", OtherObject],
    ["WeakMap<object, number>", OtherObject],
    ["WeakSet<object>", OtherObject],
    ["Date", OtherObject],
    ["RegExp", OtherObject],
    ["Error", OtherObject],
    ["TypeError", OtherObject],
    ["ArrayBuffer", OtherObject],
    ["Uint8Array", Uint8Array_],
    ["Float64Array", Float64Array_],
    ["Int32Array", Int32Array_],
    ["Buffer", Uint8Array_],
    ["Float64Array | null", Float64Array_ | Null],
    ["Float64Array | number[]", Float64Array_ | Array_],
    ["Float64Array | Int32Array", OtherObject],
    ["Float64Array | Map<string, number>", OtherObject],
    ["DataView", OtherObject],
    ["URL", OtherObject],
    ["AbortSignal", OtherObject],
    ["AbortController", OtherObject],
    ["Record<string, number>", AnyObject],
    ["Readonly<number[]>", Array_],
    ["Readonly<{ a: number }>", AnyObject],
    ["Partial<{ a: number }>", AnyObject],
    ["NonNullable<string | null | undefined>", String_],
    ["NonNullable<unknown>", NonNullish],
    ["Exclude<string | number, number>", String_ | Number_],
    ["Uppercase<'a'>", String_],
    ["ReturnType<typeof probe>", Top],
    ["Awaited<Promise<number>>", Top],
    ["Iterable<number>", Top],
    ["ArrayLike<number>", Top],
    ["number | string", Number_ | String_],
    ["| number | string", Number_ | String_],
    ["number | null", Number_ | Null],
    ["number | undefined | null", Number_ | Undefined | Null],
    ["'a' | 'b' | 1", String_ | Number_],
    ["number | any", Top],
    ["number | unknown", Top],
    ["number | void", Top],
    ["number | Unresolved", Top],
    ["string[] | null", Array_ | Null],
    ["(() => void) | undefined", Function_ | Undefined],
    ["(number)", Number_],
    ["((number | string))", Number_ | String_],
    ["{ a: number } & { b: number }", AnyObject],
    ["(() => void) & { extra: number }", Function_],
    ["number[] & { extra: number }", Array_],
    ["string & { __brand: 'x' }", String_],
    ["{ __brand: 'x' } & number", Number_],
    ["(string | number) & { __brand: 'x' }", String_ | Number_],
    ["(string | { a: number }) & { __brand: 'x' }", String_ | AnyObject],
    ["(string | null) & {}", String_],
    ["Unresolved & { __brand: 'x' }", Top],
    ["Unresolved & string", String_],
    ["string & number", Top],
    ["keyof { a: number }", String_ | Number_ | Symbol_],
    ["keyof Unresolved", String_ | Number_ | Symbol_],
    ["typeof probe", Top],
    ["typeof globalThis.Array", Top],
    ["{ a: number }['a']", Top],
    ["number[][number]", Top],
    ["number extends string ? number : string", Top],
    ["import('fs').Stats", Top],
    ["Unresolved", Top],
    ["Unresolved<number>", Top],
    ["Unresolved.Member", Top],
    ["Unresolved[]", Array_],
  ])("%s", (type, mask) => {
    expect(maskOf(type)).toBe(mask);
  });

  test("aliases", () => {
    expect(maskOf("Id", "type Id = string | number;")).toBe(String_ | Number_);
    expect(maskOf("Id | null", "type Id = string | number;")).toBe(String_ | Number_ | Null);
    expect(maskOf("Id[]", "type Id = string | number;")).toBe(Array_);
    expect(maskOf("A", "type A = B; type B = C; type C = bigint;")).toBe(BigInt_);
    expect(maskOf("Brand", "type Brand = string & { __brand: 'x' };")).toBe(String_);
    expect(maskOf("A", "type A = Unresolved;")).toBe(Top);
    expect(maskOf("A", "type A = any;")).toBe(Top);
  });

  test("an alias declared after its use", () => {
    const output = emit(`
      export function f(value: Later) {}
      type Later = Latest | null;
      type Latest = number;
    `);
    expect(output).toContain(`$$t(value, ${Number_ | Null})`);
  });

  test("alias cycles", () => {
    expect(maskOf("A", "type A = B | number; type B = A | string;")).toBe(Top);
    expect(maskOf("B", "type A = B | number; type B = A | string;")).toBe(Top);
    expect(maskOf("A", "type A = A;")).toBe(Top);
    expect(maskOf("Json", "type Json = string | number | boolean | null | Json[] | { [key: string]: Json };")).toBe(
      String_ | Number_ | Boolean_ | Null | AnyObject,
    );
    expect(maskOf("List", "type List = { next: List | null };")).toBe(AnyObject);
  });

  test("generic aliases only resolve where the type argument cannot matter", () => {
    expect(maskOf("Box<string>", "type Box<T> = { value: T };")).toBe(AnyObject);
    expect(maskOf("Fn<string>", "type Fn<T> = (value: T) => void;")).toBe(Function_);
    expect(maskOf("List<string>", "type List<T> = T[];")).toBe(Array_);
    expect(maskOf("Maybe<string>", "type Maybe<T> = T | null;")).toBe(Top);
    expect(maskOf("Same<string>", "type Same<T> = T;")).toBe(Top);
    expect(maskOf("Brand<string>", "type Brand<T> = T & { __brand: 'x' };")).toBe(Top);
    expect(maskOf("Deep<string>", "type Deep<T> = { readonly [K in keyof T]: Deep<T[K]> };")).toBe(Top);
  });

  test("type parameters", () => {
    for (const source of [
      "export function f<T>(value: T) {}",
      "export function f<T extends string>(value: T) {}",
      "export function f<T>(value: T | null) {}",
      "export const f = <T,>(value: T) => {};",
      "export class C<T> { m(value: T) {} }",
      "export class C { m<T>(value: T) {} }",
      "export const o = { m<T>(value: T) {} };",
      "type T = string; export function f<T>(value: T) {}",
      "export function f<Map>(value: Map) {}",
    ]) {
      expect(emit(source)).not.toContain("$$t");
    }
    expect(emit("export function f<T>(value: T[], other: number) {}")).toContain(`$$t(value, ${Array_})`);
  });

  test("interfaces", () => {
    expect(maskOf("I", "interface I { a: number }")).toBe(AnyObject);
    expect(maskOf("I", "interface I { (a: number): void }")).toBe(AnyObject);
    expect(maskOf("I", "interface I { a: number } interface I { b: number }")).toBe(AnyObject);
    expect(maskOf("I<string>", "interface I<T> { a: T }")).toBe(AnyObject);
    expect(maskOf("I", "interface I extends Unresolved { a: number }")).toBe(AnyObject);
    expect(maskOf("I", "interface I {}")).toBe(NonNullish);
    expect(maskOf("I", "interface I { length: number }")).toBe(NonNullish);
  });

  test("classes", () => {
    expect(maskOf("C", "class C {}")).toBe(OtherObject);
    expect(maskOf("C", "abstract class C {}")).toBe(OtherObject);
    expect(maskOf("C", "declare class C {}")).toBe(OtherObject);
    expect(maskOf("C<string>", "class C<T> { a!: T }")).toBe(OtherObject);
    expect(maskOf("D", "class C {} class D extends C {}")).toBe(OtherObject);
    expect(maskOf("D", "class D extends Error {}")).toBe(OtherObject);
    expect(maskOf("D", "class D extends Array<number> {}")).toBe(Array_);
    expect(maskOf("D", "class D extends Function {}")).toBe(Function_);
    expect(maskOf("D", "class D extends Unresolved {}")).toBe(AnyObject);
    expect(maskOf("D", "class D extends mixin(Object) {}")).toBe(AnyObject);
    expect(maskOf("C", "class C {} interface C { a: number }")).toBe(AnyObject);
  });

  test("enums", () => {
    expect(maskOf("E", "enum E { A, B }")).toBe(Number_);
    expect(maskOf("E", "enum E { A = 1, B = 2 }")).toBe(Number_);
    expect(maskOf("E", "const enum E { A, B }")).toBe(Number_);
    expect(maskOf("E", "declare enum E { A, B }")).toBe(Number_);
    expect(maskOf("E", "enum E { A = 'a', B = 'b' }")).toBe(String_);
    expect(maskOf("E", "enum E { A = 1, B = 'b' }")).toBe(Number_ | String_);
    expect(maskOf("E", "enum E { A = 'a'.length }")).toBe(Number_ | String_);
    expect(maskOf("E", "enum E { A } enum E { B = 'b' }")).toBe(Number_ | String_);
    expect(maskOf("E.A", "enum E { A, B }")).toBe(Number_);
    expect(maskOf("E.A | null", "enum E { A = 'a' }")).toBe(String_ | Null);
    expect(maskOf("E.A.B", "enum E { A }")).toBe(Top);
  });

  test("a declaration shadows the global type with its name", () => {
    expect(maskOf("Map<string, number>")).toBe(OtherObject);
    expect(maskOf("Map", "type Map = string;")).toBe(String_);
    expect(maskOf("Map", "interface Map { a: number }")).toBe(AnyObject);
    expect(maskOf("Map", "import { Map } from 'immutable';")).toBe(Top);
    expect(maskOf("Map", "import type { Map } from 'immutable';")).toBe(Top);
    expect(maskOf("Map", "import { type Map } from 'immutable';")).toBe(Top);
    expect(maskOf("Map", "import { type Other as Map } from 'immutable';")).toBe(Top);
    expect(maskOf("Map", "import Map from 'immutable';")).toBe(Top);
    expect(maskOf("Map", "import type Map from 'immutable';")).toBe(Top);
    expect(maskOf("Map", "import * as Map from 'immutable';")).toBe(Top);
    expect(maskOf("Map", "import Map = require('immutable');")).toBe(Top);
    expect(maskOf("Map", "const Map = 1;")).toBe(Top);
    expect(maskOf("Map", "function Map() {}")).toBe(Top);
    expect(maskOf("Map", "namespace Map { export const a = 1; }")).toBe(Top);
    expect(maskOf("Array<number>", "type Array<T> = T;")).toBe(Top);
    expect(maskOf("Readonly<number[]>", "type Readonly<T> = string;")).toBe(String_);
  });

  test("declarations in nested scopes make the name unknown", () => {
    expect(maskOf("A", "type A = string; function g() { type A = number; }")).toBe(Top);
    expect(maskOf("A", "type A = string; { interface A {} }")).toBe(Top);
    expect(maskOf("A", "type A = string; function g() { class A {} }")).toBe(Top);
    expect(maskOf("A", "type A = string; function g() { enum A {} }")).toBe(Top);
    expect(maskOf("A", "type A = string; const c = class A {};")).toBe(Top);
    expect(maskOf("A", "type A = string; namespace N { export type A = number; }")).toBe(Top);
    expect(maskOf("N.A", "namespace N { export type A = number; }")).toBe(Top);
    expect(maskOf("String", "declare global { interface String { extra(): void } }")).toBe(Top);
    expect(maskOf("A", "type A = string; type A = number;")).toBe(Top);
  });
});

describe("parameters", () => {
  test("are checked on entry, after the directive prologue", () => {
    expect(
      emit(`
        export function f(a: number, b: string) {
          "use strict";
          "use other";
          return a;
        }
      `),
    ).toMatchInlineSnapshot(`
      "export function f(a, b) {
        "use other";
        $$t(a, 8);
        $$t(b, 16);
        return a;
      }"
    `);
  });

  test("optional, defaulted, destructured, rest and this parameters", () => {
    expect(
      emit(`
        export function f(this: Window, a?: number, b: string = "x", { c }: { c: number }, [d]: number[], ...e: number[]) {}
      `),
    ).toMatchInlineSnapshot(`
      "export function f(a, b = "x", { c }, [d], ...e) {
        $$t(a, 9);
        $$t(b, 16);
      }"
    `);
    expect(run(`function f(a: string = "x") { return a; } out(f(), f(undefined), f("y"));`)).toEqual(["x", "x", "y"]);
    expect(() => run(`function f(a: string = "x") {} f(null as any);`)).toThrow(TypeError);
    expect(run(`function f(a?: string) { return a; } out(f(), f("y"));`)).toEqual([undefined, "y"]);
    expect(() => run(`function f(a?: string) {} f(null as any);`)).toThrow(TypeError);
  });

  test("of arrow functions", () => {
    expect(
      emit(`
        export const a = (x: number) => x + 1;
        export const b = (x: number, y?: string, z: boolean = true) => { return x; };
        export const c = async (x: number) => x;
        export const d = (x: unknown, y) => x;
        export const e = ({ x }: { x: number }, ...rest: number[]) => x;
        export const f = (x: number) => ({ x });
        export const g = (x: number) => (y: string) => x + y;
      `),
    ).toMatchInlineSnapshot(`
      "export const a = (x) => ($$t(x, 8), x + 1);
      export const b = (x, y, z = true) => {
        $$t(x, 8);
        $$t(y, 17);
        $$t(z, 4);
        return x;
      };
      export const c = async (x) => ($$t(x, 8), x);
      export const d = (x, y) => x;
      export const e = ({ x }, ...rest) => x;
      export const f = (x) => ($$t(x, 8), { x });
      export const g = (x) => ($$t(x, 8), (y) => ($$t(y, 16), x + y));"
    `);
    expect(run(`const f = (x: number) => x + 1; out(f(1));`)).toEqual([2]);
    expect(() => run(`const f = (x: number) => x + 1; f("1" as any);`)).toThrow(TypeError);
  });

  test("of methods, accessors, constructors and function expressions", () => {
    expect(
      emit(`
        export class C {
          constructor(a: number) {}
          m(a: string) {}
          static s(a: boolean) {}
          set v(a: bigint) {}
          #p(a: symbol) {}
          async am(a: number) {}
          *gm(a: number) {}
        }
        export const o = { m(a: number) {}, set v(a: string) {}, f: function (a: boolean) {} };
      `),
    ).toMatchInlineSnapshot(`
      "export class C {
        constructor(a) {
          $$t(a, 8);
        }
        m(a) {
          $$t(a, 16);
        }
        static s(a) {
          $$t(a, 4);
        }
        set v(a) {
          $$t(a, 64);
        }
        #p(a) {
          $$t(a, 32);
        }
        async am(a) {
          $$t(a, 8);
        }
        *gm(a) {
          $$t(a, 8);
        }
      }
      export const o = { m(a) {
        $$t(a, 8);
      }, set v(a) {
        $$t(a, 16);
      }, f: function(a) {
        $$t(a, 4);
      } };"
    `);
  });

  test("parameter properties", () => {
    expect(
      emit(`
        export class C {
          constructor(private a: number, public readonly b?: string, c: boolean) {}
        }
        export class D extends C {
          constructor(private d: number) {
            super(d, "", true);
          }
        }
      `),
    ).toMatchInlineSnapshot(`
      "export class C {
        a;
        b;
        constructor(a, b, c) {
          $$t(a, 8);
          $$t(b, 17);
          $$t(c, 4);
          this.a = a;
          this.b = b;
        }
      }

      export class D extends C {
        d;
        constructor(d) {
          $$t(d, 8);
          super(d, "", true);
          this.d = d;
        }
      }"
    `);
    expect(() => run(`class C { constructor(public a: number) {} } new C("1" as any);`)).toThrow(TypeError);
    expect(run(`class C { constructor(public a: number) {} } out(new C(1).a);`)).toEqual([1]);
  });

  test("overloads, declarations and abstract methods emit nothing", () => {
    expect(
      emit(`
        export function f(a: number): number;
        export function f(a: string): string;
        export function f(a: any): any { return a; }
        declare function g(a: number): number;
        export abstract class C { abstract m(a: number): number; }
        declare class D { m(a: number): number; }
        declare const x: number;
        declare let y: number;
      `),
    ).not.toContain("$$t");
  });

  test("assignments to a parameter are checked", () => {
    expect(
      emit(`
        export function f(a: number, b?: string) {
          a = g();
          b = g();
        }
        export const h = (a: number) => { a = g(); };
      `),
    ).toMatchInlineSnapshot(`
      "export function f(a, b) {
        $$t(a, 8);
        $$t(b, 17);
        a = $$t(g(), 8);
        b = $$t(g(), 17);
      }
      export const h = (a) => {
        $$t(a, 8);
        a = $$t(g(), 8);
      };"
    `);
  });
});

describe("returns", () => {
  test("of the annotated function only", () => {
    expect(
      emit(`
        export function f(): number {
          function inner() { return g(); }
          const arrow = () => g();
          const typed = (): string => g();
          class C { m() { return g(); } }
          if (g()) return;
          if (g()) return g();
          for (;;) { return g(); }
        }
      `),
    ).toMatchInlineSnapshot(`
      "export function f() {
        function inner() {
          return g();
        }
        const arrow = () => g();
        const typed = () => $$t(g(), 16);

        class C {
          m() {
            return g();
          }
        }
        if (g())
          return;
        if (g())
          return $$t(g(), 8);
        for (;; ) {
          return $$t(g(), 8);
        }
      }"
    `);
  });

  test("of arrows, methods and getters", () => {
    expect(
      emit(`
        export const a = (): number => g();
        export const b = (): number => { return g(); };
        export const c = (x): x is string => g();
        export class C {
          m(): string { return g(); }
          get v(): boolean { return g(); }
          static s(): bigint { return g(); }
        }
        export const o = { m(): number { return g(); }, get v(): string { return g(); } };
      `),
    ).toMatchInlineSnapshot(`
      "export const a = () => $$t(g(), 8);
      export const b = () => {
        return $$t(g(), 8);
      };
      export const c = (x) => $$t(g(), 4);

      export class C {
        m() {
          return $$t(g(), 16);
        }
        get v() {
          return $$t(g(), 4);
        }
        static s() {
          return $$t(g(), 64);
        }
      }
      export const o = { m() {
        return $$t(g(), 8);
      }, get v() {
        return $$t(g(), 16);
      } };"
    `);
  });

  test("async functions and generators are left alone", () => {
    expect(
      emit(`
        export async function a(): Promise<number> { return g(); }
        export const b = async (): Promise<number> => g();
        export const c = async (): Promise<number> => { return g(); };
        export function* d(): Generator<number, string> { return g(); }
        export async function* e(): AsyncGenerator<number, string> { return g(); }
        export class C { async m(): Promise<number> { return g(); } *n(): Generator<number> { return g(); } }
      `),
    ).not.toContain("$$t");
  });

  test("void, never, assertion and generic return types are not checked", () => {
    expect(
      emit(`
        export function a(): void { return g(); }
        export function b(): never { return g(); }
        export function c(x): asserts x { return g(); }
        export function d(x): asserts x is string { return g(); }
        export function e<T>(): T { return g(); }
        export function f(): any { return g(); }
        export class C { m(): this { return g(); } }
      `),
    ).not.toContain("$$t");
    expect(emit(`export function f(x): x is string { return g(); }`)).toContain(`return $$t(g(), ${Boolean_})`);
    expect(emit(`export class C { m(): this is C { return g(); } }`)).toContain(`return $$t(g(), ${Boolean_})`);
  });

  test("a conditional whose branch looks like an arrow with a return type", () => {
    expect(
      emit(`
        export const a = g() ? (x) : y => z;
        export const b = g() ? (x): number => g() : y;
      `),
    ).toMatchInlineSnapshot(`
      "export const a = g() ? x : (y) => z;
      export const b = g() ? (x) => $$t(g(), 8) : y;"
    `);
  });

  test("throw when the value has the wrong tag", () => {
    expect(run(`function f(x: any): number { return x; } out(f(1));`)).toEqual([1]);
    expect(() => run(`function f(x: any): number { return x; } f("1");`)).toThrow(TypeError);
    expect(() => run(`const f = (x: any): number[] => x; f({ length: 0 });`)).toThrow(TypeError);
  });
});

describe("variables", () => {
  test("initializers", () => {
    expect(
      emit(`
        let a: number = g();
        const b: string | null = g();
        var c: number[] = g();
        let d: number;
        let e!: number;
        let f: any = g();
        const { h }: { h: number } = g();
        for (let i: number = g(); ; ) {}
        export { a, b, c, d, e, f, h };
      `),
    ).toMatchInlineSnapshot(`
      "let a = $$t(g(), 8);
      const b = $$t(g(), 18);
      var c = $$t(g(), 256);
      let d;
      let e;
      let f = g();
      const { h } = $$t(g(), 896);
      for (let i = $$t(g(), 8);; ) {}

      export { a, b, c, d, e, f, h };"
    `);
  });

  test("assignments", () => {
    expect(
      emit(`
        let n: number = g();
        n = g();
        n ||= g();
        n &&= g();
        n ??= g();
        n += g();
        n -= g();
        n *= g();
        n **= g();
        n >>>= g();
        n++;
        --n;
        [n] = g();
        ({ n } = g());
        for (n of g()) {}
        for (n in g()) {}
        export { n };
      `),
    ).toMatchInlineSnapshot(`
      "let n = $$t(g(), 8);
      n = $$t(g(), 8);
      n ||= $$t(g(), 8);
      n &&= $$t(g(), 8);
      n ??= $$t(g(), 8);
      n = $$t(n + g(), 8);
      n -= g();
      n *= g();
      n **= g();
      n >>>= g();
      n++;
      --n;
      [n] = g();
      ({ n } = g());
      for (n of g()) {}
      for (n in g()) {}

      export { n };"
    `);
  });

  test("compound assignments to a variable that is not only numeric", () => {
    expect(
      emit(`
        let s: string | number = g();
        s += g();
        s -= g();
        s |= g();
        s++;
        let t: string = g();
        t += "x";
        t += g();
        export { s, t };
      `),
    ).toMatchInlineSnapshot(`
      "let s = $$t(g(), 24);
      s = $$t(s + g(), 24);
      s = $$t(s - g(), 24);
      s = $$t(s | g(), 24);
      s++;
      let t = $$t(g(), 16);
      t += "x";
      t = $$t(t + g(), 16);

      export { s, t };"
    `);
    expect(run(`let s: string = "a"; s += 1; out(s);`)).toEqual(["a1"]);
    expect(() => run(`const v: any = "1"; let n: number = 1; n += v;`)).toThrow(TypeError);
    expect(() => run(`let s: string = "1"; (s as any) -= 1;`)).toThrow(TypeError);
  });

  test("a variable without an initializer is not tracked", () => {
    expect(emit(`let a: number; a = g(); export { a };`)).not.toContain("$$t");
  });

  test("assignments from closures and before the declaration", () => {
    expect(
      emit(`
        export function set() { n = g(); }
        let n: number = 0;
        export const set2 = () => { n = g(); };
      `),
    ).toMatchInlineSnapshot(`
      "export function set() {
        n = $$t(g(), 8);
      }
      let n = 0;
      export const set2 = () => {
        n = $$t(g(), 8);
      };"
    `);
  });

  test("shadowing", () => {
    expect(
      emit(`
        let n: number = 0;
        export function f(n) { n = g(); }
        export function h() { let n = g(); n = g(); }
        { let n: string = ""; n = g(); }
        n = g();
      `),
    ).toMatchInlineSnapshot(`
      "let n = 0;
      export function f(n) {
        n = g();
      }
      export function h() {
        let n = g();
        n = g();
      }
      {
        let n = "";
        n = $$t(g(), 16);
      }
      n = $$t(g(), 8);"
    `);
  });

  test("throw when the value has the wrong tag", () => {
    expect(() => run(`let n: number = "1" as string as any as never as unknown;`)).not.toThrow();
    expect(() => run(`const v: any = "1"; let n: number = v;`)).toThrow(TypeError);
    expect(() => run(`const v: any = "1"; let n: number = 0; n = v;`)).toThrow(TypeError);
    expect(() => run(`const v: any = null; let n: number | null = 0; n = v;`)).not.toThrow();
  });
});

describe("casts", () => {
  test("as and angle brackets", () => {
    expect(
      emit(`
        export const a = g() as number;
        export const b = <number>g();
        export const c = <number>g().h.i;
        export const d = g() as number | null;
        export const e = (g() as string).length;
        export const f = g() + h() as number;
        export const i = g() as Unresolved;
      `),
    ).toMatchInlineSnapshot(`
      "export const a = $$t(g(), 8);
      export const b = $$t(g(), 8);
      export const c = $$t(g().h.i, 8);
      export const d = $$t(g(), 10);
      export const e = $$t(g(), 16).length;
      export const f = $$t(g() + h(), 8);
      export const i = g();"
    `);
  });

  test("as const, satisfies, any and unknown emit nothing", () => {
    expect(
      emit(`
        export const a = [g()] as const;
        export const b = g() satisfies number;
        export const c = g() as any;
        export const d = g() as unknown;
        export const e = <any>g();
        export const f = <const>[g()];
      `),
    ).not.toContain("$$t");
  });

  test("a cast through any or unknown is an escape hatch", () => {
    expect(
      emit(`
        export const a = g() as unknown as number;
        export const b = g() as any as number;
        export const c = <number><unknown>g();
        export const d = (g() as any) as number;
        export const e: number = g() as any;
        export let f: number = g() as unknown as number;
        export function h(): number { return g() as any; }
        export const i = (): number => g() as any;
        export function j(x: number = g() as any) {}
        export class C { x: number = g() as any; }
      `),
    ).not.toContain("$$t");
    expect(emit(`export const a = g() as unknown as number as string;`)).not.toContain("$$t");
    expect(emit(`export const a = (g() as unknown as { x: number }).x as string;`)).toContain(`$$t(g().x, ${String_})`);
  });

  test("a cast that starts an optional chain is a probe, not a claim", () => {
    expect(
      emit(
        `
        export const a = (g() as Error)?.name;
        export const b = (g() as { x?: number } | undefined)?.x;
        export const c = (g() as Function)?.();
        export const d = (g() as number[])?.[0];
        export const e = g()!?.x;
      `,
        "full",
      ),
    ).not.toContain("$$t");
    expect(run(`const e: unknown = "not an error"; out((e as Error)?.name);`)).toEqual([undefined]);
    expect(emit(`export const a = (g() as Error).name;`)).toContain(`$$t(g(), ${OtherObject}).name`);
  });

  test("a variable initialized through an escape hatch is not tracked", () => {
    expect(
      emit(`
        let a: { x: number } = null!;
        let b: { x: number } = undefined!;
        let c: { x: number } = null as any;
        a = g(); b = g(); c = g();
        export { a, b, c };
      `),
    ).not.toContain("$$t");
    expect(emit(`let a: number = 0; a = g() as any; export { a };`)).not.toContain("$$t");
  });

  test("keep assignment targets, callees and operands intact", () => {
    const source = `
      (a as number) = g();
      (a as number) += g();
      (a as number)++;
      [a as number] = g();
      ({ x: a as number } = g());
      for ((a as number) of g()) {}
      (o.m as Function)();
      (o.m as Function)?.();
      (o.m as Function)\`\`;
      (o.m as Function)\`\${g()}\`;
      new (o.m as Function)();
      use(delete (o.m as Function), delete o.m!, typeof (undeclared as Function), typeof undeclared!);
      (eval as Function)("x");
    `;
    expect(emit(source, "full")).toBe(emit(source, "off"));
    expect(emit(`(o as { m: number }).m = g();`)).toBe(`$$t(o, ${AnyObject}).m = g();`);
    expect(
      run(
        `
        const o = { v: 1, m() { return this.v; } };
        out((o.m as () => number)(), (o.m!)(), (<() => number>o.m)());
        out(typeof (undeclared as string));
      `,
        "full",
      ),
    ).toEqual([1, 1, 1, "undefined"]);
  });
});

describe("class fields", () => {
  test("initializers and stores", () => {
    expect(
      emit(`
        export class C {
          a: number = g();
          b?: string = g();
          c!: boolean;
          d: number;
          static e: number = g();
          #f: bigint = g();
          declare h: number;
          ["i"]: number = g();
          [g()]: number = g();
          m() {
            this.a = g();
            this.b = g();
            this.c = g();
            this.d = g();
            this.#f = g();
            this.h = g();
            this.a ??= g();
            this.a ||= g();
            this.a += g();
            this.a++;
            this.unknown = g();
            other.a = g();
            this.a.a = g();
            [this.a] = g();
          }
        }
      `),
    ).toMatchInlineSnapshot(`
      "export class C {
        a = $$t(g(), 8);
        b = $$t(g(), 17);
        c;
        d;
        static e = $$t(g(), 8);
        #f = $$t(g(), 64);
        ["i"] = $$t(g(), 8);
        [g()] = $$t(g(), 8);
        m() {
          this.a = $$t(g(), 8);
          this.b = $$t(g(), 17);
          this.c = $$t(g(), 5);
          this.d = $$t(g(), 8);
          this.#f = $$t(g(), 64);
          this.h = g();
          this.a ??= $$t(g(), 8);
          this.a ||= $$t(g(), 8);
          this.a += g();
          this.a++;
          this.unknown = g();
          other.a = g();
          this.a.a = g();
          [this.a] = g();
        }
      }"
    `);
  });

  test("where this is an instance of the class", () => {
    expect(
      emit(`
        export class C {
          a: number = 0;
          b = () => { this.a = g(); };
          constructor() { this.a = g(); }
          get v() { this.a = g(); return 0; }
          set v(x) { this.a = g(); }
          m() {
            const arrow = () => { this.a = g(); };
            function nested() { this.a = g(); }
            const o = { m() { this.a = g(); } };
            class D { m() { this.a = g(); } }
            class E { a: string = ""; [(this.a = g())]() { this.a = g(); } }
          }
          static s() { this.a = g(); }
          static { this.a = g(); }
          static t = (this.a = g());
        }
        function f() { this.a = g(); }
      `),
    ).toMatchInlineSnapshot(`
      "export class C {
        a = 0;
        b = () => {
          this.a = $$t(g(), 8);
        };
        constructor() {
          this.a = $$t(g(), 8);
        }
        get v() {
          this.a = $$t(g(), 8);
          return 0;
        }
        set v(x) {
          this.a = $$t(g(), 8);
        }
        m() {
          const arrow = () => {
            this.a = $$t(g(), 8);
          };
          function nested() {
            this.a = g();
          }
          const o = { m() {
            this.a = g();
          } };

          class D {
            m() {
              this.a = g();
            }
          }

          class E {
            a = "";
            [this.a = $$t(g(), 8)]() {
              this.a = $$t(g(), 16);
            }
          }
        }
        static s() {
          this.a = g();
        }
        static {
          this.a = g();
        }
        static t = this.a = g();
      }
      function f() {
        this.a = g();
      }"
    `);
  });

  test("parameter properties declare fields", () => {
    expect(
      emit(`
        export class C {
          constructor(private a: number, b: number) {}
          m() { this.a = g(); this.b = g(); }
        }
      `),
    ).toMatchInlineSnapshot(`
      "export class C {
        a;
        constructor(a, b) {
          $$t(a, 8);
          $$t(b, 8);
          this.a = a;
        }
        m() {
          this.a = $$t(g(), 8);
          this.b = g();
        }
      }"
    `);
  });

  test("a name declared twice, or as an accessor or a method, is not a field", () => {
    expect(
      emit(`
        export class C {
          a: number;
          a: string;
          get b(): number { return 0; }
          set b(v) {}
          c(): void {}
          m() { this.a = g(); this.b = g(); this.c = g(); }
        }
      `),
    ).not.toContain("g(),");
  });

  test("throw when the value has the wrong tag", () => {
    expect(() => run(`const v: any = "1"; class C { a: number = v; } new C();`)).toThrow(TypeError);
    expect(() => run(`const v: any = "1"; class C { a: number = 0; m() { this.a = v; } } new C().m();`)).toThrow(
      TypeError,
    );
    expect(run(`class C { a?: number = 0; m() { this.a = undefined; return this.a; } } out(new C().m());`)).toEqual([
      undefined,
    ]);
  });
});

describe("full", () => {
  test("is what enables non-null assertions, field reads and call results", () => {
    const source = `
      function f(): number { return g(); }
      export class C { a: number = 0; m() { return [this.a, g()!, f()]; } }
    `;
    expect(emit(source, "basic")).toMatchInlineSnapshot(`
      "function f() {
        return $$t(g(), 8);
      }

      export class C {
        a = 0;
        m() {
          return [this.a, g(), f()];
        }
      }"
    `);
    expect(emit(source, "full")).toMatchInlineSnapshot(`
      "function f() {
        return $$t(g(), 8);
      }

      export class C {
        a = 0;
        m() {
          return [$$t(this.a, 8), $$t(g(), 1020), $$t(f(), 8)];
        }
      }"
    `);
  });

  test("non-null assertions", () => {
    expect(
      emit(
        `
        export const a = g()!;
        export const b = g()!.x;
        export const c = o.p!.q!.r;
        export const d = o.m!();
        export const e = o!.m();
        export const f = o?.p!;
        export const h = o?.p!.q;
        export const i = null!;
        export const j = undefined!;
        export const k = 1!;
        x! = g();
        x!++;
        o.p! = g();
        o!.p = g();
      `,
        "full",
      ),
    ).toMatchInlineSnapshot(`
      "export const a = $$t(g(), 1020);
      export const b = $$t(g(), 1020).x;
      export const c = $$t($$t(o.p, 1020).q, 1020).r;
      export const d = o.m();
      export const e = $$t(o, 1020).m();
      export const f = o?.p;
      export const h = o?.p.q;
      export const i = null;
      export const j = undefined;
      export const k = 1;
      x = g();
      x++;
      o.p = g();
      $$t(o, 1020).p = g();"
    `);
    expect(() => run(`const v: any = null; v!;`, "full")).toThrow(TypeError);
    expect(() => run(`const v: any = null; v!;`, "basic")).not.toThrow();
    expect(run(`const o: any = undefined; out(o?.p!.q);`, "full")).toEqual([undefined]);
  });

  test("field reads", () => {
    expect(
      emit(
        `
        export class C {
          a: number = 0;
          f: () => void = () => {};
          o: { x: number } = { x: 0 };
          #p: string = "";
          m() {
            use(this.a, this.#p, this.o.x, this.unknown);
            this.f();
            this.f\`\`;
            this.f?.();
            new this.f();
            delete this.a;
            typeof this.a;
            this.a = 1;
            this.a += 1;
            this.a++;
            [this.a] = g();
            this.o.x = 1;
            this.o?.x;
            const arrow = () => this.a;
            function nested() { return this.a; }
          }
          static s() { return this.a; }
        }
      `,
        "full",
      ),
    ).toMatchInlineSnapshot(`
      "export class C {
        a = 0;
        f = () => {};
        o = { x: 0 };
        #p = "";
        m() {
          use($$t(this.a, 8), $$t(this.#p, 16), $$t(this.o, 896).x, this.unknown);
          this.f();
          this.f\`\`;
          this.f?.();
          new ($$t(this.f, 128));
          delete this.a;
          $$t(this.a, 8);
          this.a = 1;
          this.a += 1;
          this.a++;
          [this.a] = g();
          $$t(this.o, 896).x = 1;
          $$t(this.o, 896)?.x;
          const arrow = () => $$t(this.a, 8);
          function nested() {
            return this.a;
          }
        }
        static s() {
          return this.a;
        }
      }"
    `);
    expect(
      run(
        `class C { v = 1; f: () => number = function () { return this.v; }; m() { return this.f(); } } out(new C().m());`,
        "full",
      ),
    ).toEqual([1]);
    expect(() =>
      run(`class C { a: number = 0; m() { (this as any).a = "1"; return this.a; } } new C().m();`, "full"),
    ).toThrow(TypeError);
  });

  test("results of calls to functions in the same file", () => {
    expect(
      emit(
        `
        use(decl(), arrow(), expr(), asy(), gen(), generic(), untyped(), reassigned(), o.decl(), decl?.(), new decl());
        decl();
        function decl(): number { return 0; }
        const arrow = (): string => "";
        const expr = function (): boolean { return true; };
        async function asy(): Promise<number> { return 0; }
        function* gen(): Generator<number> {}
        function generic<T>(): T { return g(); }
        function untyped() { return g(); }
        let reassigned = (): number => 0;
        function shadow(decl) { return decl(); }
        export function tail(): number { return decl(); }
      `,
        "full",
      ),
    ).toMatchInlineSnapshot(`
      "use($$t(decl(), 8), $$t(arrow(), 16), $$t(expr(), 4), asy(), gen(), generic(), untyped(), reassigned(), o.decl(), decl?.(), new decl);
      decl();
      function decl() {
        return 0;
      }
      const arrow = () => "";
      const expr = function() {
        return true;
      };
      async function asy() {
        return 0;
      }
      function* gen() {}
      function generic() {
        return g();
      }
      function untyped() {
        return g();
      }
      let reassigned = () => 0;
      function shadow(decl) {
        return decl();
      }
      export function tail() {
        return $$t(decl(), 8);
      }"
    `);
  });
});

describe("infer", () => {
  test("reads of members and elements that TypeScript takes for primitives are checked", () => {
    expect(
      emit(
        `
        interface P { x: number; name: string; next: P; opt?: number }
        export function f(p: P, list: number[], grid: P[]) {
          return [p.x, p.name, p.next, p.opt, list[0], grid[0], grid[1].x, p.next.x];
        }
      `,
        "infer",
      ),
    ).toMatchInlineSnapshot(`
      "export function f(p, list, grid) {
        $$t(p, 896);
        $$t(list, 256);
        $$t(grid, 256);
        return [$$t(p.x, 8), $$t(p.name, 16), p.next, $$t(p.opt, 9), $$t(list[0], 9), grid[0], $$t(grid[1].x, 8), $$t(p.next.x, 8)];
      }"
    `);
  });

  test("a variable takes the type of what it is initialized with", () => {
    expect(
      emit(
        `
        class Body { x: number = 0; mass: number = 1 }
        export function f(bodies: Body[]) {
          let total = 0;
          for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i]!;
            total += b.x * b.mass;
          }
          for (const b of bodies) total += b.mass;
          return total;
        }
      `,
        "infer",
      ),
    ).toMatchInlineSnapshot(`
      "class Body {
        x = 0;
        mass = 1;
      }
      export function f(bodies) {
        $$t(bodies, 256);
        let total = 0;
        for (let i = 0;i < $$t(bodies.length, 8); i++) {
          const b = $$t(bodies[i], 512);
          total += $$t(b.x, 8) * $$t(b.mass, 8);
        }
        for (const b of bodies)
          total += $$t(b.mass, 8);
        return total;
      }"
    `);
  });

  test("no part of an optional chain is wrapped, and what one comes to is not taken for its last member", () => {
    const output = emit(
      `
      interface P { flag: boolean; next: P }
      export function f(p: P | undefined, q: P) { return [p?.flag, p?.next.flag, q.next?.flag, q.flag]; }
    `,
      "infer",
    );
    expect(output).toContain("[p?.flag, p?.next.flag, q.next?.flag, $$t(q.flag, 4)]");
    expect(
      run(
        `
        interface P { flag: boolean }
        function f(p: P | undefined) { return p?.flag ?? "none"; }
        out(f(undefined), f({ flag: true }));
      `,
        "infer",
      ),
    ).toEqual(["none", true]);
  });

  test("typed arrays are known by their type, wherever they come from", () => {
    expect(
      emit(
        `
        class Grid { cells: Float64Array = new Float64Array(4) }
        export function f(n: number, g: Grid) {
          const p = new Int32Array(n);
          let s = p[0]! + g.cells[1]!;
          return s;
        }
      `,
        "infer",
      ),
    ).toMatchInlineSnapshot(`
      "class Grid {
        cells = $$t(new Float64Array(4), 10752);
      }
      export function f(n, g) {
        $$t(n, 8);
        $$t(g, 512);
        const p = $$t(new Int32Array(n), 6656);
        let s = $$t(p[0], 8) + $$t($$t(g.cells, 10752)[1], 8);
        return s;
      }"
    `);
  });

  test("an update of a member checks what it reads", () => {
    expect(
      emit(
        `
        interface V { x: number }
        export function f(v: V, list: V[], d: number) { v.x -= d; list[0].x += d; g().x *= d; }
      `,
        "infer",
      ),
    ).toMatchInlineSnapshot(`
      "export function f(v, list, d) {
        $$t(v, 896);
        $$t(list, 256);
        $$t(d, 8);
        v.x = $$t(v.x, 8) - d;
        list[0].x += d;
        g().x *= d;
      }"
    `);
  });

  test("a value that is not what TypeScript takes it for is caught where it is read", () => {
    const source = `
      interface P { x: number }
      function sum(list: P[]) { let s = 0; for (const p of list) s += p.x; return s; }
      out(sum([{ x: 1 }, { x: 2 }]));
      try { sum(JSON.parse('[{"x":"3"}]')); } catch (e) { out(e instanceof TypeError); }
    `;
    expect(run(source, "infer")).toEqual([3, true]);
    expect(run(source, "full")).toEqual([3]);
  });
});

describe("redundant checks", () => {
  test("values whose tag is evident are not checked", () => {
    expect(
      emit(`
        export const a: number = 0;
        export const b: string = "";
        export const c: string = \`\${g()}\`;
        export const d: boolean = !g();
        export const e: null = null;
        export const f: undefined = undefined;
        export const h: bigint = 1n;
        export const i: number[] = [g()];
        export const j: { x: number } = { x: g() };
        export const k: () => void = () => {};
        export const l: Function = function () {};
        export const m: RegExp = /x/;
        export const n: string = typeof g();
        export const o: boolean = g() === h();
        export const p: number = g() >>> 0;
        export const q: number | bigint = g() * h();
        export const r: string = "a" + g();
        export const s: number | string = g() ? 1 : "a";
        export const t: number | null = g() ? 1 : null;
        export const u: object = new Foo();
        export const v: new () => object = class {};
        export const w: undefined = void g();
        export const x: number = +g();
      `),
    ).not.toContain("$$t");
  });

  test("values whose tag is evidently wrong are still checked", () => {
    expect(emit(`export const a: number = "";`)).toContain(`$$t("", ${Number_})`);
    expect(emit(`export const a: number = g() * h();`)).toContain(`$$t(g() * h(), ${Number_})`);
    expect(emit(`export const a: Map<string, number> = new Foo();`)).toContain(`$$t(new Foo, ${OtherObject})`);
  });

  test("a checked value is not checked again against a mask that contains the first", () => {
    expect(
      emit(`
        export const a: number = g() as number;
        export const b: number | null = g() as number;
        export const c: number = g() as number | null;
        export function f(): number { return g() as number; }
        const k: number = g();
        export const d: number = k;
        export const e: number | string = k;
        let v: number = g();
        export const i: number = v;
      `),
    ).toMatchInlineSnapshot(`
      "export const a = $$t(g(), 8);
      export const b = $$t(g(), 8);
      export const c = $$t(g(), 8);
      export function f() {
        return $$t(g(), 8);
      }
      const k = $$t(g(), 8);
      export const d = k;
      export const e = k;
      let v = $$t(g(), 8);
      export const i = $$t(v, 8);"
    `);
  });
});

describe("opting out", () => {
  test("without the option the output is the same as before", () => {
    const source = `
      export function f(a: number, b?: string): number { let c: number = a; c += 1; return c as number; }
      export class C { x: number = 0; m() { this.x = g()!; } }
    `;
    expect(emit(source, "off")).not.toContain("$$t");
    expect(new Bun.Transpiler({ loader: "ts", soundTypes: false }).transformSync(source).trim()).toBe(
      emit(source, "off"),
    );
  });

  test("a file that mentions $$t keeps its annotations erased", () => {
    expect(emit(`const $$t = 1; export function f(a: number) { return $$t; }`)).toMatchInlineSnapshot(`
      "const $$t = 1;
      export function f(a) {
        return $$t;
      }"
    `);
    expect(emit(`export function f(a: number, $$t: number) {}`)).not.toContain("$$t(");
  });

  test("JavaScript is unaffected", () => {
    const js = new Bun.Transpiler({ loader: "js", soundTypes: "full" });
    expect(js.transformSync(`export function f(a) { return a; }`)).not.toContain("$$t");
  });

  test("invalid option values throw", () => {
    // @ts-expect-error
    expect(() => new Bun.Transpiler({ soundTypes: "everything" })).toThrow();
    // @ts-expect-error
    expect(() => new Bun.Transpiler({ soundTypes: 3 })).toThrow();
  });

  test("the output parses again and is left alone", () => {
    const output = emit(`export function f(a: number): string { return g() as string; }`);
    expect(emit(output)).toBe(output);
    expect(new Bun.Transpiler({ loader: "js" }).transformSync(output).trim()).toBe(output);
  });
});

test("emitDecoratorMetadata is unchanged", () => {
  const tsconfig = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
  const source = `
    @dec
    export class C {
      @dec a: number | null = g();
      @dec b: string;
      constructor(@dec x: number, y: Foo | undefined) {}
      @dec m(@dec p: string[], q: () => void): Promise<number> { return g(); }
    }
  `;
  const afterTheClass = (output: string) => output.slice(output.indexOf("\n}\n"));
  const off = new Bun.Transpiler({ loader: "ts", tsconfig }).transformSync(source);
  const on = new Bun.Transpiler({ loader: "ts", tsconfig, soundTypes: true }).transformSync(source);
  expect(afterTheClass(off)).toContain(`"design:paramtypes"`);
  expect(afterTheClass(on)).toBe(afterTheClass(off));
  expect(on.slice(0, on.indexOf("\n}\n")).slice(on.indexOf("export class"))).toMatchInlineSnapshot(`
    "export class C {
      constructor(x, y) {
        $$t(x, 8);
        this.a = $$t(g(), 10);
      }
      m(p, q) {
        $$t(p, 256);
        $$t(q, 128);
        return $$t(g(), 512);
      }"
  `);
});

describe("bundler", () => {
  const shimFile = { "/shim.js": shim };

  for (const backend of ["cli", "api"] as const) {
    itBundled(`sound-types/Basic-${backend}`, {
      files: {
        "/entry.ts": /* ts */ `
          import "./shim.js";
          function f(a: number): string { return String(a); }
          class C { x: number = 0; m() { return this.x; } }
          console.log(f(1), new C().m()!);
          try { f("1" as any); } catch (e) { console.log(e instanceof TypeError, e.message); }
        `,
        ...shimFile,
      },
      backend,
      soundTypes: true,
      run: { stdout: "1 0\ntrue tag 16 is not in mask 8" },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("$$t(a, 8)");
        expect(out).not.toContain("1020");
      },
    });

    itBundled(`sound-types/Full-${backend}`, {
      files: {
        "/entry.ts": /* ts */ `
          import "./shim.js";
          class C { x: number = 0; m() { return this.x; } }
          console.log(new C().m()!);
        `,
        ...shimFile,
      },
      backend,
      soundTypes: "full",
      run: { stdout: "0" },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("$$t(this.x, 8)");
        expect(out).toContain("1020");
      },
    });
  }

  itBundled("sound-types/Off", {
    files: {
      "/entry.ts": /* ts */ `
        export function f(a: number): string { return String(a) as string; }
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("$$t");
    },
  });

  itBundled("sound-types/Minify", {
    files: {
      "/entry.ts": /* ts */ `
        import "./shim.js";
        function add(first: number, second: number): number {
          const sum: number = first + second;
          return sum;
        }
        const label = (value: string | null) => value ?? "none";
        console.log(add(1, 2), label(null));
        for (const bad of [() => add(1, "2" as any), () => label(1 as any)]) {
          try { bad(); console.log("no error"); } catch (e) { console.log(e.message); }
        }
      `,
      ...shimFile,
    },
    soundTypes: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    run: { stdout: "3 none\ntag 16 is not in mask 8\ntag 8 is not in mask 18" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js").match(/\$\$t\(/g)!.length).toBeGreaterThanOrEqual(3);
    },
  });

  itBundled("sound-types/ChecksAreNotTreeShaken", {
    files: {
      "/entry.ts": /* ts */ `
        import "./shim.js";
        import { used } from "./lib";
        console.log(used);
      `,
      "/lib.ts": /* ts */ `
        const value: any = "not a number";
        export const used = 1;
        export const unusedLiteral: number = 2;
        export const unusedChecked: number = value;
      `,
      ...shimFile,
    },
    soundTypes: true,
    minifySyntax: true,
    run: { error: "TypeError: tag 16 is not in mask 8" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain(", 8)");
      expect(out).not.toContain("unusedLiteral");
    },
  });

  itBundled("sound-types/UnusedResultIsStillChecked", {
    files: {
      "/entry.ts": /* ts */ `
        import "./shim.js";
        const value: any = null;
        function f() {
          const unused: string = value;
          value as string;
        }
        try { f(); } catch (e) { console.log(e.message); }
      `,
      ...shimFile,
    },
    soundTypes: true,
    minifySyntax: true,
    run: { stdout: "tag 2 is not in mask 16" },
  });

  itBundled("sound-types/UserSymbolWithTheSameName", {
    files: {
      "/entry.ts": /* ts */ `
        import "./shim.js";
        import { $$t } from "./user";
        import { f } from "./checked";
        console.log($$t(1, 2), f(3));
        try { f("3" as any); } catch (e) { console.log(e.message); }
      `,
      "/user.ts": /* ts */ `
        export function $$t(a: number, b: number): number { return a + b; }
      `,
      "/checked.ts": /* ts */ `
        export function f(a: number): number { return a; }
      `,
      ...shimFile,
    },
    soundTypes: true,
    run: { stdout: "3 3\ntag 16 is not in mask 8" },
  });

  itBundled("sound-types/ConstantsAreStillInlined", {
    files: {
      "/entry.ts": /* ts */ `
        import { A, B } from "./constants";
        const C: number = 3;
        console.log(A + B + C);
      `,
      "/constants.ts": /* ts */ `
        export const A: number = 1;
        export const B: number = 2;
      `,
    },
    soundTypes: true,
    minifySyntax: true,
    run: { stdout: "6" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("$$t");
    },
  });

  itBundled("sound-types/Formats", {
    files: {
      "/entry.ts": /* ts */ `
        require("./shim.js");
        exports.f = function (a: number) { return a; };
        console.log(exports.f(1));
      `,
      ...shimFile,
    },
    soundTypes: true,
    format: "cjs",
    run: { stdout: "1" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("$$t(a, 8)");
    },
  });

  itBundled("sound-types/NoBundle", {
    files: {
      "/entry.ts": /* ts */ `
        import type { T } from "./types";
        export function f(a: number, b: T) {}
      `,
      "/types.ts": `export type T = string;`,
    },
    soundTypes: true,
    bundling: false,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("$$t(a, 8)");
      expect(out).not.toContain("$$t(b");
    },
  });

  describe("imported types", () => {
    function masks(out: string): Record<string, number> {
      return Object.fromEntries([...out.matchAll(/\$\$t\((\w+), (\d+)\)/g)].map(m => [m[1], Number(m[2])]));
    }

    itBundled("sound-types/ImportedTypes", {
      files: {
        "/entry.ts": /* ts */ `
          import type { Alias, Iface, Forward } from "./types";
          import { type Inline, type Inline as Renamed, Klass, Enum, StrEnum, value } from "./types";
          import type DefaultClass from "./default-class";
          import DefaultAlias from "./default-alias";
          import * as ns from "./types";
          import type * as tns from "./types";
          import type { Missing } from "./types";
          import type { NotFound } from "./does-not-exist";
          import type { FromPackage } from "some-package";
          import type { Generic } from "./types";
          export function f(
            alias: Alias, iface: Iface, forward: Forward, inline: Inline, renamed: Renamed, klass: Klass,
            enum_: Enum, strEnum: StrEnum, member: Enum.A, defaultClass: DefaultClass, defaultAlias: DefaultAlias,
            nsAlias: ns.Alias, tnsKlass: tns.Klass, missing: Missing, notFound: NotFound, fromPackage: FromPackage,
            union: Alias | null, array: Alias[], generic: Generic<string>, valueAsType: value, nsItself: ns,
          ) {}
          console.log(value, Klass, Enum, StrEnum);
        `,
        "/types.ts": /* ts */ `
          export type Alias = string | number;
          export interface Iface { a: number }
          export type Forward = Later;
          type Later = boolean;
          export type Inline = bigint;
          export class Klass {}
          export enum Enum { A, B }
          export enum StrEnum { A = "a" }
          export const value = 1;
          export type Generic<T> = T | null;
          type NotExported = string;
        `,
        "/default-class.ts": `export default class Foo {}`,
        "/default-alias.ts": `type Foo = symbol; export default Foo;`,
      },
      soundTypes: true,
      external: ["some-package"],
      onAfterBundle(api) {
        expect(masks(api.readFile("/out.js"))).toEqual({
          alias: String_ | Number_,
          iface: AnyObject,
          forward: Boolean_,
          inline: BigInt_,
          renamed: BigInt_,
          klass: OtherObject,
          enum_: Number_,
          strEnum: String_,
          member: Number_,
          defaultClass: OtherObject,
          defaultAlias: Symbol_,
          nsAlias: String_ | Number_,
          tnsKlass: OtherObject,
          union: String_ | Number_ | Null,
          array: Array_,
        });
      },
    });

    itBundled("sound-types/ReExportedTypes", {
      files: {
        "/entry.ts": /* ts */ `
          import type { A, B, C, D, E, F, G, H } from "./barrel";
          export function f(a: A, b: B, c: C, d: D, e: E, f: F, g: G, h: H) {}
        `,
        "/barrel.ts": /* ts */ `
          export type { A } from "./a";
          export { type A as B } from "./a";
          export { C } from "./a";
          export * from "./star";
          export type * from "./type-star";
          import type { A as Imported } from "./a";
          export type { Imported as F };
          import { C as ImportedClass } from "./a";
          export { ImportedClass as G };
          export * as H from "./a";
        `,
        "/a.ts": /* ts */ `
          export type A = string;
          export class C {}
        `,
        "/star.ts": `export type D = number;`,
        "/type-star.ts": `export type E = boolean; export * from "./barrel";`,
      },
      soundTypes: true,
      onAfterBundle(api) {
        expect(masks(api.readFile("/out.js"))).toEqual({
          a: String_,
          b: String_,
          c: OtherObject,
          d: Number_,
          e: Boolean_,
          f: String_,
          g: OtherObject,
        });
      },
    });

    itBundled("sound-types/ImportCycles", {
      files: {
        "/entry.ts": /* ts */ `
          import type { A, Ok } from "./a";
          import type { Self } from "./entry";
          export type Self = Self2; type Self2 = Self;
          export function f(a: A, ok: Ok, self: Self) {}
        `,
        "/a.ts": /* ts */ `
          import type { B, FromB } from "./b";
          export type A = B | number;
          export type Ok = FromB | null;
          export type FromA = string;
        `,
        "/b.ts": /* ts */ `
          import type { A, FromA } from "./a";
          export type B = A | string;
          export type FromB = FromA;
        `,
      },
      soundTypes: true,
      onAfterBundle(api) {
        expect(masks(api.readFile("/out.js"))).toEqual({ ok: String_ | Null });
      },
    });

    itBundled("sound-types/ImportedBaseClass", {
      files: {
        "/entry.ts": /* ts */ `
          import { Base, List } from "./base";
          class A extends Base {}
          class B extends List {}
          export function f(a: A, b: B) {}
        `,
        "/base.ts": /* ts */ `
          export class Base {}
          export class List extends Array<number> {}
        `,
      },
      soundTypes: true,
      onAfterBundle(api) {
        expect(masks(api.readFile("/out.js"))).toEqual({ a: OtherObject, b: Array_ });
      },
    });

    itBundled("sound-types/ImportedThroughTsconfigPaths", {
      files: {
        "/entry.ts": /* ts */ `
          import type { T } from "@lib/types";
          import type { U } from "./types.js";
          export function f(t: T, u: U) {}
        `,
        "/lib/types.ts": `export type T = string;`,
        "/types.ts": `export type U = number;`,
        "/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/*"] } } }),
      },
      soundTypes: true,
      onAfterBundle(api) {
        expect(masks(api.readFile("/out.js"))).toEqual({ t: String_, u: Number_ });
      },
    });

    itBundled("sound-types/DeclarationFilesNextToJavaScript", {
      files: {
        "/entry.ts": /* ts */ `
          import type { Alias, Iface, FromOther, Const } from "pkg";
          import { Klass } from "pkg";
          import type { Esm } from "pkg/esm.mjs";
          import type { NoTypes } from "pkg/no-types.js";
          export function f(
            alias: Alias, iface: Iface, klass: Klass, fromOther: FromOther, const_: Const, esm: Esm, noTypes: NoTypes,
          ) {}
          console.log(Klass);
        `,
        "/node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "./index.js" }),
        "/node_modules/pkg/index.js": `export class Klass {}`,
        "/node_modules/pkg/index.d.ts": /* ts */ `
          export declare type Alias = string;
          export interface Iface { a: number }
          export declare class Klass { private x; m(): void; }
          export declare const Const: number;
          export * from "./other.js";
        `,
        "/node_modules/pkg/other.js": ``,
        "/node_modules/pkg/other.d.ts": `export declare enum FromOther { A = "a" }`,
        "/node_modules/pkg/esm.mjs": ``,
        "/node_modules/pkg/esm.d.mts": `export type Esm = bigint;`,
        "/node_modules/pkg/no-types.js": ``,
      },
      soundTypes: true,
      onAfterBundle(api) {
        expect(masks(api.readFile("/out.js"))).toEqual({
          alias: String_,
          iface: AnyObject,
          klass: OtherObject,
          fromOther: String_,
          esm: BigInt_,
        });
      },
    });

    itBundled("sound-types/ImportedModuleScopes", {
      files: {
        "/entry.ts": /* ts */ `
          import type { UsesLocalMap, UsesGlobalMap, UsesTypeParameter, Nested } from "./types";
          import type { FromJs } from "./plain.js";
          import type { OptedOut } from "./opted-out";
          import type { Broken } from "./broken";
          export function f(
            local: UsesLocalMap, global: UsesGlobalMap, parameter: UsesTypeParameter, nested: Nested,
            fromJs: FromJs, optedOut: OptedOut, broken: Broken,
          ) {}
        `,
        "/types.ts": /* ts */ `
          import type { Map } from "./map";
          export type UsesLocalMap = Map;
          export type UsesGlobalMap = Set<string>;
          export type UsesTypeParameter = T;
          type T = string;
          function g<T>() {}
          export type Nested = Inner;
          type Inner = string;
          function h() { type Inner = number; }
        `,
        "/map.ts": `export type Map = string;`,
        "/plain.js": `export const FromJs = 1;`,
        "/opted-out.ts": `export type OptedOut = string; const $$t = 1;`,
        "/broken.ts": `export type Broken = string; const = ;`,
      },
      soundTypes: true,
      onAfterBundle(api) {
        expect(masks(api.readFile("/out.js"))).toEqual({ local: String_, global: OtherObject });
      },
    });
  });

  itBundled("sound-types/ReactCompiler", {
    files: {
      "/entry.tsx": /* tsx */ `
        import "./shim.js";
        import { useState } from "react";
        type Props = { name: string; count?: number };
        function label(name: string, count: number): string {
          return name + ":" + count;
        }
        function Hello(props: Props) {
          const [extra] = useState<number>(1);
          const count: number = (props.count ?? 0) + extra;
          const items: string[] = [label(props.name, count)];
          return <div>{items.map((item: string) => <span key={item}>{item as string}</span>)}</div>;
        }
        console.log(JSON.stringify(<Hello name="a" count={1} />));
        try {
          console.log(JSON.stringify(<Hello name={1 as any} />));
        } catch (e) {
          console.log(e.message);
        }
        try {
          Hello(null as any);
        } catch (e) {
          console.log(e.message);
        }
      `,
      ...shimFile,
      "/node_modules/react/index.js": `export function useState(initial) { return [initial, () => {}]; }`,
      "/node_modules/react/compiler-runtime.js": /* js */ `
        export function c(size) { return new Array(size).fill(Symbol.for("react.memo_cache_sentinel")); }
      `,
      "/node_modules/react/jsx-dev-runtime.js": /* js */ `
        export function jsxDEV(type, props) { return typeof type === "function" ? type(props) : [type, props.children]; }
      `,
    },
    soundTypes: true,
    reactCompiler: true,
    run: { stdout: `["div",[["span","a:2"]]]\ntag 8 is not in mask 16\ntag 2 is not in mask 896` },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatch(/\b_?c\d*\(\d+\)/);
      expect(out).toContain("$$t(props, 896)");
    },
  });
});

test("BUN_SOUND_TYPES turns the option on for bun build and Bun.build", async () => {
  using dir = tempDir("sound-types-env", {
    "entry.ts": `export function f(a: number) { return g()!; }`,
    "build.ts": `
      const result = await Bun.build({ entrypoints: [import.meta.dir + "/entry.ts"] });
      console.log(await result.outputs[0].text());
    `,
  });
  async function build(args: string[], value: string | undefined) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, BUN_SOUND_TYPES: value },
      cwd: String(dir),
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { checks: stdout.match(/\$\$t\([^;]*\)/g), exitCode };
  }
  const cli = ["build", join(String(dir), "entry.ts")];
  const results = await Promise.all([
    build(cli, undefined),
    build(cli, "1"),
    build(cli, "full"),
    build(["build.ts"], "1"),
    build(["build.ts"], "full"),
    build([...cli, "--sound-types=full"], undefined),
    build([...cli, "--sound-types"], undefined),
  ]);
  expect(results).toEqual([
    { checks: null, exitCode: 0 },
    { checks: ["$$t(a, 8)"], exitCode: 0 },
    { checks: ["$$t(a, 8)", "$$t(g(), 1020)"], exitCode: 0 },
    { checks: ["$$t(a, 8)"], exitCode: 0 },
    { checks: ["$$t(a, 8)", "$$t(g(), 1020)"], exitCode: 0 },
    { checks: ["$$t(a, 8)", "$$t(g(), 1020)"], exitCode: 0 },
    { checks: ["$$t(a, 8)"], exitCode: 0 },
  ]);
});
