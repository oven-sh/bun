import { afterAll, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren } from "../children";
import { linesOf, tsc } from "./differential";

afterAll(endChildren);

// To create a property of a short union, `bun check` looks the name up in every member. In a union of 8 or more members
// it caches what it learned about a member for the next lookup. So each program here is checked with unions on both
// sides of that size, and the size must not change what's reported.

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

/** Joins `text(0)` to `text(count - 1)`. */
const each = (count: number, text: (i: number) => string, separator = " | ") =>
  Array.from({ length: count }, (_, i) => text(i)).join(separator);

// `errors`: what TypeScript 7.0.2 reports for `program(count)`, for every `count` in `sizes`, without the file name.
const cases: Record<string, { sizes?: number[]; program: (count: number) => string; errors: string }> = {
  "a property that all, some, one or none of the members have": {
    program: count => `
type U = ${each(count, i => `{ tag: ${i}; all: ${i % 2 ? "string" : "number"};${i % 2 ? " odd: 1;" : ""}${i === 3 ? " one: boolean;" : ""} }`)};
declare const u: U;
const all: never = u.all;
u.odd;
u.one;
u.none;
u.all = 1;
const { odd } = u;
if ("odd" in u) {
  const odd: never = u.odd;
  const all: never = u.all;
}
if ("one" in u) {
  const whole: never = u;
}
const keys: never = null! as keyof U;
const indexed: never = null! as U["all"];
type Missing = U["odd"];
const common: never = null! as Pick<U, keyof U>["all"];
const differs: U = null! as { tag: 3; all: boolean; odd: 1; one: boolean };
export {};
`,
    errors: `
(4,7): error TS2322: Type 'string | number' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(5,3): error TS2339: Property 'odd' does not exist on type 'U'.
  Property 'odd' does not exist on type '{ tag: 0; all: number; }'.
(6,3): error TS2339: Property 'one' does not exist on type 'U'.
  Property 'one' does not exist on type '{ tag: 0; all: number; }'.
(7,3): error TS2339: Property 'none' does not exist on type 'U'.
  Property 'none' does not exist on type '{ tag: 0; all: number; }'.
(9,9): error TS2339: Property 'odd' does not exist on type 'U'.
(11,9): error TS2322: Type '1' is not assignable to type 'never'.
(12,9): error TS2322: Type 'string' is not assignable to type 'never'.
(15,9): error TS2322: Type '{ tag: 3; all: string; odd: 1; one: boolean; }' is not assignable to type 'never'.
(17,7): error TS2322: Type '"all" | "tag"' is not assignable to type 'never'.
  Type '"all"' is not assignable to type 'never'.
(18,7): error TS2322: Type 'string | number' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(19,18): error TS2339: Property 'odd' does not exist on type 'U'.
(20,7): error TS2322: Type 'string | number' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(21,7): error TS2322: Type '{ tag: 3; all: boolean; odd: 1; one: boolean; }' is not assignable to type 'U'.
  Type '{ tag: 3; all: boolean; odd: 1; one: boolean; }' is not assignable to type '{ tag: 3; all: string; odd: 1; one: boolean; }'.
    Types of property 'all' are incompatible.
      Type 'boolean' is not assignable to type 'string'.
`,
  },
  "members with a string index signature": {
    program: count => `
type U = ${each(
      count,
      i =>
        [
          `{ tag: ${i}; named: string }`,
          `{ tag: ${i}; [key: string]: number }`,
          `{ readonly [key: string]: boolean | number }`,
          `{ tag: ${i}; named: "x"; other: 1 }`,
        ][i % 4],
    )};
type Open = ${each(count, i => `({ tag: ${i}; p${i % 5}: string } & Record<string, unknown>)`)};
declare const u: U;
declare const open: Open;
const named: never = u.named;
u.named = "x";
const other: never = u.other;
const tag: never = u.tag;
const p0: never = open.p0;
const p4: never = open.p4;
const anything: never = open.anything;
open.p0 = 1;
open.p0 = "";
open.anything = 1;
const keys: never = null! as keyof Open;
export {};
`,
    errors: `
(6,7): error TS2322: Type 'string | number | boolean' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(7,3): error TS2540: Cannot assign to 'named' because it is a read-only property.
(8,7): error TS2322: Type 'any' is not assignable to type 'never'.
(8,24): error TS2339: Property 'other' does not exist on type 'U'.
  Property 'other' does not exist on type '{ tag: 0; named: string; }'.
(9,7): error TS2322: Type 'number | boolean' is not assignable to type 'never'.
  Type 'number' is not assignable to type 'never'.
(10,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(11,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(12,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(16,7): error TS2322: Type 'string' is not assignable to type 'never'.
`,
  },
  "members with a number or a template literal index signature": {
    program: count => `
type U = ${each(
      count,
      i =>
        [
          `{ tag: ${i}; "data-x": 1; 0: "zero"; plain: 1 }`,
          `{ [key: number]: "n" }`,
          "{ [key: `data-${string}`]: 2 }",
          `{ [key: string]: 1 | 2 | 3 | "n" | "zero" }`,
        ][i % 4],
    )};
type Data = ${each(count, i => (i % 2 ? "{ [key: `data-${string}`]: 2 }" : `{ "data-x": ${i % 4}; [key: number]: ${i % 4} }`))};
declare const u: U;
declare const data: Data;
u["data-x"];
u[0];
u["0"];
u.plain;
const x: never = data["data-x"];
data["data-y"];
data[0];
data.plain;
export {};
`,
    errors: `
(6,1): error TS7053: Element implicitly has an 'any' type because expression of type '"data-x"' can't be used to index type 'U'.
  Property 'data-x' does not exist on type 'U'.
(7,1): error TS7053: Element implicitly has an 'any' type because expression of type '0' can't be used to index type 'U'.
  Property '0' does not exist on type 'U'.
(8,1): error TS7053: Element implicitly has an 'any' type because expression of type '"0"' can't be used to index type 'U'.
  Property '0' does not exist on type 'U'.
(9,3): error TS2339: Property 'plain' does not exist on type 'U'.
  Property 'plain' does not exist on type '{ [key: number]: "n"; }'.
(10,7): error TS2322: Type '0 | 2' is not assignable to type 'never'.
  Type '0' is not assignable to type 'never'.
(11,6): error TS2551: Property 'data-y' does not exist on type 'Data'. Did you mean 'data-x'?
(12,1): error TS7053: Element implicitly has an 'any' type because expression of type '0' can't be used to index type 'Data'.
  Property '0' does not exist on type 'Data'.
(13,6): error TS2339: Property 'plain' does not exist on type 'Data'.
  Property 'plain' does not exist on type '{ [key: number]: 0; "data-x": 0; }'.
`,
  },
  "tuples and arrays": {
    program: count => `
type U = ${each(count, i => [`[${i}, string]`, `[${i}, number, ...boolean[]]`, `readonly [${i}, bigint]`][i % 3])};
type Lists = ${each(count, i => (i % 2 ? `[${i % 4}]` : `{ 0: "object"; length: "long"; tag: ${i} }`))};
declare const u: U;
declare const lists: Lists;
const first: never = u[1];
const quoted: never = u["1"];
const second: never = u[2];
const length: never = u.length;
u.push;
u[1] = 1;
const zero: never = lists[0];
const long: never = lists.length;
lists[1];
lists.tag;
export {};
`,
    errors: `
(6,7): error TS2322: Type 'string | number | bigint' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(7,7): error TS2322: Type 'string | number | bigint' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(8,7): error TS2322: Type 'boolean | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(9,7): error TS2322: Type 'number' is not assignable to type 'never'.
(10,3): error TS2339: Property 'push' does not exist on type 'U'.
  Property 'push' does not exist on type 'readonly [2, bigint]'.
(11,3): error TS2540: Cannot assign to '1' because it is a read-only property.
(12,7): error TS2322: Type '"object" | 1 | 3' is not assignable to type 'never'.
  Type '"object"' is not assignable to type 'never'.
(13,7): error TS2322: Type '"long" | 1' is not assignable to type 'never'.
  Type '"long"' is not assignable to type 'never'.
(14,1): error TS7053: Element implicitly has an 'any' type because expression of type '1' can't be used to index type 'Lists'.
  Property '1' does not exist on type 'Lists'.
(15,7): error TS2339: Property 'tag' does not exist on type 'Lists'.
  Property 'tag' does not exist on type '[1]'.
`,
  },
  "object literals": {
    sizes: [7, 8, 65],
    program: count => {
      // Each has its own property, so that none is a subtype of another.
      const literals = `(${each(count - 1, i => `c === ${i} ? { p${i % 3}: ${i % 2 ? `"s"` : 1}, q${i}: 1 }`, " : ")} : { last: true }`;
      return `
declare const c: number;
const p0: never = ${literals}
).p0;
const q3: never = ${literals}
).q3;
const last: never = ${literals}
).last;
${literals}
).p0 = 1;
export {};
`;
    },
    errors: `
(3,7): error TS2322: Type 'string | number | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(5,7): error TS2322: Type 'number | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(7,7): error TS2322: Type 'boolean | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
`,
  },
  "members that are a type parameter, a union, a mapped type or a primitive": {
    program: count => `
type U = ${each(count - 4, i => `{ tag: ${i}; all: ${i % 3}; some${i % 2}: 1 }`)};
function constrained<T extends { all: "t"; some0: 2 }, V extends { all: "v" } | { all: "w"; some0: 3 }>(
  u: U | T | V | Record<"all" | "mapped", 6> | Partial<{ all: 7 }>,
  v: U | T | V | T[] | { all: T },
) {
  const all: never = u.all;
  u.some0;
  u.mapped;
  const other: never = v.all;
  v.some0;
  v.length;
}
function primitive(u: U | string | 1n | true | symbol, v: "a" | "b" | string[] | U) {
  u.all;
  u.length;
  const text: never = u.toString();
  const value: never = u.valueOf;
  v.length;
  v.all;
}
function generic<K extends "all" | "tag">(u: U | { [P in K]: 9 } | { [P in "all" | "tag"]: P } | Readonly<U> | null) {
  const all: never = u!.all;
  u.tag;
}
export {};
`,
    errors: `
(7,9): error TS2322: Type '"t" | "v" | "w" | 0 | 1 | 2 | 6 | 7 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(8,5): error TS2339: Property 'some0' does not exist on type 'Partial<{ all: 7; }> | Record<"all" | "mapped", 6> | { all: "t"; some0: 2; } | { all: "v"; } | { all: "w"; some0: 3; } | U'.
  Property 'some0' does not exist on type 'Partial<{ all: 7; }>'.
(9,5): error TS2339: Property 'mapped' does not exist on type 'Partial<{ all: 7; }> | Record<"all" | "mapped", 6> | { all: "t"; some0: 2; } | { all: "v"; } | { all: "w"; some0: 3; } | U'.
  Property 'mapped' does not exist on type 'Partial<{ all: 7; }>'.
(10,9): error TS2322: Type 'any' is not assignable to type 'never'.
(10,26): error TS2339: Property 'all' does not exist on type 'T[] | { all: "t"; some0: 2; } | { all: "v"; } | { all: "w"; some0: 3; } | { all: T; } | U'.
  Property 'all' does not exist on type 'T[]'.
(11,5): error TS2339: Property 'some0' does not exist on type 'T[] | { all: "t"; some0: 2; } | { all: "v"; } | { all: "w"; some0: 3; } | { all: T; } | U'.
  Property 'some0' does not exist on type 'T[]'.
(12,5): error TS2339: Property 'length' does not exist on type 'T[] | { all: "t"; some0: 2; } | { all: "v"; } | { all: "w"; some0: 3; } | { all: T; } | U'.
  Property 'length' does not exist on type '{ tag: 0; all: 0; some0: 1; }'.
(15,5): error TS2339: Property 'all' does not exist on type 'string | symbol | 1n | true | U'.
  Property 'all' does not exist on type 'string'.
(16,5): error TS2339: Property 'length' does not exist on type 'string | symbol | 1n | true | U'.
  Property 'length' does not exist on type 'symbol'.
(17,9): error TS2322: Type 'string' is not assignable to type 'never'.
(18,9): error TS2322: Type '(() => symbol) | (() => Object) | (() => string) | (() => boolean) | (() => bigint)' is not assignable to type 'never'.
  Type '() => symbol' is not assignable to type 'never'.
(19,5): error TS2339: Property 'length' does not exist on type '"a" | "b" | string[] | U'.
  Property 'length' does not exist on type '{ tag: 0; all: 0; some0: 1; }'.
(20,5): error TS2339: Property 'all' does not exist on type '"a" | "b" | string[] | U'.
  Property 'all' does not exist on type '"a"'.
(23,9): error TS2322: Type 'any' is not assignable to type 'never'.
(23,25): error TS2339: Property 'all' does not exist on type '{ [P in K]: 9; } | { all: "all"; tag: "tag"; } | Readonly<U> | U'.
  Property 'all' does not exist on type '{ [P in K]: 9; }'.
(24,3): error TS18047: 'u' is possibly 'null'.
(24,5): error TS2339: Property 'tag' does not exist on type '{ [P in K]: 9; } | { all: "all"; tag: "tag"; } | Readonly<U> | U'.
  Property 'tag' does not exist on type '{ [P in K]: 9; }'.
`,
  },
  "late-bound and numeric names": {
    program: count => `
declare const key: unique symbol;
declare const other: unique symbol;
type U = ${each(count, i => (i % 2 ? `{ tag: ${i}; [key]: ${i % 4}; [Symbol.iterator](): Iterator<${i % 4}>; 0: "a"; "1": "b"; 1.5: 1 }` : `{ tag: ${i}; [key]: "k"; 0: "c"; [index: string]: unknown }`))};
declare const u: U;
const keyed: never = u[key];
u[other];
u[Symbol.iterator];
for (const item of u) item;
const zero: never = u[0];
const quoted: never = u["0"];
const one: never = u[1];
const fraction: never = u[1.5];
const two: never = u[2];
const keys: never = null! as keyof U;
export {};
`,
    errors: `
(6,7): error TS2322: Type '"k" | 1 | 3' is not assignable to type 'never'.
  Type '"k"' is not assignable to type 'never'.
(7,1): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type 'U'.
  Property '[other]' does not exist on type 'U'.
(8,1): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type 'U'.
  Property '[SymbolConstructor.iterator]' does not exist on type 'U'.
(9,20): error TS2488: Type 'U' must have a '[Symbol.iterator]()' method that returns an iterator.
(10,7): error TS2322: Type '"a" | "c"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(11,7): error TS2322: Type '"a" | "c"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(12,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(13,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(14,7): error TS2322: Type 'any' is not assignable to type 'never'.
(14,20): error TS7053: Element implicitly has an 'any' type because expression of type '2' can't be used to index type 'U'.
  Property '2' does not exist on type 'U'.
(15,7): error TS2322: Type '"1" | "tag" | 0 | 1.5 | unique symbol' is not assignable to type 'never'.
  Type '"1"' is not assignable to type 'never'.
`,
  },
  "names of Object's and Function's properties": {
    program: count => `
type U = ${each(count, i => [`{ tag: ${i}; toString(): "own"; name: 1 }`, `{ tag: ${i} }`, `{ (x: number): ${i % 2}; tag: ${i} }`][i % 3])};
type Functions = ${each(count, i => (i % 2 ? `((x: ${i % 4}) => void)` : `{ new (): object; call: "mine"; tag: ${i} }`))};
declare const u: U;
declare const functions: Functions;
const text: never = u.toString();
const has: never = u.hasOwnProperty;
const built: never = u.constructor;
u.name;
u.call;
u.isPrototypeOf(u);
const call: never = functions.call;
const bind: never = functions.bind;
const length: never = functions.length;
functions.tag;
functions.propertyIsEnumerable("x");
export {};
`,
    errors: `
(6,7): error TS2322: Type 'string' is not assignable to type 'never'.
(7,7): error TS2322: Type '(v: PropertyKey) => boolean' is not assignable to type 'never'.
(8,7): error TS2322: Type 'Function' is not assignable to type 'never'.
(9,3): error TS2339: Property 'name' does not exist on type 'U'.
  Property 'name' does not exist on type '{ tag: 1; }'.
(10,3): error TS2339: Property 'call' does not exist on type 'U'.
  Property 'call' does not exist on type '{ tag: 0; toString(): "own"; name: 1; }'.
(12,7): error TS2322: Type '"mine" | (<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A) => R)' is not assignable to type 'never'.
  Type '"mine"' is not assignable to type 'never'.
(13,7): error TS2322: Type '{ <T>(this: T, thisArg: ThisParameterType<T>): OmitThisParameter<T>; <T, A extends any[], B extends any[], R>(this: (this: T, ...args: [...A, ...B]) => R, thisArg: T, ...args: A): (...args: B) => R; } | { ...; }' is not assignable to type 'never'.
  Type '{ <T>(this: T, thisArg: ThisParameterType<T>): OmitThisParameter<T>; <T, A extends any[], B extends any[], R>(this: (this: T, ...args: [...A, ...B]) => R, thisArg: T, ...args: A): (...args: B) => R; }' is not assignable to type 'never'.
(14,7): error TS2322: Type 'number' is not assignable to type 'never'.
(15,11): error TS2339: Property 'tag' does not exist on type 'Functions'.
  Property 'tag' does not exist on type '(x: 1) => void'.
`,
  },
  "accessors, readonly, private and protected properties": {
    program: count => `
declare class Base { private secret: 1; protected guarded: 2; value: number }
${each(
  count,
  i =>
    `declare class C${i} extends Base { tag: ${i}; ${
      [
        "get size(): number; set size(value: number | string);",
        "get size(): number;",
        "readonly size: number;",
        "size: number;",
        "size: number; private hidden: 1;",
        "set size(value: number); protected hidden: 1;",
      ][i % 6]
    } }`,
  " ",
)}
${each(count, i => `declare class A${i} { tag: ${i}; get both(): ${i % 2}; set both(value: ${i % 2} | "w"); get only(): 1; ${i % 2 ? "private" : "public"} mixed: 1 }`, " ")}
type U = ${each(count, i => `C${i}`)};
type Accessors = ${each(count, i => `A${i}`)};
declare const u: U;
declare const accessors: Accessors;
const size: never = u.size;
u.size = 1;
u.hidden;
u.secret;
u.guarded;
u.value = 1;
const both: never = accessors.both;
accessors.both = "w";
accessors.both = 0;
accessors.only = 1;
accessors.mixed;
export {};
`,
    errors: `
(9,7): error TS2322: Type 'number' is not assignable to type 'never'.
(10,3): error TS2540: Cannot assign to 'size' because it is a read-only property.
(11,3): error TS2339: Property 'hidden' does not exist on type 'U'.
  Property 'hidden' does not exist on type 'C0'.
(12,3): error TS2341: Property 'secret' is private and only accessible within class 'Base'.
(13,3): error TS2445: Property 'guarded' is protected and only accessible within class 'Base' and its subclasses.
(15,7): error TS2322: Type '0 | 1' is not assignable to type 'never'.
  Type '0' is not assignable to type 'never'.
(18,11): error TS2540: Cannot assign to 'only' because it is a read-only property.
(19,11): error TS2339: Property 'mixed' does not exist on type 'Accessors'.
`,
  },
  discriminants: {
    program: count => `
type U = ${each(count, i => `{ kind: "k${i}"; value: ${i % 2 ? "string" : "number"}; only${i}: ${i} }`)};
function narrow(u: U) {
  if (u.kind === "k3") {
    const value: never = u.value;
    u.only3;
    u.only4;
  }
  if (u.kind === "k0" || u.kind === "k2") {
    const value: never = u.value;
    u.only0;
  }
  switch (u.kind) {
    case "k1":
      return u.only2;
    ${each(count, i => `case "k${i}":`, " ")}
      return;
  }
  const done: 1 = u;
}
const wrong: U = { kind: "k2", value: "x", only2: 2 };
const excess: U = { kind: "k2", value: 1, only2: 2, only3: 3 };
const incomplete: U = { kind: "k5", value: "" };
const picked: never = null! as Extract<U, { kind: "k6" }>;
export {};
`,
    errors: `
(5,11): error TS2322: Type 'string' is not assignable to type 'never'.
(7,7): error TS2551: Property 'only4' does not exist on type '{ kind: "k3"; value: string; only3: 3; }'. Did you mean 'only3'?
(10,11): error TS2322: Type 'number' is not assignable to type 'never'.
(11,7): error TS2339: Property 'only0' does not exist on type '{ kind: "k0"; value: number; only0: 0; } | { kind: "k2"; value: number; only2: 2; }'.
  Property 'only0' does not exist on type '{ kind: "k2"; value: number; only2: 2; }'.
(15,16): error TS2551: Property 'only2' does not exist on type '{ kind: "k1"; value: string; only1: 1; }'. Did you mean 'only1'?
(21,7): error TS2322: Type '{ kind: "k2"; value: string; only2: 2; }' is not assignable to type 'U'.
  Types of property 'value' are incompatible.
    Type 'string' is not assignable to type 'number'.
(22,53): error TS2561: Object literal may only specify known properties, but 'only3' does not exist in type '{ kind: "k2"; value: number; only2: 2; }'. Did you mean to write 'only2'?
(23,7): error TS2322: Type '{ kind: "k5"; value: string; }' is not assignable to type 'U'.
  Property 'only5' is missing in type '{ kind: "k5"; value: string; }' but required in type '{ kind: "k5"; value: string; only5: 5; }'.
(24,7): error TS2322: Type '{ kind: "k6"; value: number; only6: 6; }' is not assignable to type 'never'.
`,
  },
  "intersections of unions": {
    sizes: [7, 8, 20],
    program: count => `
type U = ${each(count, i => `{ kind: "k${i}"; value: ${i % 2 ? "string" : "number"}; only${i}: ${i} }`)};
type V = ${each(count, i => `{ kind: "k${i}"; extra: ${i % 3} }`)};
type Open = ${each(count, i => `{ tag${i % 3}: ${i}; shared?: ${i % 2} }`)};
type Both = U & V;
type Crossed = Open & (${each(count, i => `{ other${i % 2}: ${i}; shared?: 0 | 1 | 2 }`)});
declare const both: Both;
declare const kept: U & { more: 1 };
declare const crossed: Crossed;
const none: U & { kind: "none" } = 1;
const one: never = null! as (U & { kind: "k2" })["only2"];
const empty: (U & { kind: "k2" }) & (V & { kind: "k3" }) = 1;
if (both.kind === "k4") {
  const extra: never = both.extra;
  both.only4;
  both.only5;
}
both.extra = 3;
kept.more;
const value: never = kept.value;
kept.only0;
const shared: never = crossed.shared;
crossed.tag0;
export {};
`,
    errors: `
(10,7): error TS2322: Type '1' is not assignable to type 'never'.
(11,7): error TS2322: Type '2' is not assignable to type 'never'.
(12,7): error TS2322: Type '1' is not assignable to type 'never'.
(14,9): error TS2322: Type '1' is not assignable to type 'never'.
(16,8): error TS2551: Property 'only5' does not exist on type '{ kind: "k4"; value: number; only4: 4; } & { kind: "k4"; extra: 1; }'. Did you mean 'only4'?
  Property 'only5' does not exist on type 'never'.
(18,1): error TS2322: Type '3' is not assignable to type '0 | 1 | 2'.
(20,7): error TS2322: Type 'string | number' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(21,6): error TS2339: Property 'only0' does not exist on type 'U & { more: 1; }'.
  Property 'only0' does not exist on type '{ kind: "k1"; value: string; only1: 1; } & { more: 1; }'.
(22,7): error TS2322: Type '0 | 1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(23,9): error TS2339: Property 'tag0' does not exist on type 'Crossed'.
  Property 'tag0' does not exist on type '{ tag1: 1; shared?: 1 | undefined; } & { other0: 0; shared?: 0 | 1 | 2 | undefined; }'.
`,
  },
  "a mapped type over a union whose members have an index signature": {
    program: count => `
type Props = ${each(count, i => `({ p${i}: ${i}; shared: ${i % 2 ? "string" : "number"} } & Record<string, unknown>)`)};
type Copy = { [K in keyof Props]: Props[K] };
interface Box<T> { get(): T & Props; set(value: (T & Props)["shared"]): void }
declare let narrow: Box<{ x: 1; y: 2 }>;
declare let wide: Box<{ x: 1 }>;
declare const copy: Copy;
const shared: never = copy.shared;
const p3: never = copy.p3;
const anything: never = copy.anything;
wide = narrow;
narrow = wide;
const got: never = wide.get().shared;
const own: never = wide.get().p3;
const x: never = wide.get().x;
export {};
`,
    errors: `
(8,7): error TS2322: Type 'string | number' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(9,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(10,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(11,1): error TS2322: Type 'Box<{ x: 1; y: 2; }>' is not assignable to type 'Box<{ x: 1; }>'.
  Property 'y' is missing in type '{ x: 1; }' but required in type '{ x: 1; y: 2; }'.
(12,1): error TS2322: Type 'Box<{ x: 1; }>' is not assignable to type 'Box<{ x: 1; y: 2; }>'.
  The types returned by 'get()' are incompatible between these types.
    Type '{ x: 1; } & Props' is not assignable to type '{ x: 1; y: 2; } & Props'.
      Type '{ x: 1; } & { p0: 0; shared: number; } & Record<string, unknown>' is not assignable to type '{ x: 1; y: 2; } & Props'.
(13,7): error TS2322: Type 'string | number' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(14,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(15,7): error TS2322: Type '1' is not assignable to type 'never'.
`,
  },
  "properties that interfaces inherit from one mapped type": {
    sizes: [1],
    program: () => `
interface Attributes<T> { id: string; title: string; hidden: boolean; target: T; onClick(event: T): void }
interface ButtonProps extends Omit<Attributes<"button">, "title"> { variant: "text"; self(): this }
interface LinkProps extends Omit<Attributes<"button">, "title"> { href: string }
interface Generic<T> extends Omit<Attributes<T>, "title" | "id"> { of: T }
declare const both: ButtonProps & LinkProps & { id: "x" };
declare const either: ButtonProps | LinkProps;
declare const generic: Generic<"a"> & Generic<"a" | "b"> & ButtonProps;
const id: never = both.id;
const hidden: never = both.hidden;
const target: never = both.target;
both.title;
const extra: never = both.self().href;
both.hidden = 1;
const shared: never = either.target;
either.href;
const narrowed: never = generic.target;
const handler: never = generic.onClick;
function instantiated<T extends string>(value: Generic<T> & LinkProps & { of: "z" }) {
  const target: never = value.target;
  const of: never = value.of;
  const id: never = value.id;
}
export {};
`,
    errors: `
(9,7): error TS2322: Type '"x"' is not assignable to type 'never'.
(10,7): error TS2322: Type 'boolean' is not assignable to type 'never'.
(11,7): error TS2322: Type '"button"' is not assignable to type 'never'.
(12,6): error TS2339: Property 'title' does not exist on type 'ButtonProps & LinkProps & { id: "x"; }'.
(13,7): error TS2322: Type 'string' is not assignable to type 'never'.
(14,1): error TS2322: Type 'number' is not assignable to type 'boolean'.
(15,7): error TS2322: Type '"button"' is not assignable to type 'never'.
(16,8): error TS2339: Property 'href' does not exist on type 'ButtonProps | LinkProps'.
  Property 'href' does not exist on type 'ButtonProps'.
(17,7): error TS2322: Type 'any' is not assignable to type 'never'.
(17,33): error TS2339: Property 'target' does not exist on type 'never'.
  The intersection 'Generic<"a"> & Generic<"a" | "b"> & ButtonProps' was reduced to 'never' because property 'target' has conflicting types in some constituents.
(18,7): error TS2322: Type 'any' is not assignable to type 'never'.
(18,32): error TS2339: Property 'onClick' does not exist on type 'never'.
  The intersection 'Generic<"a"> & Generic<"a" | "b"> & ButtonProps' was reduced to 'never' because property 'target' has conflicting types in some constituents.
(20,9): error TS2322: Type 'T & "button"' is not assignable to type 'never'.
(21,9): error TS2322: Type 'T & "z"' is not assignable to type 'never'.
(22,9): error TS2322: Type 'string' is not assignable to type 'never'.
`,
  },
  "one property after another of the same union": {
    sizes: [7, 8, 65, 127, 128, 129, 200],
    program: count => `
type Closed = ${each(count, i => (i === 3 ? `{ tag: 0; ${each(12, k => `s${k}: "three"`, "; ")} }` : `{ tag: ${i % 3}; own${i}: ${i % 3} }`))};
type Open = ${each(count, i => (i === 3 ? `{ ${each(12, k => `s${k}: "three"`, "; ")}; [key: string]: "three" | "other" }` : `{ tag: ${i % 3}; own${i}: ${i % 3}; [key: string]: ${i % 3} | "index" }`))};
declare const closed: Closed;
declare const open: Open;
${each(12, k => `closed.s${k};`, "\n")}
closed.own5;
closed.own3;
closed.nothing;
const tag: 0 = closed.tag;
${each(12, k => `const s${k}: never = open.s${k};`, "\n")}
const own5: never = open.own5;
const nothing: never = open.nothing;
open.s11 = "index";
open.own5 = "index";
export {};
`,
    errors: `
(6,8): error TS2339: Property 's0' does not exist on type 'Closed'.
  Property 's0' does not exist on type '{ tag: 0; own0: 0; }'.
(7,8): error TS2339: Property 's1' does not exist on type 'Closed'.
  Property 's1' does not exist on type '{ tag: 0; own0: 0; }'.
(8,8): error TS2339: Property 's2' does not exist on type 'Closed'.
  Property 's2' does not exist on type '{ tag: 0; own0: 0; }'.
(9,8): error TS2339: Property 's3' does not exist on type 'Closed'.
  Property 's3' does not exist on type '{ tag: 0; own0: 0; }'.
(10,8): error TS2339: Property 's4' does not exist on type 'Closed'.
  Property 's4' does not exist on type '{ tag: 0; own0: 0; }'.
(11,8): error TS2339: Property 's5' does not exist on type 'Closed'.
  Property 's5' does not exist on type '{ tag: 0; own0: 0; }'.
(12,8): error TS2339: Property 's6' does not exist on type 'Closed'.
  Property 's6' does not exist on type '{ tag: 0; own0: 0; }'.
(13,8): error TS2339: Property 's7' does not exist on type 'Closed'.
  Property 's7' does not exist on type '{ tag: 0; own0: 0; }'.
(14,8): error TS2339: Property 's8' does not exist on type 'Closed'.
  Property 's8' does not exist on type '{ tag: 0; own0: 0; }'.
(15,8): error TS2339: Property 's9' does not exist on type 'Closed'.
  Property 's9' does not exist on type '{ tag: 0; own0: 0; }'.
(16,8): error TS2339: Property 's10' does not exist on type 'Closed'.
  Property 's10' does not exist on type '{ tag: 0; own0: 0; }'.
(17,8): error TS2339: Property 's11' does not exist on type 'Closed'.
  Property 's11' does not exist on type '{ tag: 0; own0: 0; }'.
(18,8): error TS2339: Property 'own5' does not exist on type 'Closed'.
  Property 'own5' does not exist on type '{ tag: 0; own0: 0; }'.
(19,8): error TS2339: Property 'own3' does not exist on type 'Closed'.
  Property 'own3' does not exist on type '{ tag: 0; own0: 0; }'.
(20,8): error TS2339: Property 'nothing' does not exist on type 'Closed'.
  Property 'nothing' does not exist on type '{ tag: 0; own0: 0; }'.
(21,7): error TS2322: Type '0 | 1 | 2' is not assignable to type '0'.
  Type '1' is not assignable to type '0'.
(22,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(23,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(24,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(25,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(26,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(27,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(28,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(29,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(30,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(31,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(32,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(33,7): error TS2322: Type '"index" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(34,7): error TS2322: Type '"index" | "other" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
(35,7): error TS2322: Type '"index" | "other" | "three" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"index"' is not assignable to type 'never'.
`,
  },
  "unions that share members": {
    sizes: [7, 8, 65, 127, 128, 129, 200],
    program: count => `
type Closed = ${each(count, i => `{ tag: ${i}; group: ${i % 3}; own${i}: ${i}; some${i % 2}: 1 }`)};
type Open = ${each(count, i => (i === 5 ? `{ group: 2; own5: "five"; [key: string]: 2 | "five" | "six" }` : `{ group: ${i % 3}; own${i}: ${i % 3}; [key: string]: ${i % 3} | "index" }`))};
function narrowed(closed: Closed, open: Open) {
  // @ts-expect-error
  closed.own1; closed.own2; closed.own4; closed.own5; closed.own6; closed.nothing;
  const all = [open.own1, open.own2, open.own4, open.own5, open.own6, open.nothing];
  const before: never = open.own5;
  if (closed.group !== 0 && open.group !== 0) {
    // @ts-expect-error
    closed.own5; closed.some0; closed.own4; closed.nothing; closed.own7;
    const some: never = closed.tag === 1 ? closed.some1 : closed.group;
    const own5: never = open.own5;
    const own4: never = open.own4;
    const nothing: never = open.nothing;
    if (closed.group !== 1 && open.group !== 1) {
      // @ts-expect-error
      closed.own6;
      const own5: never = open.own5;
      const own6: never = open.own6;
      const nothing: never = open.nothing;
      const group: never = closed.group;
    }
  }
  if (closed.tag === 5 || closed.tag === 2) {
    // @ts-expect-error
    closed.own5;
    const some: never = closed.tag === 5 ? closed.some1 : closed.some0;
  }
  const after: never = open.own5;
}
declare const rest: Exclude<Closed, { group: 0 }> | { tag: "extra"; own5: "extra" };
declare const others: Exclude<Open, { group: 1 }> | { own5: "extra"; [key: string]: "extra" };
// @ts-expect-error
rest.own5; rest.own6; rest.own1; rest.nothing; rest.some0;
const group: never = rest.tag === "extra" ? rest.own5 : rest.group;
const own5: never = others.own5;
const own4: never = others.own4;
const nothing: never = others.nothing;
export {};
`,
    errors: `
(8,9): error TS2322: Type '"five" | "index" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"five"' is not assignable to type 'never'.
(12,11): error TS2322: Type '1 | 2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(13,11): error TS2322: Type '"five" | "index" | 1 | 2' is not assignable to type 'never'.
  Type '"five"' is not assignable to type 'never'.
(14,11): error TS2322: Type '"five" | "index" | "six" | 1 | 2' is not assignable to type 'never'.
  Type '"five"' is not assignable to type 'never'.
(15,11): error TS2322: Type '"five" | "index" | "six" | 1 | 2' is not assignable to type 'never'.
  Type '"five"' is not assignable to type 'never'.
(19,13): error TS2322: Type '"five" | "index" | 2' is not assignable to type 'never'.
  Type '"five"' is not assignable to type 'never'.
(20,13): error TS2322: Type '"five" | "index" | "six" | 2' is not assignable to type 'never'.
  Type '"five"' is not assignable to type 'never'.
(21,13): error TS2322: Type '"five" | "index" | "six" | 2' is not assignable to type 'never'.
  Type '"five"' is not assignable to type 'never'.
(22,13): error TS2322: Type '2' is not assignable to type 'never'.
(28,11): error TS2322: Type '1' is not assignable to type 'never'.
(30,9): error TS2322: Type '"five" | "index" | 0 | 1 | 2' is not assignable to type 'never'.
  Type '"five"' is not assignable to type 'never'.
(36,7): error TS2322: Type '"extra" | 1 | 2' is not assignable to type 'never'.
  Type '"extra"' is not assignable to type 'never'.
(37,7): error TS2322: Type '"extra" | "five" | "index" | 0 | 2' is not assignable to type 'never'.
  Type '"extra"' is not assignable to type 'never'.
(38,7): error TS2322: Type '"extra" | "five" | "index" | "six" | 0 | 2' is not assignable to type 'never'.
  Type '"extra"' is not assignable to type 'never'.
(39,7): error TS2322: Type '"extra" | "five" | "index" | "six" | 0 | 2' is not assignable to type 'never'.
  Type '"extra"' is not assignable to type 'never'.
`,
  },
  "a member that's being resolved during the lookup": {
    sizes: [7, 8, 65, 127, 128, 129, 200],
    program: count => `
type Plain = ${each(count - 1, i => `{ kind: "k${i}"; x: ${i % 3}; own${i}: ${i} }`)};
interface Left { kind: "both"; x: WithBoth["x"]; left: 1 }
interface Right { kind: "both"; x: WithBoth["x"] | 9; right: WithBoth["own2"] }
type WithBoth = (Left & Right) | Plain;
interface Base<T> { base: T; x: 7 }
interface Derived extends Base<WithDerived["x"]> { kind: "derived"; derived: WithDerived["own1"] }
type WithDerived = Derived | Plain;
declare const withBoth: WithBoth;
declare const withDerived: WithDerived;
const x: never = withBoth.x;
withBoth.own1;
withBoth.own2;
withBoth.left;
const kind: 0 = withBoth.kind === "both" ? withBoth.right : 0;
const again: never = withBoth.x;
withDerived.kind;
withDerived.own1;
withDerived.own2;
withDerived.base;
const base: never = withDerived.kind === "derived" ? withDerived.base : (null! as never);
const derived: never = withDerived.kind === "derived" ? withDerived.derived : (null! as never);
export {};
`,
    errors: `
(3,32): error TS2502: 'x' is referenced directly or indirectly in its own type annotation.
(4,33): error TS2502: 'x' is referenced directly or indirectly in its own type annotation.
(4,71): error TS2339: Property 'own2' does not exist on type 'WithBoth'.
(7,11): error TS2310: Type 'Derived' recursively references itself as a base type.
(7,44): error TS2339: Property 'x' does not exist on type 'WithDerived'.
(7,90): error TS2339: Property 'own1' does not exist on type 'WithDerived'.
(11,7): error TS2322: Type 'any' is not assignable to type 'never'.
(12,10): error TS2339: Property 'own1' does not exist on type 'WithBoth'.
  Property 'own1' does not exist on type '{ kind: "k0"; x: 0; own0: 0; }'.
(13,10): error TS2339: Property 'own2' does not exist on type 'WithBoth'.
  Property 'own2' does not exist on type '{ kind: "k0"; x: 0; own0: 0; }'.
(14,10): error TS2339: Property 'left' does not exist on type 'WithBoth'.
  Property 'left' does not exist on type '{ kind: "k0"; x: 0; own0: 0; }'.
(16,7): error TS2322: Type 'any' is not assignable to type 'never'.
(18,13): error TS2339: Property 'own1' does not exist on type 'WithDerived'.
  Property 'own1' does not exist on type 'Derived'.
(19,13): error TS2339: Property 'own2' does not exist on type 'WithDerived'.
  Property 'own2' does not exist on type 'Derived'.
(20,13): error TS2339: Property 'base' does not exist on type 'WithDerived'.
  Property 'base' does not exist on type '{ kind: "k0"; x: 0; own0: 0; }'.
(21,7): error TS2322: Type 'any' is not assignable to type 'never'.
(22,7): error TS2322: Type 'any' is not assignable to type 'never'.
`,
  },
  // An object literal property's contextual type comes from the union members that have the property or an index
  // signature. The others are skipped once enough is known about them.
  "the contextual type of a property that all, two kinds, one or none of the members have": {
    sizes: [2, 8, 127, 128, 300],
    program: count => `
type OnString = (x: string) => void;
type OnNumber = (x: number) => void;
type U = ${each(count, i => `{ own${i}?: ${i}; all?: OnString; either?: ${i % 2 ? "OnString" : "OnNumber"};${i === 1 ? " one?: (x: boolean) => void; nested?: { deep: (y: bigint) => void }; list?: ((z: symbol) => void)[];" : ""} }`)};
declare function take(u: U): void;
const all: U = { all: x => { const n: never = x; } };
const either: U = { either: x => { const n: never = x; } };
const one: U = { one: x => { const n: never = x; } };
const none: U = { none: x => { const n: never = x; } };
const nested: U = { nested: { deep: y => { const n: never = y; } } };
const list: U = { list: [z => { const n: never = z; }] };
const own: U = { own0: 0, own1: 1, all(x) { const n: never = x; } };
const value: U = { all: 1, either: 2, one: "no" };
take({ one: x => { const n: never = x; }, all: x => { const n: never = x; } });
take({ one(x) { const n: never = x; }, none(x) { const n: never = x; } });
const again: U = { one: x => { const n: never = x; } };
const inherited: U = { toString: x => "", valueOf() { return {}; } };
const numeric: U = { 0: x => { const n: never = x; } };
const computed: U = { ["one"]: x => { const n: never = x; }, [Symbol.iterator]: x => { const n: never = x; } };
export {};
`,
    errors: `
(6,36): error TS2322: Type 'string' is not assignable to type 'never'.
(7,29): error TS7006: Parameter 'x' implicitly has an 'any' type.
(7,42): error TS2322: Type 'any' is not assignable to type 'never'.
(8,36): error TS2322: Type 'boolean' is not assignable to type 'never'.
(9,19): error TS2353: Object literal may only specify known properties, and 'none' does not exist in type 'U'.
(9,25): error TS7006: Parameter 'x' implicitly has an 'any' type.
(9,38): error TS2322: Type 'any' is not assignable to type 'never'.
(10,50): error TS2322: Type 'bigint' is not assignable to type 'never'.
(11,39): error TS2322: Type 'symbol' is not assignable to type 'never'.
(12,51): error TS2322: Type 'string' is not assignable to type 'never'.
(13,20): error TS2322: Type 'number' is not assignable to type 'OnString'.
(13,28): error TS2322: Type 'number' is not assignable to type 'OnNumber | OnString | undefined'.
(13,39): error TS2322: Type 'string' is not assignable to type '(x: boolean) => void'.
(14,26): error TS2322: Type 'boolean' is not assignable to type 'never'.
(14,61): error TS2322: Type 'string' is not assignable to type 'never'.
(15,23): error TS2322: Type 'boolean' is not assignable to type 'never'.
(15,40): error TS2353: Object literal may only specify known properties, and 'none' does not exist in type 'U'.
(15,45): error TS7006: Parameter 'x' implicitly has an 'any' type.
(15,56): error TS2322: Type 'any' is not assignable to type 'never'.
(16,38): error TS2322: Type 'boolean' is not assignable to type 'never'.
(17,24): error TS2322: Type '(x: any) => string' is not assignable to type '() => string'.
  Target signature provides too few arguments. Expected 1 or more, but got 0.
(17,34): error TS7006: Parameter 'x' implicitly has an 'any' type.
(18,22): error TS2353: Object literal may only specify known properties, and '0' does not exist in type 'U'.
(18,25): error TS7006: Parameter 'x' implicitly has an 'any' type.
(18,38): error TS2322: Type 'any' is not assignable to type 'never'.
(19,45): error TS2322: Type 'boolean' is not assignable to type 'never'.
(19,62): error TS2353: Object literal may only specify known properties, and '[Symbol.iterator]' does not exist in type 'U'.
(19,81): error TS7006: Parameter 'x' implicitly has an 'any' type.
(19,94): error TS2322: Type 'any' is not assignable to type 'never'.
`,
  },
  "the contextual type of a property, with an index signature and an intersection among the members": {
    sizes: [3, 8, 127, 128, 300],
    program: count => `
type U = ${each(count, i =>
      i === 0
        ? `{ [key: string]: { fromIndex?: (x: symbol) => void } | undefined }`
        : i === 1
          ? `({ left?: { fromLeft?: (x: "l") => void } } & { right?: { fromRight?: (x: "r") => void }; both?: { a?: (x: 1) => void } } & { both?: { b?: (x: 2) => void } })`
          : `{ own${i}?: { fromOwn?: (x: bigint) => void }; both?: { c?: (x: 3) => void } }`,
    )};
declare function take(u: U): void;
const left: U = { left: { fromIndex: x => { const n: never = x; }, fromLeft: x => { const n: never = x; } } };
const right: U = { right: { fromIndex: x => { const n: never = x; }, fromRight: x => { const n: never = x; } } };
const both: U = { both: { fromIndex: x => { const n: never = x; }, a: x => { const n: never = x; }, b: x => { const n: never = x; }, c: x => { const n: never = x; } } };
const own: U = { own2: { fromIndex: x => { const n: never = x; }, fromOwn: x => { const n: never = x; } } };
const none: U = { none: { fromIndex: x => { const n: never = x; }, fromLeft: x => { const n: never = x; } } };
take({ left: { fromLeft: x => { const n: never = x; } }, none: { fromIndex: x => { const n: never = x; } } });
const again: U = { left: { fromIndex: x => { const n: never = x; }, fromLeft: x => { const n: never = x; } } };
export {};
`,
    errors: `
(4,51): error TS2322: Type 'symbol' is not assignable to type 'never'.
(4,91): error TS2322: Type '"l"' is not assignable to type 'never'.
(5,53): error TS2322: Type 'symbol' is not assignable to type 'never'.
(5,94): error TS2322: Type '"r"' is not assignable to type 'never'.
(6,51): error TS2322: Type 'symbol' is not assignable to type 'never'.
(6,84): error TS2322: Type '1' is not assignable to type 'never'.
(6,117): error TS2322: Type '2' is not assignable to type 'never'.
(6,150): error TS2322: Type '3' is not assignable to type 'never'.
(7,50): error TS2322: Type 'symbol' is not assignable to type 'never'.
(7,89): error TS2322: Type 'bigint' is not assignable to type 'never'.
(8,51): error TS2322: Type 'symbol' is not assignable to type 'never'.
(8,68): error TS2353: Object literal may only specify known properties, and 'fromLeft' does not exist in type '{ fromIndex?: ((x: symbol) => void) | undefined; }'.
(8,78): error TS7006: Parameter 'x' implicitly has an 'any' type.
(8,91): error TS2322: Type 'any' is not assignable to type 'never'.
(9,39): error TS2322: Type '"l"' is not assignable to type 'never'.
(9,90): error TS2322: Type 'symbol' is not assignable to type 'never'.
(10,52): error TS2322: Type 'symbol' is not assignable to type 'never'.
(10,92): error TS2322: Type '"l"' is not assignable to type 'never'.
`,
  },
  "the contextual type of a property, with a discriminant, a mapped type or a tuple among the members": {
    sizes: [2, 8, 127, 128, 300],
    program: count => `
type U = ${each(count, i => `{ kind: "k${i}"; on: (x: ${i % 2 ? `"odd${i}"` : `"even${i}"`}) => void;${i === 1 ? " extra?: (x: boolean) => void;" : ""} }`)};
type Mapped = ${each(count, i => (i === 0 ? `Partial<Record<"m" | "n", (x: "mapped") => void>>` : i === 1 ? `readonly [(x: "tuple") => void]` : `{ p${i}?: 1 }`))};
declare function take(u: U): void;
const k0: U = { kind: "k0", on: x => { const n: never = x; } };
const k1: U = { kind: "k1", on: x => { const n: never = x; }, extra: x => { const n: never = x; } };
take({ kind: "k1", on(x) { const n: never = x; }, extra(x) { const n: never = x; } });
const m: Mapped = { m: x => { const n: never = x; } };
const n: Mapped = { n: x => { const n: never = x; } };
const tuple: Mapped = [x => { const n: never = x; }];
function generic<T extends U>(t: T) {
  const made: T | U = { kind: "k0", on: x => { const n: never = x; } };
}
export {};
`,
    errors: `
(5,46): error TS2322: Type '"even0"' is not assignable to type 'never'.
(6,46): error TS2322: Type '"odd1"' is not assignable to type 'never'.
(6,83): error TS2322: Type 'boolean' is not assignable to type 'never'.
(7,34): error TS2322: Type '"odd1"' is not assignable to type 'never'.
(7,68): error TS2322: Type 'boolean' is not assignable to type 'never'.
(8,37): error TS2322: Type '"mapped"' is not assignable to type 'never'.
(9,37): error TS2322: Type '"mapped"' is not assignable to type 'never'.
(10,37): error TS2322: Type '"tuple"' is not assignable to type 'never'.
(12,54): error TS2322: Type '"even0"' is not assignable to type 'never'.
`,
  },
};

// Returns `program` with one more line at the top, which looks up 12 names that no member has in each of its unions.
// After that, `bun check` has cached everything it ever caches about a union and its members.
function afterUnrelatedLookups(program: string) {
  const aliases = Array.from(program.matchAll(/^type (\w+) =/gm), found => found[1]);
  const reads = aliases.flatMap(alias => Array.from({ length: 12 }, (_, i) => `(null! as ${alias}).other${i}`));
  return `// @ts-ignore\n[${reads.join(", ")}];${program}`;
}

test.concurrent.each(Object.keys(cases))("reports the same errors at every union size: %s", async title => {
  const { sizes = [7, 8, 65, 130], program, errors } = cases[title];
  using dir = tempDir("bun-check-union", {
    "tsconfig.json": tsconfig,
    ...Object.fromEntries(sizes.map(size => [`first${size}.ts`, program(size)])),
    ...Object.fromEntries(sizes.map(size => [`later${size}.ts`, afterUnrelatedLookups(program(size))])),
  });
  const byFile: Record<string, string[]> = {};
  let file = "";
  for (const line of await linesOf([bunExe(), "check"], String(dir), String(dir))) {
    // An error's elaboration lines follow it, indented.
    const error = /^((first|later)\d+)\.ts\((\d+)(.*)$/.exec(line);
    if (error) file = error[1];
    (byFile[file] ??= []).push(error ? `(${+error[3] - (error[2] === "later" ? 1 : 0)}${error[4]}` : line);
  }
  const files = sizes.flatMap(size => [`first${size}`, `later${size}`]);
  expect(byFile).toEqual(Object.fromEntries(files.map(it => [it, errors.trim().split("\n")])));
});

// One member of each kind among members that are plain object types, first or last, in a union of 7 and in a union of 8.
const kinds: ((i: number) => string)[] = [
  i => `{ tag: ${i}; a: ${i}; b?: string }`,
  () => `{ [key: string]: unknown }`,
  () => `{ readonly [key: string]: number }`,
  () => `{ [key: number]: "n" }`,
  () => "{ [key: `data-${string}`]: 1; a: 1 }",
  () => `[1, "two"]`,
  () => `readonly string[]`,
  () => `((x: number) => void)`,
  () => `Date`,
  () => `Record<"a" | "c", 1>`,
  () => `Partial<{ a: 1; tag: 2 }>`,
  () => `string`,
  () => `({ a: "i" } & Record<string, unknown>)`,
  () => `({ a: "i" } & { b: "j"; readonly tag: "k" })`,
  () => `({ tag: 1; a: 1 } & { tag: 2 })`,
  () => `object`,
  () => `{}`,
  () => `T`,
  () => `(T & { c: 1 })`,
  () => `T["a"]`,
];
const names = [".a", ".b", ".c", ".tag", "[0]", `["data-x"]`, ".length", ".toString", ".call", "[Symbol.iterator]"];

test.concurrent.skipIf(!tsc)("matches tsc for every kind of union member and property name", async () => {
  const functions: string[] = [];
  for (const size of [7, 8]) {
    for (const kind of kinds) {
      for (const at of [0, size - 1]) {
        for (const name of names) {
          const union = each(size, i => (i === at ? kind(i) : kinds[0](i)));
          functions.push(
            `<T extends { a: { a: "t" } | string[]; tag: "t" }>(u: ${union}) { const read: never = u${name}; u${name} = null!; }`,
          );
        }
      }
    }
  }
  // A debug build is 10 to 100 times slower, so it checks a sample, always the same one.
  const sample = functions.filter((_, index) => index % (isDebug || isASAN ? 7 : 1) === 0);
  using dir = tempDir("bun-check-union", {
    "tsconfig.json": tsconfig,
    "a.ts": sample.map((body, index) => `export function f${index}${body}`).join("\n") + "\n",
  });
  const root = String(dir);
  const [theirs, ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    linesOf([bunExe(), "check"], root, root),
  ]);
  // `read` is an error in each.
  expect(theirs.length).toBeGreaterThan(sample.length);
  expect(ours).toEqual(theirs);
});

// A union keeps its members in a canonical order, whatever it's built from. `bun check` doesn't sort input that's
// already ordered, like another union's members. It merges that with the rest. Where all the types come from one union
// that was narrowed, it picks them from that union by position. It also caches the results for lists of types it has
// seen. A failed assignment prints the union, and the line after it mentions the first member.

// The expected output of each program is TypeScript 7.0.2's, with `noErrorTruncation`.
const orders: Record<string, { program: string; errors: string }> = {
  "unions whose members interleave, overlap, follow each other, are the same or are `never`": {
    program: `
${each(10, i => `interface A0${i} { a${i}: 1 }`, "\n")}
interface Runs {
  odd: A01 | A03 | A05 | A07;
  even: A00 | A02 | A04 | A06;
  low: A00 | A01 | A02 | A03;
  high: A04 | A05 | A06 | A07;
  middle: A02 | A03 | A04 | A05;
  oddAgain: A07 | A05 | A03 | A01;
}
type Odd = A01 | A03 | A05 | A07;
const interleaved: never = null! as Runs["odd"] | Runs["even"];
const theOtherWay: never = null! as Runs["even"] | Runs["odd"];
const oneAfterTheOther: never = null! as Runs["low"] | Runs["high"];
const lastFirst: never = null! as Runs["high"] | Runs["low"];
const overlapping: never = null! as Runs["low"] | Runs["middle"];
const overlappingTwice: never = null! as Runs["high"] | Runs["middle"] | Runs["low"];
const within: never = null! as Runs["middle"] | (Runs["low"] | Runs["high"]);
const equal: never = null! as Runs["odd"] | Runs["oddAgain"];
const named: never = null! as Runs["odd"] | Odd;
const namedAndMore: never = null! as Odd | Runs["middle"];
const none: never = null! as never | Runs["odd"] | never | Runs["even"] | never;
const nothing: 0 = null! as never | never | never;
const three: never = null! as Runs["odd"] | Runs["middle"] | Runs["even"];
const five: never = null! as Runs["odd"] | Runs["middle"] | Runs["even"] | A09 | Runs["high"];
const withOthers: never = null! as Runs["odd"] | undefined | Runs["even"] | "text" | 1 | null;
export {};
`,
    errors: `
(21,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(22,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(23,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(24,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(25,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(26,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(27,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(28,7): error TS2322: Type 'A01 | A03 | A05 | A07' is not assignable to type 'never'.
  Type 'A01' is not assignable to type 'never'.
(29,7): error TS2322: Type 'Odd' is not assignable to type 'never'.
  Type 'A01' is not assignable to type 'never'.
(30,7): error TS2322: Type 'A02 | A04 | Odd' is not assignable to type 'never'.
  Type 'A01' is not assignable to type 'never'.
(31,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(33,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(34,7): error TS2322: Type 'A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07 | A09' is not assignable to type 'never'.
  Type 'A00' is not assignable to type 'never'.
(35,7): error TS2322: Type '"text" | 1 | A00 | A01 | A02 | A03 | A04 | A05 | A06 | A07 | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
`,
  },
  "members that a wider member, a pattern, a supertype or a constraint removes from merged unions": {
    program: `
interface A { a: 1 } interface B { b: 1 } interface C extends A { c: 1 } interface D extends B { d: 1 } interface E { e: 1 }
enum Color { Red, Green = "green", Blue = 2 }
declare const unique: unique symbol;
declare const other: unique symbol;
interface Runs {
  texts: "a" | "b" | 1 | A;
  string: string | 2 | B;
  numbers: 1 | 2 | 3 | "a";
  number: number | "c";
  patterns: \`a\${string}\` | "x" | A;
  matched: "ab" | "y" | "abc" | B;
  upper: Uppercase<string> | "lower";
  shouted: "UP" | "down" | "lower";
  colors: Color.Red | Color.Green | "z";
  color: Color | A;
  symbols: typeof unique | typeof other | A;
  symbol: symbol | B;
  flags: true | "a";
  flag: false | "b";
  maybe: A | undefined;
  nothing: B | null | undefined;
  empty: void | A;
  objects: A | D | E;
  derived: C | B;
}
declare const runs: Runs;
declare const which: boolean;
declare function show<T>(value: T): { shown: T };
const literals: never = null! as Runs["texts"] | Runs["string"];
const numbers: never = null! as Runs["numbers"] | Runs["number"] | Runs["texts"];
const both: never = null! as Runs["numbers"] | Runs["string"] | Runs["number"];
const patterns: never = null! as Runs["patterns"] | Runs["matched"];
const patternsOfThree: never = null! as Runs["matched"] | Runs["patterns"] | Runs["texts"];
const patternsAgain: never = null! as Runs["matched"] | Runs["patterns"] | Runs["texts"];
const mappings: never = null! as Runs["upper"] | Runs["shouted"];
const noPatterns: never = null! as Runs["patterns"] | Runs["upper"] | Runs["string"];
const colors: never = null! as Runs["colors"] | Runs["color"];
const colorsAndNumbers: never = null! as Runs["colors"] | Runs["number"];
const colorsAndStrings: never = null! as Runs["color"] | Runs["string"];
const symbols: never = null! as Runs["symbols"] | Runs["symbol"];
const twoSymbols: never = null! as Runs["symbols"] | Runs["maybe"];
const flags: never = null! as Runs["flags"] | Runs["flag"];
const maybe: never = null! as Runs["maybe"] | Runs["nothing"];
const empty: never = null! as Runs["empty"] | Runs["nothing"];
const fresh: never = which ? runs.texts : "a";
const freshToo: never = which ? runs.texts : "c";
const freshNumber: never = which ? runs.numbers : 2;
const subtypes: never = which ? runs.objects : runs.derived;
const subtypesOfThree: never = [runs.objects, runs.derived, runs.maybe][0];
const noSubtypes: never = null! as Runs["objects"] | Runs["derived"] | Runs["maybe"];
const voidAndUndefined: never = [runs.empty, runs.nothing, runs.maybe][0];
function constrained<T extends string | number, U extends "a" | "b">(
  one: (T & string) | 1 | A, two: (T & number) | "x" | B, three: (U & "a") | A, four: (U & "b") | B | (T & string),
) {
  const t: 0 = show(which ? one : two);
  const u: 0 = show([three, four, one][0]);
  const all: 0 = show([one, two, three, four][0]);
  const again: 0 = show([one, two, three, four][0]);
  const types: 0 = show(null! as typeof one | typeof two | typeof four);
}
export {};
`,
    errors: `
(30,7): error TS2322: Type 'string | 1 | 2 | A | B' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(31,7): error TS2322: Type 'number | "a" | "b" | "c" | A' is not assignable to type 'never'.
  Type 'number' is not assignable to type 'never'.
(32,7): error TS2322: Type 'string | number | B' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(33,7): error TS2322: Type '"x" | "y" | A | B | \`a\${string}\`' is not assignable to type 'never'.
  Type '"x"' is not assignable to type 'never'.
(34,7): error TS2322: Type '"b" | "x" | "y" | 1 | A | B | \`a\${string}\`' is not assignable to type 'never'.
  Type '"b"' is not assignable to type 'never'.
(35,7): error TS2322: Type '"b" | "x" | "y" | 1 | A | B | \`a\${string}\`' is not assignable to type 'never'.
  Type '"b"' is not assignable to type 'never'.
(36,7): error TS2322: Type '"down" | "lower" | Uppercase<string>' is not assignable to type 'never'.
  Type '"down"' is not assignable to type 'never'.
(37,7): error TS2322: Type 'string | 2 | A | B' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(38,7): error TS2322: Type '"z" | A | Color' is not assignable to type 'never'.
  Type '"z"' is not assignable to type 'never'.
(39,7): error TS2322: Type 'number | "c" | "z" | Color.Green' is not assignable to type 'never'.
  Type 'number' is not assignable to type 'never'.
(40,7): error TS2322: Type 'string | 2 | Color.Red | Color.Blue | A | B' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(41,7): error TS2322: Type 'symbol | A | B' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(42,7): error TS2322: Type 'unique symbol | unique symbol | A | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(43,7): error TS2322: Type '"a" | "b" | boolean' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(44,7): error TS2322: Type 'A | B | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(45,7): error TS2322: Type 'void | A | B | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(46,7): error TS2322: Type '"a" | "b" | 1 | A' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(47,7): error TS2322: Type '"a" | "b" | "c" | 1 | A' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(48,7): error TS2322: Type '"a" | 1 | 2 | 3' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(49,7): error TS2322: Type 'A | B | E' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(50,7): error TS2322: Type 'A | B | E | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(51,7): error TS2322: Type 'A | B | C | D | E | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(52,7): error TS2322: Type 'void | A | B | null' is not assignable to type 'never'.
  Type 'null' is not assignable to type 'never'.
(56,9): error TS2322: Type '{ shown: "x" | 1 | T | A | B; }' is not assignable to type '0'.
(57,9): error TS2322: Type '{ shown: 1 | U | A | B | (T & string); }' is not assignable to type '0'.
(58,9): error TS2322: Type '{ shown: "x" | 1 | T | U | A | B; }' is not assignable to type '0'.
(59,9): error TS2322: Type '{ shown: "x" | 1 | T | U | A | B; }' is not assignable to type '0'.
(60,9): error TS2322: Type '{ shown: "x" | 1 | T | A | B | (U & "b"); }' is not assignable to type '0'.
`,
  },
  // The expected output is TypeScript 7.1's. 7.0 orders them by creation.
  "bigint literals, ordered by value": {
    program: `
interface A { a: 1 } interface B { b: 1 }
interface Runs {
  big: 3n | 1n | "a";
  bigger: 2n | 1n | B;
  biggest: 5n | 4n | 3n | 0n;
  bigint: bigint | A;
  string: string | 2 | B;
}
const big: never = null! as Runs["big"] | Runs["bigger"];
const theOtherWay: never = null! as Runs["bigger"] | Runs["big"] | undefined;
const three: never = null! as Runs["biggest"] | Runs["big"] | Runs["bigger"];
const one: never = null! as Runs["biggest"] | 1n;
const another: never = null! as 6n | Runs["biggest"];
const withoutText: never = null! as Runs["big"] | Runs["bigger"] | Runs["string"];
const noBig: never = null! as Runs["big"] | Runs["bigint"] | Runs["bigger"];
function narrowed(x: Runs["biggest"] | Runs["big"] | Runs["bigger"]) {
  if (x === 1n || x === "a") return;
  const rest: never = x;
  if (x === 4n) x; else x;
  const joined: never = x;
  if (typeof x === "bigint") {
    const numbers: never = x;
  }
}
export {};
`,
    errors: `
(10,7): error TS2322: Type '"a" | 1n | 2n | 3n | B' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(11,7): error TS2322: Type '"a" | 1n | 2n | 3n | B | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(12,7): error TS2322: Type '"a" | 0n | 1n | 2n | 3n | 4n | 5n | B' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(13,7): error TS2322: Type '0n | 1n | 3n | 4n | 5n' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
(14,7): error TS2322: Type '0n | 3n | 4n | 5n | 6n' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
(15,7): error TS2322: Type 'string | 2 | 1n | 2n | 3n | B' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(16,7): error TS2322: Type 'bigint | "a" | A | B' is not assignable to type 'never'.
  Type 'bigint' is not assignable to type 'never'.
(19,9): error TS2322: Type '0n | 2n | 3n | 4n | 5n | B' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
(21,9): error TS2322: Type '0n | 2n | 3n | 4n | 5n | B' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
(23,11): error TS2322: Type '0n | 2n | 3n | 4n | 5n' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
`,
  },
  "the same types again, in another order, with another alias, reduced in another way": {
    program: `
interface A { a: 1 } interface B { b: 1 } interface C extends A { c: 1 } interface D { d: 1 } interface E { e: 1 } interface F { f: 1 }
interface Runs { one: A | D; two: B | E; three: C | F; four: "x" | \`x\${string}\`; }
declare const runs: Runs;
type First = Runs["one"] | Runs["two"] | Runs["three"];
type Second = Runs["one"] | Runs["two"] | Runs["three"];
type Generic<T> = T | Runs["two"] | Runs["three"];
type Other<T> = T | Runs["two"] | Runs["three"];
type Two<T, U> = T | Runs["two"] | Runs["three"];
const once: never = null! as Runs["one"] | Runs["two"] | Runs["three"];
const twice: never = null! as Runs["one"] | Runs["two"] | Runs["three"];
const reversed: never = null! as Runs["three"] | Runs["two"] | Runs["one"];
const rotated: never = null! as Runs["two"] | Runs["three"] | Runs["one"];
const first: never = null! as First;
const second: never = null! as Second;
const generic: never = null! as Generic<Runs["one"]>;
const genericAgain: never = null! as Generic<Runs["one"]>;
const other: never = null! as Other<Runs["one"]>;
const two: never = null! as Two<Runs["one"], 1>;
const twoOfAnother: never = null! as Two<Runs["one"], 2>;
const twoAgain: never = null! as Two<Runs["one"], 1>;
const genericOfAnother: never = null! as Generic<Runs["four"]>;
const genericOfNone: never = null! as Generic<never>;
const reduced: never = [runs.one, runs.two, runs.three][0];
const reducedAgain: never = [runs.one, runs.two, runs.three][0];
const notReduced: never = null! as Runs["one"] | Runs["two"] | Runs["three"];
const longer: never = null! as Runs["one"] | Runs["two"] | Runs["three"] | Runs["four"];
const shorter: never = null! as Runs["one"] | Runs["two"];
const repeated: never = null! as Runs["one"] | Runs["two"] | Runs["one"];
const anything: 0 = null! as Runs["one"] | Runs["two"] | any;
const anythingAgain: 0 = null! as Runs["one"] | Runs["two"] | any;
const unknowable: 0 = null! as Runs["one"] | Runs["two"] | unknown;
const unknowableAgain: 0 = null! as Runs["one"] | Runs["two"] | unknown;
function contextual(value: Runs["one"] | Runs["two"] | Runs["three"]) {}
contextual({ a: 1, c: 2 });
contextual({ a: 1, c: 2 });
export {};
`,
    errors: `
(10,7): error TS2322: Type 'A | B | C | D | E | F' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(11,7): error TS2322: Type 'A | B | C | D | E | F' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(12,7): error TS2322: Type 'A | B | C | D | E | F' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(13,7): error TS2322: Type 'A | B | C | D | E | F' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(14,7): error TS2322: Type 'First' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(15,7): error TS2322: Type 'Second' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(16,7): error TS2322: Type 'Generic<A | D>' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(17,7): error TS2322: Type 'Generic<A | D>' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(18,7): error TS2322: Type 'Other<A | D>' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(19,7): error TS2322: Type 'Two<A | D, 1>' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(20,7): error TS2322: Type 'Two<A | D, 2>' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(21,7): error TS2322: Type 'Two<A | D, 1>' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(22,7): error TS2322: Type 'Generic<\`x\${string}\`>' is not assignable to type 'never'.
  Type 'B' is not assignable to type 'never'.
(23,7): error TS2322: Type 'Generic<never>' is not assignable to type 'never'.
  Type 'B' is not assignable to type 'never'.
(24,7): error TS2322: Type 'A | B | D | E | F' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(25,7): error TS2322: Type 'A | B | D | E | F' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(26,7): error TS2322: Type 'A | B | C | D | E | F' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(27,7): error TS2322: Type 'A | B | C | D | E | F | \`x\${string}\`' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(28,7): error TS2322: Type 'A | B | D | E' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(29,7): error TS2322: Type 'A | B | D | E' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(32,7): error TS2322: Type 'unknown' is not assignable to type '0'.
(33,7): error TS2322: Type 'unknown' is not assignable to type '0'.
(35,20): error TS2322: Type '2' is not assignable to type '1'.
(36,20): error TS2322: Type '2' is not assignable to type '1'.
`,
  },
  "aliases with the same name, ordered by declaration as in TypeScript 7.1": {
    program: `
interface A1 { a1: 1 } interface A2 { a2: 1 } interface K { k: 1 } interface M { m: 1 } interface P { p: 1 }
interface Box<T> { value: T }
// TypeScript 7.0 puts N.X<A1, P> before N.X<A2, K>, that one before O.X, and that one before N.X<A1, P>.
namespace O { export type X = M & A1 }
namespace N { export type X<T, U> = U & T }
namespace I { export interface X { x: 1 } }
namespace B { export type X<T> = Box<T> }
namespace Again { export type X<T, U> = N.X<T, U> }
interface Runs {
  both: N.X<A1, P> | N.X<A2, K>;
  third: O.X | A2;
  all: N.X<A2, K> | O.X | N.X<A1, P>;
  boxes: Box<N.X<A1, P>> | Box<N.X<A2, K>> | Box<A1>;
}
const c1: never = null! as Runs["both"] | Runs["third"];
const c2: never = null! as Runs["third"] | Runs["both"];
const c3: never = null! as A1 | Runs["all"];
const c4: never = null! as N.X<A1, P> | O.X | N.X<A2, K>;
const c5: never = null! as Runs["boxes"] | Box<O.X>;
const c6: never = null! as B.X<1> | I.X | Box<0>;
const c7: never = null! as Again.X<A1, K> | N.X<A2, K> | Again.X<A1, A2> | Runs["third"];
function narrowed(x: Runs["all"] | Box<1>) {
  if ("value" in x) return;
  const withoutBox: never = x;
  if ("m" in x) x; else x;
  const joined: never = x;
}
export {};
`,
    errors: `
(16,7): error TS2322: Type 'A2 | O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(17,7): error TS2322: Type 'A2 | O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(18,7): error TS2322: Type 'A1 | O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(19,7): error TS2322: Type 'O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'X' is not assignable to type 'never'.
(20,7): error TS2322: Type 'Box<A1> | Box<X> | Box<X<A1, P>> | Box<X<A2, K>>' is not assignable to type 'never'.
  Type 'Box<A1>' is not assignable to type 'never'.
(21,7): error TS2322: Type 'Box<0> | I.X | B.X<1>' is not assignable to type 'never'.
  Type 'Box<0>' is not assignable to type 'never'.
(22,7): error TS2322: Type 'A2 | O.X | N.X<A2, K> | Again.X<A1, A2> | Again.X<A1, K>' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(25,9): error TS2322: Type 'O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'X' is not assignable to type 'never'.
(27,9): error TS2322: Type 'O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'X' is not assignable to type 'never'.
`,
  },
  "a union split by narrowing and joined again": {
    program: `
${each(12, i => `interface K${String(i).padStart(2, "0")} { kind: ${i}; group: ${i % 3}; }`, "\n")}
type All = ${each(12, i => `K${String(i).padStart(2, "0")}`)};
interface Holder { all: ${each(12, i => `K${String(11 - i).padStart(2, "0")}`)}; }
declare function use(value: unknown): void;
function whole(x: All, y: Holder["all"]) {
  if (x.kind === 5) use(x); else use(x);
  const joined: never = x;
  if (y.kind === 5) use(y); else use(y);
  const joinedToo: never = y;
}
function parts(x: All) {
  if (x.kind === 0 || x.kind === 11) return;
  const rest: never = x;
  if (x.group === 1) use(x); else use(x);
  const joined: never = x;
  if (x.group === 2) return;
  if (x.kind === 6) use(x); else if (x.kind === 1) use(x); else if (x.group === 0) use(x); else use(x);
  const joinedOfFour: never = x;
}
function some(x: All) {
  if (x.group === 0) {
    if (x.kind === 3) return;
  } else if (x.group === 1) {
    if (x.kind !== 7) return;
  } else {
    if (x.kind === 8) return;
  }
  const joined: never = x;
}
function switched(x: All) {
  switch (x.kind) {
    case 10: use(x); break;
    case 2: return;
    case 4: case 3: use(x); break;
    case 9: throw x;
    default: if (x.group === 1) return;
  }
  const joined: never = x;
}
function looped(x: All, more: () => boolean) {
  if (x.group === 0) return;
  while (more()) {
    if (x.kind === 1) continue;
    if (x.kind === 2) break;
    use(x);
  }
  const joined: never = x;
}
function assigned(x: All, y: Exclude<All, { group: 1 }>, z: K01 | K04, which: boolean) {
  x = y;
  const narrowed: never = x;
  if (which) x = z;
  const joined: never = x;
  const either: never = which ? y : z;
}
function withOthers(x: All | undefined | "text", y: Exclude<All, { group: 2 }> | K02 | null) {
  if (x === undefined || x === "text" || x.group === 2) use(x); else use(x);
  const joined: never = x;
  if (!y) return;
  if (y.group === 2) use(y); else use(y);
  const joinedToo: never = y;
}
export {};
`,
    errors: `
(19,9): error TS2322: Type 'All' is not assignable to type 'never'.
  Type 'K00' is not assignable to type 'never'.
(21,9): error TS2322: Type 'K00 | K01 | K02 | K03 | K04 | K05 | K06 | K07 | K08 | K09 | K10 | K11' is not assignable to type 'never'.
  Type 'K00' is not assignable to type 'never'.
(25,9): error TS2322: Type 'K01 | K02 | K03 | K04 | K05 | K06 | K07 | K08 | K09 | K10' is not assignable to type 'never'.
  Type 'K01' is not assignable to type 'never'.
(27,9): error TS2322: Type 'K01 | K02 | K03 | K04 | K05 | K06 | K07 | K08 | K09 | K10' is not assignable to type 'never'.
  Type 'K01' is not assignable to type 'never'.
(30,9): error TS2322: Type 'K01 | K03 | K04 | K06 | K07 | K09 | K10' is not assignable to type 'never'.
  Type 'K01' is not assignable to type 'never'.
(40,9): error TS2322: Type 'K00 | K02 | K05 | K06 | K07 | K09 | K11' is not assignable to type 'never'.
  Type 'K00' is not assignable to type 'never'.
(50,9): error TS2322: Type 'K00 | K03 | K04 | K05 | K06 | K08 | K10 | K11' is not assignable to type 'never'.
  Type 'K00' is not assignable to type 'never'.
(59,9): error TS2322: Type 'K01 | K02 | K04 | K05 | K07 | K08 | K10 | K11' is not assignable to type 'never'.
  Type 'K01' is not assignable to type 'never'.
(63,9): error TS2322: Type 'K00 | K02 | K03 | K05 | K06 | K08 | K09 | K11' is not assignable to type 'never'.
  Type 'K00' is not assignable to type 'never'.
(65,9): error TS2322: Type 'K00 | K01 | K02 | K03 | K04 | K05 | K06 | K08 | K09 | K11' is not assignable to type 'never'.
  Type 'K00' is not assignable to type 'never'.
(66,9): error TS2322: Type 'K00 | K01 | K02 | K03 | K04 | K05 | K06 | K08 | K09 | K11' is not assignable to type 'never'.
  Type 'K00' is not assignable to type 'never'.
(70,9): error TS2322: Type '"text" | All | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(73,9): error TS2322: Type 'K00 | K01 | K02 | K03 | K04 | K06 | K07 | K09 | K10' is not assignable to type 'never'.
  Type 'K00' is not assignable to type 'never'.
`,
  },
  "types that aren't unions: in order, out of order, more than once, made from the members of a union": {
    program: `
interface A0 { a0: 1 } interface A1 { a1: 1 } interface A2 { a2: 1 } interface A3 { a3: 1 } interface A4 { a4: 1 }
interface A5 { a5: 1 } interface A6 { a6: 1 } interface A7 { a7: 1 } interface A8 { a8: 1 } interface A9 { a9: 1 }
interface Box<T> { value: T }
type All = A0 | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9;
type Boxed<T> = T extends unknown ? Box<T> : never;
type Mirrored<T> =
  T extends A0 ? A9 : T extends A1 ? A8 : T extends A2 ? A7 : T extends A3 ? A6 : T extends A4 ? A5 :
  T extends A5 ? A4 : T extends A6 ? A3 : T extends A7 ? A2 : T extends A8 ? A1 : A0;
type Folded<T> = T extends A0 | A1 | A2 ? A5 : T extends A7 | A8 ? A1 | A6 : T extends A9 ? never : T;
const inOrder: never = null! as A1 | A4 | A7;
const reversed: never = null! as A7 | A4 | A1;
const rotated: never = null! as A4 | A7 | A1;
const twice: never = null! as A4 | A1 | A4 | A1 | A4;
const same: never = null! as A4 | A4 | A4;
const twoRuns: never = null! as A1 | A5 | A9 | A0 | A4 | A8;
const threeRuns: never = null! as A6 | A7 | A2 | A3 | A8 | A0 | A1;
const falling: never = null! as A9 | A8 | A7 | A6 | A5 | A4 | A3 | A2 | A1 | A0;
const kinds: never = null! as A3 | "b" | 2 | undefined | A1 | "a" | null | 1 | true | A2;
const none: never = null! as A2 | never | A1 | never | A3;
const anything: 0 = null! as A2 | A1 | any;
const unknowable: 0 = null! as A2 | unknown | A1;
const boxed: never = null! as Boxed<All>;
const boxedTwice: never = null! as Boxed<Boxed<A2 | A0 | A1>>;
const mirrored: never = null! as Mirrored<All>;
const folded: never = null! as Folded<All>;
const some: never = null! as Mirrored<A1 | A2 | A3> | Boxed<A5 | A4 | A3>;
const literals: never = null! as \`\${"c" | "a" | "b"}-\${2 | 1}\`;
const keys: never = null! as keyof { c: 1; a: 2; b: 3; 1: 4 };
declare const all: All;
const elements: never = [null! as A3, null! as A1, null! as A2][0];
export {};
`,
    errors: `
(11,7): error TS2322: Type 'A1 | A4 | A7' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(12,7): error TS2322: Type 'A1 | A4 | A7' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(13,7): error TS2322: Type 'A1 | A4 | A7' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(14,7): error TS2322: Type 'A1 | A4' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(15,7): error TS2322: Type 'A4' is not assignable to type 'never'.
(16,7): error TS2322: Type 'A0 | A1 | A4 | A5 | A8 | A9' is not assignable to type 'never'.
  Type 'A0' is not assignable to type 'never'.
(17,7): error TS2322: Type 'A0 | A1 | A2 | A3 | A6 | A7 | A8' is not assignable to type 'never'.
  Type 'A0' is not assignable to type 'never'.
(18,7): error TS2322: Type 'A0 | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9' is not assignable to type 'never'.
  Type 'A0' is not assignable to type 'never'.
(19,7): error TS2322: Type '"a" | "b" | 1 | 2 | true | A1 | A2 | A3 | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(20,7): error TS2322: Type 'A1 | A2 | A3' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(22,7): error TS2322: Type 'unknown' is not assignable to type '0'.
(23,7): error TS2322: Type 'Box<A0> | Box<A1> | Box<A2> | Box<A3> | Box<A4> | Box<A5> | Box<A6> | Box<A7> | Box<A8> | Box<A9>' is not assignable to type 'never'.
  Type 'Box<A0>' is not assignable to type 'never'.
(24,7): error TS2322: Type 'Box<Box<A0>> | Box<Box<A1>> | Box<Box<A2>>' is not assignable to type 'never'.
  Type 'Box<Box<A0>>' is not assignable to type 'never'.
(25,7): error TS2322: Type 'A0 | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9' is not assignable to type 'never'.
  Type 'A0' is not assignable to type 'never'.
(26,7): error TS2322: Type 'A1 | A3 | A4 | A5 | A6' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(27,7): error TS2322: Type 'A6 | A7 | A8 | Box<A3> | Box<A4> | Box<A5>' is not assignable to type 'never'.
  Type 'A6' is not assignable to type 'never'.
(28,7): error TS2322: Type '"a-1" | "a-2" | "b-1" | "b-2" | "c-1" | "c-2"' is not assignable to type 'never'.
  Type '"a-1"' is not assignable to type 'never'.
(29,7): error TS2322: Type '"a" | "b" | "c" | 1' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(31,7): error TS2322: Type 'A1 | A2 | A3' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
`,
  },
  "control flow paths that join with parts of the initial type, and with types introduced by a test": {
    program: `
class Base { base = 1 } class Left extends Base { left = 1 } class Right extends Base { right = 1 } class Other { other = 1 }
interface A { k: "a" } interface B { k: "b" } interface C { k: "c" } interface D { k: "d" }
declare function use(value: unknown): void;
declare function isLeft(value: unknown): value is Left;
declare const which: boolean;
function parts(x: A | B | C | D) {
  if (x.k === "a") use(x); else if (x.k === "c") use(x); else return;
  const joined: never = x;
}
function introduced(x: Base | Other | undefined) {
  if (x instanceof Left) use(x); else if (x instanceof Other) use(x); else return;
  const narrower: never = x;
  if (isLeft(x)) use(x); else use(x);
  const joined: never = x;
}
function subtypes(x: Base | Other) {
  if (x instanceof Right) use(x); else use(x);
  const joined: never = x;
  if (x instanceof Right || x instanceof Left) {
    const either: never = x;
  }
}
function unassigned() {
  let x: A | B | C;
  if (which) x = null! as A;
  const maybe: never = x;
  let y: A | B | undefined;
  if (which) y = null! as B;
  const maybeToo: never = y;
}
function assigned(x: A | B | C | D) {
  x = null! as C | A;
  if (which) x = null! as D;
  const joined: never = x;
  while (which) {
    if (x.k === "d") x = null! as B;
    else if (x.k === "a") continue;
  }
  const looped: never = x;
}
function generic<T extends A | B, U>(x: T | C | undefined, y: U | A | null) {
  if (x === undefined) return;
  if (x.k === "c") use(x); else use(x);
  const joined: 0 = x;
  if (y) use(y); else use(y);
  const joinedToo: 0 = y;
}
function wide(x: unknown, y: {} | null | undefined) {
  if (typeof x === "string") use(x); else if (typeof x === "number") use(x); else if (!x) use(x); else return;
  const joined: never = x;
  if (y === null) use(y); else if (y === undefined) use(y); else use(y);
  const joinedToo: never = y;
}
export {};
`,
    errors: `
(9,9): error TS2322: Type 'A | C' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(13,9): error TS2322: Type 'Left | Other' is not assignable to type 'never'.
  Type 'Left' is not assignable to type 'never'.
(15,9): error TS2322: Type 'Left | Other' is not assignable to type 'never'.
  Type 'Left' is not assignable to type 'never'.
(19,9): error TS2322: Type 'Base | Other' is not assignable to type 'never'.
  Type 'Base' is not assignable to type 'never'.
(21,11): error TS2322: Type 'Left | Right' is not assignable to type 'never'.
  Type 'Left' is not assignable to type 'never'.
(27,9): error TS2322: Type 'A | B | C' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(27,24): error TS2454: Variable 'x' is used before being assigned.
(30,9): error TS2322: Type 'A | B | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(35,9): error TS2322: Type 'A | C | D' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(40,9): error TS2322: Type 'A | B | C | D' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(45,9): error TS2322: Type 'A | B | C' is not assignable to type '0'.
  Type 'A' is not assignable to type '0'.
(47,9): error TS2322: Type 'U | A | null' is not assignable to type '0'.
  Type 'null' is not assignable to type '0'.
(51,9): error TS2322: Type 'unknown' is not assignable to type 'never'.
(53,9): error TS2322: Type '{} | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
`,
  },
  "a repeated test for truthiness, null, undefined or typeof on the same type": {
    program: `
interface A { a: 1 } interface B { b: 1 }
type Fn = () => void;
type Mixed = A | Fn | "" | "x" | 0 | 1 | 0n | 1n | false | true | null | undefined | symbol;
declare function use(value: unknown): void;
function truthy(x: Mixed, y: Mixed) {
  if (x) { const yes: never = x; } else { const no: never = x; }
  if (y) { const yes: never = y; } else { const no: never = y; }
  if (!x) return;
  const left: never = x;
  if (x) { const again: never = x; }
}
function nullish(x: Mixed, y: Mixed) {
  if (x == null) { const yes: never = x; } else { const no: never = x; }
  if (y != null) { const yes: never = y; } else { const no: never = y; }
  if (x === undefined) { const yes: never = x; } else { const no: never = x; }
  if (y !== undefined) { const yes: never = y; } else { const no: never = y; }
  if (x === null) { const yes: never = x; } else { const no: never = x; }
  const present: never = x ?? y;
  const asserted: never = x!;
  const assertedAgain: never = y!;
}
function kinds(x: Mixed, y: Mixed) {
  if (typeof x !== "object") { const yes: never = x; } else { const no: never = x; }
  if (typeof y !== "object") { const yes: never = y; }
  if (typeof x !== "function") { const yes: never = x; }
  if (typeof x !== "string" && typeof x !== "number") { const yes: never = x; }
  if (typeof y !== "string" && typeof y !== "number") { const yes: never = y; }
  if (typeof x !== "undefined") { const yes: never = x; }
}
function generic<T, U extends A | null, V extends string | undefined>(t: T, u: U, v: V, w: T | U | undefined) {
  if (t) { const yes: 0 = t; } else { const no: 0 = t; }
  if (t) { const again: 0 = t; }
  if (u) { const yes: 0 = u; } else { const no: 0 = u; }
  if (u != null) { const yes: 0 = u; }
  if (v) { const yes: 0 = v; } else { const no: 0 = v; }
  if (w) { const yes: 0 = w; } else { const no: 0 = w; }
  if (w !== undefined) { const yes: 0 = w; }
  if (w !== undefined) { const again: 0 = w; }
  const asserted: 0 = w!;
}
function wide(x: unknown, y: {}, z: object | null, e: {} | null | undefined) {
  if (x) { const yes: never = x; } else { const no: never = x; }
  if (x) { const again: never = x; }
  if (x != null) { const yes: never = x; } else { const no: never = x; }
  if (x !== undefined) { const yes: never = x; } else { const no: never = x; }
  if (y) { const yes: never = y; } else { const no: never = y; }
  if (z) { const yes: never = z; } else { const no: never = z; }
  if (e) { const yes: never = e; } else { const no: never = e; }
  if (e) { const again: never = e; }
}
function properties(o: { p?: A | null; q: A | B | undefined } | { p: B; q: null }) {
  if (o.p) { const yes: never = o.p; const whole: never = o; }
  if (o.p) { const again: never = o.p; }
  if (o.q) { const yes: never = o.q; const whole: never = o; } else { const no: never = o.q; const whole: never = o; }
  const chained: never = o.p?.toString;
}
function circular<T extends T | undefined, U extends V | null, V extends U>(t: T, u: U) {
  if (t) { const yes: 0 = t; }
  if (t) { const again: 0 = t; }
  if (u) { const yes: 0 = u; }
  if (u) { const again: 0 = u; }
}
export {};
`,
    errors: `
(7,18): error TS2322: Type 'symbol | "x" | 1 | 1n | true | A | Fn' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(7,49): error TS2322: Type '"" | 0 | 0n | false | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(8,18): error TS2322: Type 'symbol | "x" | 1 | 1n | true | A | Fn' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(8,49): error TS2322: Type '"" | 0 | 0n | false | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(10,9): error TS2322: Type 'symbol | "x" | 1 | 1n | true | A | Fn' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(11,18): error TS2322: Type 'symbol | "x" | 1 | 1n | true | A | Fn' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(14,26): error TS2322: Type 'null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(14,57): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | Fn' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(15,26): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | Fn' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(15,57): error TS2322: Type 'null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(16,32): error TS2322: Type 'undefined' is not assignable to type 'never'.
(16,63): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | Fn | null' is not assignable to type 'never'.
  Type 'null' is not assignable to type 'never'.
(17,32): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | Fn | null' is not assignable to type 'never'.
  Type 'null' is not assignable to type 'never'.
(17,63): error TS2322: Type 'undefined' is not assignable to type 'never'.
(18,27): error TS2322: Type 'null' is not assignable to type 'never'.
(18,58): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | Fn | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(19,9): error TS2322: Type 'Mixed' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(20,9): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | Fn' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(21,9): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | Fn' is not assignable to type 'never'.
  Type 'symbol' is not assignable to type 'never'.
(24,38): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | Fn | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(24,69): error TS2322: Type 'A | null' is not assignable to type 'never'.
  Type 'null' is not assignable to type 'never'.
(25,38): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | Fn | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(26,40): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(27,63): error TS2322: Type 'symbol | 0n | 1n | boolean | A | Fn | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(28,63): error TS2322: Type 'symbol | 0n | 1n | boolean | A | Fn | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(29,41): error TS2322: Type 'symbol | "" | "x" | 0 | 1 | 0n | 1n | boolean | A | Fn | null' is not assignable to type 'never'.
  Type 'null' is not assignable to type 'never'.
(32,18): error TS2322: Type 'NonNullable<T>' is not assignable to type '0'.
(32,45): error TS2322: Type 'T' is not assignable to type '0'.
(33,18): error TS2322: Type 'NonNullable<T>' is not assignable to type '0'.
(34,18): error TS2322: Type 'A' is not assignable to type '0'.
(34,45): error TS2322: Type 'null' is not assignable to type '0'.
(35,26): error TS2322: Type 'A' is not assignable to type '0'.
(36,18): error TS2322: Type 'string' is not assignable to type '0'.
(36,45): error TS2322: Type 'string | undefined' is not assignable to type '0'.
  Type 'undefined' is not assignable to type '0'.
(37,18): error TS2322: Type 'A | NonNullable<T>' is not assignable to type '0'.
  Type 'A' is not assignable to type '0'.
(37,45): error TS2322: Type 'T | null | undefined' is not assignable to type '0'.
  Type 'undefined' is not assignable to type '0'.
(38,32): error TS2322: Type 'A | (T & {}) | null' is not assignable to type '0'.
  Type 'null' is not assignable to type '0'.
(39,32): error TS2322: Type 'A | (T & {}) | null' is not assignable to type '0'.
  Type 'null' is not assignable to type '0'.
(40,9): error TS2322: Type 'A | NonNullable<T>' is not assignable to type '0'.
  Type 'A' is not assignable to type '0'.
(43,18): error TS2322: Type '{}' is not assignable to type 'never'.
(43,49): error TS2322: Type 'unknown' is not assignable to type 'never'.
(44,18): error TS2322: Type '{}' is not assignable to type 'never'.
(45,26): error TS2322: Type '{}' is not assignable to type 'never'.
(45,57): error TS2322: Type 'null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(46,32): error TS2322: Type '{} | null' is not assignable to type 'never'.
  Type 'null' is not assignable to type 'never'.
(46,63): error TS2322: Type 'undefined' is not assignable to type 'never'.
(47,18): error TS2322: Type '{}' is not assignable to type 'never'.
(47,49): error TS2322: Type '{}' is not assignable to type 'never'.
(48,18): error TS2322: Type 'object' is not assignable to type 'never'.
(48,49): error TS2322: Type 'null' is not assignable to type 'never'.
(49,18): error TS2322: Type '{}' is not assignable to type 'never'.
(49,49): error TS2322: Type '{} | null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(50,18): error TS2322: Type '{}' is not assignable to type 'never'.
(53,20): error TS2322: Type 'A | B' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(53,44): error TS2322: Type '{ p?: A | null | undefined; q: A | B | undefined; } | { p: B; q: null; }' is not assignable to type 'never'.
  Type '{ p?: A | null | undefined; q: A | B | undefined; }' is not assignable to type 'never'.
(54,20): error TS2322: Type 'A | B' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(55,20): error TS2322: Type 'A | B' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(55,44): error TS2322: Type '{ p?: A | null | undefined; q: A | B | undefined; }' is not assignable to type 'never'.
(55,77): error TS2322: Type 'null | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(55,100): error TS2322: Type '{ p?: A | null | undefined; q: A | B | undefined; } | { p: B; q: null; }' is not assignable to type 'never'.
  Type '{ p?: A | null | undefined; q: A | B | undefined; }' is not assignable to type 'never'.
(56,9): error TS2322: Type '(() => string) | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(58,29): error TS2313: Type parameter 'T' has a circular constraint.
(58,54): error TS2313: Type parameter 'U' has a circular constraint.
(58,74): error TS2313: Type parameter 'V' has a circular constraint.
(59,18): error TS2322: Type 'NonNullable<T>' is not assignable to type '0'.
(60,18): error TS2322: Type 'NonNullable<T>' is not assignable to type '0'.
(61,18): error TS2322: Type 'NonNullable<U>' is not assignable to type '0'.
(62,18): error TS2322: Type 'NonNullable<U>' is not assignable to type '0'.
`,
  },
};

const untruncated = JSON.stringify({
  compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, noErrorTruncation: true },
});

test.concurrent.each(Object.keys(orders))("orders union members like tsc: %s", async title => {
  const { program, errors } = orders[title];
  using dir = tempDir("bun-check-union", { "tsconfig.json": untruncated, "a.ts": program });
  const lines = await linesOf([bunExe(), "check"], String(dir), String(dir));
  expect(lines.map(line => line.replace(/^a\.ts/, ""))).toEqual(errors.trim().split("\n"));
});

const named = (i: number) => `T${String(i).padStart(5, "0")}`;

/**
 * Combines a union of `size` types with one more type, which sorts before, among or after them, and with other unions.
 */
function unionsOf(size: number) {
  const middle = size - (size % 2);
  const union = (count: number, index: (i: number) => number) => each(count, i => named(index(i)));
  const lists = [
    `Runs["odd"] | ${named(0)}`,
    `${named(0)} | Runs["odd"]`,
    `Runs["odd"] | ${named(middle)}`,
    `${named(middle)} | Runs["odd"]`,
    `Runs["odd"] | ${named(2 * size)}`,
    `${named(2 * size)} | Runs["odd"]`,
    `Runs["odd"] | ${named(middle + 1)}`,
    `${named(2 * size)} | Runs["odd"] | ${named(0)}`,
    `${named(middle)} | ${named(0)} | Runs["odd"] | ${named(2 * size)} | undefined`,
    `Runs["odd"] | Runs["even"]`,
    `Runs["upper"] | Runs["lower"]`,
    `Runs["lower"] | Runs["odd"]`,
    `Runs["few"] | Runs["odd"]`,
    `Runs["even"] | Runs["few"] | Runs["upper"]`,
    `Runs["even"] | Runs["few"] | Runs["upper"]`,
    `Runs["lower"] | Runs["even"] | Runs["odd"] | Runs["upper"] | Runs["few"]`,
  ];
  return `
${each(2 * size + 1, i => `interface ${named(i)} { p${i}: 1 }`, "\n")}
interface Runs {
  odd: ${union(size, i => 2 * i + 1)};
  even: ${union(size + 1, i => 2 * i)};
  lower: ${union(size, i => i)};
  upper: ${union(size + 1, i => 2 * size - i)};
  few: ${union(Math.ceil(size / 8), i => 16 * i)} | ${named(2 * size)};
}
${lists.map((list, i) => `const c${i}: never = null! as ${list};`).join("\n")}
export {};
`;
}

/** Narrows a union of `size` types and joins the parts again. */
function narrowingOf(size: number) {
  const [first, middle, last] = [0, size >> 1, size - 1];
  return `
${each(size, i => `interface ${named(i)} { kind: ${i}; group: ${i % 3}; pair: ${i < 2}; }`, "\n")}
type All = ${each(size, named)};
declare function use(value: unknown): void;
export function whole(x: All) {
  if (x.kind === ${middle}) use(x); else use(x);
  const joined: never = x;
}
export function rest(x: All) {
  if (x.kind === ${first}) return;
  const narrowed: never = x;
  if (x.kind === ${last}) use(x); else use(x);
  const joined: never = x;
  if (x.group === 1) use(x); else if (x.group === 2) use(x); else use(x);
  const joinedOfThree: never = x;
}
export function few(x: All) {
  if (x.kind !== ${first} && x.kind !== ${middle} && x.kind !== ${last}) return;
  const narrowed: never = x;
  if (x.kind === ${middle}) use(x); else use(x);
  const joined: never = x;
}
export function pair(x: All, other: ${named(last)}, which: boolean) {
  if (!x.pair) return;
  const narrowed: never = x;
  const either: never = which ? x : other;
  const eitherWay: never = which ? other : x;
}
export function groups(x: All, which: boolean) {
  if (x.group === 0) {
    if (which) return;
  } else if (x.group === 1) {
    if (x.kind === ${middle}) return;
  }
  const joined: never = x;
}
export function switched(x: All) {
  switch (x.kind) {
    case ${last}: use(x); break;
    case ${middle}: return;
    case ${first}: use(x); break;
    default: if (x.group === 2) return;
  }
  const joined: never = x;
}
`;
}

/**
 * Maps each member of a union of `size` types to another type: in the members' order, in reverse order, or to fewer
 * types.
 */
function mappingOf(size: number) {
  return `
${each(size, i => `interface ${named(i)} { at: ${i}; }`, "\n")}
${each(size, i => `interface S${named(i)} extends ${named(i)} { more: 1; }`, "\n")}
interface Box<T> { value: T }
interface Mirror { ${each(size, i => `${i}: ${named(size - 1 - i)}`, "; ")} }
type All = ${each(size, named)};
type Boxed<T> = T extends unknown ? Box<T> : never;
type Mirrored<T> = T extends { at: infer At extends keyof Mirror } ? Mirror[At] : never;
type Halved<T> = T extends { at: infer At extends keyof Mirror } ? Mirror[At] | T : never;
declare const which: boolean;
declare const even: ${each(Math.ceil(size / 2), i => named(2 * i))};
declare const narrower: ${each(size, i => `S${named(i)}`)};
const boxed: never = null! as Boxed<All>;
const mirrored: never = null! as Mirrored<All>;
const halved: never = null! as Halved<typeof even>;
const written: never = null! as ${each(size, i => named((i * 7) % size))};
const reduced: never = which ? even : narrower;
const reducedToo: never = [narrower, even, null! as ${named(size - 1)}][0];
export {};
`;
}

/**
 * `size` types in no particular order: alone, next to a union, next to a union of the same length, and as `size`
 * unions.
 */
function unorderedOf(size: number) {
  const shuffled = (i: number) => (i * 7919 + 13) % 10007;
  const literals = (from: number) => each(size, i => `"s${shuffled(from + i)}"`);
  const interfaces = each(size, i => named(shuffled(i) % (3 * size)));
  // The same except for the middle one.
  const almost = each(size, i => `"s${shuffled(i === size >> 1 ? size : i)}"`);
  const lists = [
    `Runs["two"] | ${literals(0)}`,
    `${literals(0)} | Runs["two"]`,
    literals(0),
    almost,
    literals(0),
    almost,
    `Runs["long"] | ${literals(size >> 1)}`,
    `Runs["pair"] | ${interfaces}`,
    interfaces,
    `${interfaces} | Runs["two"] | ${literals(0)} | Runs["pair"]`,
    each(size, i => `Runs["r${i}"]`),
    `${each(size, i => `Runs["r${size - 1 - i}"]`)} | ${named(3 * size)}`,
  ];
  return `
${each(3 * size + 1, i => `interface ${named(i)} { p${i}: 1 }`, "\n")}
interface Runs {
  two: "zz0" | "s${shuffled(1)}";
  long: ${literals(0)};
  pair: ${named(1)} | ${named(3 * size)};
  ${each(size, i => `r${i}: ${named(i)} | ${named(i + size)} | ${named(i + 2 * size)}`, ";\n  ")};
}
${lists.map((list, i) => `const c${i}: never = null! as ${list};`).join("\n")}
export {};
`;
}

/** Unions that one file declares and other files combine. */
const shared = {
  "shared.ts": `
${each(24, i => `export interface ${named(i)} { kind: ${i}; group: ${i % 3}; }`, "\n")}
export type All = ${each(24, named)};
export type Odd = ${each(12, i => named(2 * i + 1))};
export interface Runs {
  odd: ${each(12, i => named(2 * i + 1))};
  even: ${each(12, i => named(2 * i))};
  lower: ${each(12, named)};
  thirds: ${each(8, i => named(3 * i))};
}
export type Rest<T> = Exclude<All, T>;
`,
  ...Object.fromEntries(
    [0, 1, 2, 3].map(file => [
      `user${file}.ts`,
      `
import type { All, Odd, Rest, Runs, ${named(file)} } from "./shared";
const both: never = null! as Runs["odd"] | Runs["even"];
const three: never = null! as Runs["thirds"] | Runs["lower"] | Runs["odd"];
const own: never = null! as Runs["${["odd", "even", "lower", "thirds"][file]}"] | ${named(file)} | Runs["thirds"];
const named: never = null! as Odd | Runs["thirds"];
const rest: never = null! as Rest<{ group: ${file % 3} }> | ${named(file)};
export function narrowed(x: All, y: Rest<${named(file)}>) {
  if (x.group === ${file % 3}) return;
  if (x.kind === ${file + 4}) x; else x;
  const joined: never = x;
  if (y.group === ${(file + 1) % 3}) y; else y;
  const joinedToo: never = y;
}
`,
    ]),
  ),
};

/** Groups the lines by file. An error's elaboration lines follow it, indented. */
function byFile(lines: string[]) {
  const found: Record<string, string[]> = {};
  let file = "";
  for (const line of lines) {
    file = /^(\w+\.ts)\(/.exec(line)?.[1] ?? file;
    (found[file] ??= []).push(line);
  }
  return found;
}

// Next to a union at least 8 times as long, types are inserted one by one by searching for their position. Otherwise
// the two are merged. Positions are looked up in a union with up to 16 times as many members as the two types have
// together, which is 48 for a union of two and one more type.
test.concurrent.skipIf(!tsc)("matches tsc on unions of 2 to 5,000 members", async () => {
  const sizes = [2, 3, 7, 8, 9, 48, 49, 100, isDebug || isASAN ? 500 : 5000];
  using dir = tempDir("bun-check-union", {
    "tsconfig.json": untruncated,
    ...Object.fromEntries(sizes.map(size => [`unions${size}.ts`, unionsOf(size)])),
    ...Object.fromEntries(sizes.map(size => [`narrowing${size}.ts`, narrowingOf(size)])),
  });
  const root = String(dir);
  const [theirs, ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    linesOf([bunExe(), "check"], root, root),
  ]);
  expect(Object.keys(byFile(theirs)).length).toBe(2 * sizes.length);
  expect(byFile(ours)).toEqual(byFile(theirs));
});

test.concurrent.skipIf(!tsc)("matches tsc on types mapped from each member of a union of 2 to 300", async () => {
  const sizes = [2, 3, 8, 9, 100, 300];
  using dir = tempDir("bun-check-union", {
    "tsconfig.json": untruncated,
    ...Object.fromEntries(sizes.map(size => [`mapping${size}.ts`, mappingOf(size)])),
  });
  const root = String(dir);
  const [theirs, ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    linesOf([bunExe(), "check"], root, root),
  ]);
  expect(Object.keys(byFile(theirs)).length).toBe(sizes.length);
  expect(byFile(ours)).toEqual(byFile(theirs));
});

// Up to 8 unions are merged, and more are sorted as one list. For a list of more than 32 types, only the first and last
// 16 are hashed for the cache lookup.
test.concurrent.skipIf(!tsc)("matches tsc on 3 to 300 unordered types, alone and next to unions", async () => {
  const sizes = [3, 7, 8, 9, 10, 32, 33, 300];
  using dir = tempDir("bun-check-union", {
    "tsconfig.json": untruncated,
    ...Object.fromEntries(sizes.map(size => [`unordered${size}.ts`, unorderedOf(size)])),
  });
  const root = String(dir);
  const [theirs, ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    linesOf([bunExe(), "check"], root, root),
  ]);
  expect(Object.keys(byFile(theirs)).length).toBe(sizes.length);
  expect(byFile(ours)).toEqual(byFile(theirs));
});

test.concurrent.skipIf(!tsc)("matches tsc on another file's unions on any thread count", async () => {
  using dir = tempDir("bun-check-union", { "tsconfig.json": untruncated, ...shared });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 3, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  expect(Object.keys(byFile(theirs))).toEqual(["user0.ts", "user1.ts", "user2.ts", "user3.ts"]);
  for (const lines of ours) expect(byFile(lines)).toEqual(byFile(theirs));
});

// An intersection's members are a list with a copy of every property of every constituent. If the constituents have 32
// or more properties, and share the names of at most half of them, a lookup by name doesn't build that list, until
// something enumerates the properties or there have been a quarter as many lookups as names. A union looks a name up in
// each member that way, unless all its properties are requested. And a mapped type's property gets the mapper with its
// key only when its type is requested. So each program here is checked with sizes on both sides of those numbers, on 1
// and on 8 threads, by name before and after the enumeration, and none of that may change what's reported.

/** `count` optional properties that no other type has. */
const filler = (count: number, prefix = "f") => each(count, i => `${prefix}${i}?: ${i};`, " ");
/** One line per value. Assigning to `never` makes the messages print their types. */
const reads = (prefix: string, values: string[]) =>
  values.map((value, i) => `const ${prefix}${i}: never = ${value};`).join("\n");
/** `owner.name`, `owner[0]`, `owner()` */
const accesses = (owner: string, names: string[]) => names.map(name => `${owner}${/^\w/.test(name) ? "." : ""}${name}`);

// `errors`: what TypeScript 7.0.2 reports for `program(count)`, for every `count` in `sizes`, without the file name.
const members: Record<string, { sizes: number[]; program: (count: number) => string; errors: string }> = {
  "names that one, two or all of the constituents have": {
    // The constituents have 21 properties besides the filler.
    sizes: [1, 10, 11, 200],
    program: count => {
      const names = ["a", "b", "same", "both", "opt", "req", "ro", "rw", "fixed", "m", "p", "toString"];
      const byName = (v: string) => `
${reads(v, accesses(v, names))}
${v}.ro = 1;
${v}.rw = 1;
${v}.fixed = 1;
${v}.none;
${each(Math.min(count, (count + 21) / 4 + 1), i => `${v}.f${i};`, " ")}
${v}.another;`;
      const listed = (v: string, alias: string) => `
const ${v}_keys: never = null! as Exclude<keyof ${alias}, \`f\${number}\`>;
const ${v}_spread: never = { ...${v} }.opt;
const { a: ${v}_a, ...${v}_rest } = ${v};
const ${v}_left: never = ${v}_rest.opt;
const ${v}_mapped: never = (null! as { [K in keyof ${alias}]-?: ${alias}[K] }).req;
const ${v}_excess: ${alias} = { a: 1, b: 2, same: "", both: null!, opt: 2, req: 2, ro: 1, rw: 1, fixed: 1, m: null!, p: null!, extra: 1 };
const ${v}_lacks: ${alias} = { a: 1 };`;
      return `
interface A { a: 1; same: string; both: string; opt?: 1 | 2; req: 1 | 2; readonly ro: 1; rw: 1; readonly fixed: 1; m(): 1; p: () => 2; ${filler(count)} }
interface B { b: 2; same: string; both: number; opt: 2 | 3; req?: 2 | 3; ro: 1; readonly rw: 1; readonly fixed: 1; m: () => "x"; p(): "y" }
type N = A & B & { n?: 1 };
type L = A & B & { l?: 1 };
declare const n: N;
declare const l: L;
${byName("n")}
${listed("n", "N")}
${listed("l", "L")}
${byName("l")}
export {};
`;
    },
    errors: `
(9,7): error TS2322: Type '1' is not assignable to type 'never'.
(10,7): error TS2322: Type '2' is not assignable to type 'never'.
(11,7): error TS2322: Type 'string' is not assignable to type 'never'.
(13,7): error TS2322: Type '2' is not assignable to type 'never'.
(14,7): error TS2322: Type '2' is not assignable to type 'never'.
(15,7): error TS2322: Type '1' is not assignable to type 'never'.
(16,7): error TS2322: Type '1' is not assignable to type 'never'.
(17,7): error TS2322: Type '1' is not assignable to type 'never'.
(18,7): error TS2322: Type '(() => 1) & (() => "x")' is not assignable to type 'never'.
(19,7): error TS2322: Type '(() => 2) & (() => "y")' is not assignable to type 'never'.
(20,7): error TS2322: Type '() => string' is not assignable to type 'never'.
(23,3): error TS2540: Cannot assign to 'fixed' because it is a read-only property.
(24,3): error TS2339: Property 'none' does not exist on type 'N'.
(26,3): error TS2339: Property 'another' does not exist on type 'N'.
(28,7): error TS2322: Type '"a" | "b" | "both" | "fixed" | "m" | "n" | "opt" | "p" | "req" | "ro" | "rw" | "same"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(29,7): error TS2322: Type '2' is not assignable to type 'never'.
(31,7): error TS2322: Type '2' is not assignable to type 'never'.
(32,7): error TS2322: Type '2' is not assignable to type 'never'.
(33,118): error TS2353: Object literal may only specify known properties, and 'extra' does not exist in type 'N'.
(34,7): error TS2322: Type '{ a: 1; }' is not assignable to type 'N'.
  Type '{ a: 1; }' is missing the following properties from type 'A': same, both, req, ro, and 4 more.
(36,7): error TS2322: Type '"a" | "b" | "both" | "fixed" | "l" | "m" | "opt" | "p" | "req" | "ro" | "rw" | "same"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(37,7): error TS2322: Type '2' is not assignable to type 'never'.
(39,7): error TS2322: Type '2' is not assignable to type 'never'.
(40,7): error TS2322: Type '2' is not assignable to type 'never'.
(41,118): error TS2353: Object literal may only specify known properties, and 'extra' does not exist in type 'L'.
(42,7): error TS2322: Type '{ a: 1; }' is not assignable to type 'L'.
  Type '{ a: 1; }' is missing the following properties from type 'A': same, both, req, ro, and 4 more.
(44,7): error TS2322: Type '1' is not assignable to type 'never'.
(45,7): error TS2322: Type '2' is not assignable to type 'never'.
(46,7): error TS2322: Type 'string' is not assignable to type 'never'.
(48,7): error TS2322: Type '2' is not assignable to type 'never'.
(49,7): error TS2322: Type '2' is not assignable to type 'never'.
(50,7): error TS2322: Type '1' is not assignable to type 'never'.
(51,7): error TS2322: Type '1' is not assignable to type 'never'.
(52,7): error TS2322: Type '1' is not assignable to type 'never'.
(53,7): error TS2322: Type '(() => 1) & (() => "x")' is not assignable to type 'never'.
(54,7): error TS2322: Type '(() => 2) & (() => "y")' is not assignable to type 'never'.
(55,7): error TS2322: Type '() => string' is not assignable to type 'never'.
(58,3): error TS2540: Cannot assign to 'fixed' because it is a read-only property.
(59,3): error TS2339: Property 'none' does not exist on type 'L'.
(61,3): error TS2339: Property 'another' does not exist on type 'L'.
`,
  },
  "private and protected members, and accessors": {
    sizes: [1, 8, 9, 10, 100],
    program: count => `
class C { private x = 1; protected y = 2; z = 3; #hard = 1; get acc() { return 1; } set acc(v: number) {} get only() { return 1; } ${filler(count)} }
class E extends C { e = 1; protected override y = 2; }
class D { private x = 1; w = 1; }
type N = C & E & { n?: 1 };
type Conflict = C & D;
declare const n: N;
${reads("n", accesses("n", ["x", "z", "e", "acc", "only"]))}
n.acc = 1;
n.only = 1;
n.none;
const keys: never = null! as Exclude<keyof N, \`f\${number}\`>;
(null! as Conflict).w;
const conflict: Conflict = 1;
class F extends C { read(i: C & F & { n?: 1 }, j: C & { n?: 1 }) { const y: never = i.y; j.y; i.x; } }
export {};
`,
    errors: `
(8,7): error TS2322: Type 'number' is not assignable to type 'never'.
(8,21): error TS2341: Property 'x' is private and only accessible within class 'C'.
(9,7): error TS2322: Type 'number' is not assignable to type 'never'.
(10,7): error TS2322: Type 'number' is not assignable to type 'never'.
(11,7): error TS2322: Type 'number' is not assignable to type 'never'.
(12,7): error TS2322: Type 'number' is not assignable to type 'never'.
(14,3): error TS2540: Cannot assign to 'only' because it is a read-only property.
(15,3): error TS2339: Property 'none' does not exist on type 'N'.
(16,7): error TS2322: Type '"acc" | "e" | "n" | "only" | "z"' is not assignable to type 'never'.
  Type '"acc"' is not assignable to type 'never'.
(17,21): error TS2339: Property 'w' does not exist on type 'never'.
  The intersection 'Conflict' was reduced to 'never' because property 'x' exists in multiple constituents and is private in some.
(18,7): error TS2322: Type 'number' is not assignable to type 'never'.
  The intersection 'Conflict' was reduced to 'never' because property 'x' exists in multiple constituents and is private in some.
(19,74): error TS2322: Type 'number' is not assignable to type 'never'.
(19,92): error TS2446: Property 'y' is protected and only accessible through an instance of class 'F'. This is an instance of class 'C & { n?: 1 | undefined; }'.
(19,97): error TS2341: Property 'x' is private and only accessible within class 'C'.
`,
  },
  "constituents that aren't object types, or have more than properties": {
    sizes: [1, 30, 31, 100],
    program: count => `
interface A { a: 1; ${filler(count)} }
namespace Space { export const value = 1; export type Only = 1; }
declare const branded: string & { brand: 1 };
declare const indexed: A & { [key: string]: unknown };
declare const callable: A & ((x: number) => string);
declare const newable: A & (new () => A);
declare const items: string[] & A;
declare const pair: [1, 2] & A;
declare const space: typeof Space & A;
${reads("branded", accesses("branded", ["brand", "length", "none"]))}
${reads("indexed", accesses("indexed", ["a", "anything", "toString", "f0"]))}
${reads("callable", accesses("callable", ["a", "name", "(1)", "none"]))}
${reads("newable", [...accesses("newable", ["a", "prototype", "none"]), "new newable()"])}
${reads("items", accesses("items", ["a", "length", "[0]", "none"]))}
${reads("pair", accesses("pair", ["a", "length", "[1]", "[2]", "none"]))}
${reads("space", accesses("space", ["a", "value", "Only", "f0"]))}
function generic<T extends { t: 1 }, U extends { u: 1 } | { u: 2; v: 3 }, K extends string>(
  one: T & A, union: U & A, text: K & A, all: T & U & A,
) {
${reads("one", accesses("one", ["t", "a", "f0", "none"]))}
${reads("union", accesses("union", ["u", "a", "v"]))}
${reads("text", accesses("text", ["a", "length", "none"]))}
${reads("all", accesses("all", ["t", "u", "a"]))}
  const keys: never = null! as Exclude<keyof (T & A), \`f\${number}\`>;
}
export {};
`,
    errors: `
(11,7): error TS2322: Type '1' is not assignable to type 'never'.
(12,7): error TS2322: Type 'number' is not assignable to type 'never'.
(13,7): error TS2322: Type 'any' is not assignable to type 'never'.
(13,33): error TS2339: Property 'none' does not exist on type 'string & { brand: 1; }'.
(14,7): error TS2322: Type '1' is not assignable to type 'never'.
(15,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
(16,7): error TS2322: Type '() => string' is not assignable to type 'never'.
(17,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(18,7): error TS2322: Type '1' is not assignable to type 'never'.
(19,7): error TS2322: Type 'string' is not assignable to type 'never'.
(20,7): error TS2322: Type 'string' is not assignable to type 'never'.
(21,7): error TS2322: Type 'any' is not assignable to type 'never'.
(21,35): error TS2339: Property 'none' does not exist on type 'A & ((x: number) => string)'.
(22,7): error TS2322: Type '1' is not assignable to type 'never'.
(23,7): error TS2322: Type 'any' is not assignable to type 'never'.
(24,7): error TS2322: Type 'any' is not assignable to type 'never'.
(24,33): error TS2339: Property 'none' does not exist on type 'A & (new () => A)'.
(25,7): error TS2322: Type 'A' is not assignable to type 'never'.
(26,7): error TS2322: Type '1' is not assignable to type 'never'.
(27,7): error TS2322: Type 'number' is not assignable to type 'never'.
(28,7): error TS2322: Type 'string' is not assignable to type 'never'.
(29,7): error TS2322: Type 'any' is not assignable to type 'never'.
(29,29): error TS2339: Property 'none' does not exist on type 'string[] & A'.
(30,7): error TS2322: Type '1' is not assignable to type 'never'.
(31,7): error TS2322: Type '2' is not assignable to type 'never'.
(32,7): error TS2322: Type '2' is not assignable to type 'never'.
(33,7): error TS2322: Type '1 | 2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(34,7): error TS2322: Type 'any' is not assignable to type 'never'.
(34,27): error TS2339: Property 'none' does not exist on type '[1, 2] & A'.
(35,7): error TS2322: Type '1' is not assignable to type 'never'.
(36,7): error TS2322: Type '1' is not assignable to type 'never'.
(37,7): error TS2322: Type 'any' is not assignable to type 'never'.
(37,29): error TS2339: Property 'Only' does not exist on type 'typeof Space & A'.
(38,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(42,7): error TS2322: Type '1' is not assignable to type 'never'.
(43,7): error TS2322: Type '1' is not assignable to type 'never'.
(44,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(45,7): error TS2322: Type 'any' is not assignable to type 'never'.
(45,25): error TS2339: Property 'none' does not exist on type 'T & A'.
(46,7): error TS2322: Type '1 | 2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(47,7): error TS2322: Type '1' is not assignable to type 'never'.
(48,7): error TS2322: Type 'any' is not assignable to type 'never'.
(48,29): error TS2339: Property 'v' does not exist on type '({ u: 1; } | { u: 2; v: 3; }) & A'.
  Property 'v' does not exist on type '{ u: 1; } & A'.
(49,7): error TS2322: Type '1' is not assignable to type 'never'.
(50,7): error TS2322: Type 'number' is not assignable to type 'never'.
(51,7): error TS2322: Type 'any' is not assignable to type 'never'.
(51,27): error TS2339: Property 'none' does not exist on type 'K & A'.
(52,7): error TS2322: Type '1' is not assignable to type 'never'.
(53,7): error TS2322: Type '1 | 2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(54,7): error TS2322: Type '1' is not assignable to type 'never'.
(55,9): error TS2322: Type '"a" | Exclude<keyof T, \`f\${number}\`>' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
`,
  },
  "2 to 40 constituents": {
    sizes: [2, 3, 8, 9, 40],
    program: count => {
      const names = ["own0", "own1", "all", "two", "clash", "last", "f0_3", "f1_19", "none"];
      const some = (i: number) => (i < 2 ? `two: ${i ? "1 | 2" : "number"}; clash: ${i ? "string" : "number"};` : "");
      return `
${each(count, i => `interface P${i} { own${i}: ${i}; all: string; ${some(i)} ${i === count - 1 ? `last: "last";` : ""} ${filler(20, `f${i}_`)} }`, " ")}
type N = ${each(count, i => `P${i}`, " & ")};
type L = ${each(count, i => `P${i}`, " & ")} & { l?: 1 };
declare const n: N;
declare const l: L;
${reads("n", accesses("n", names))}
const n_keys: never = null! as Exclude<keyof N, \`f\${string}\` | \`own\${number}\`>;
const l_keys: never = null! as Exclude<keyof L, \`f\${string}\` | \`own\${number}\`>;
${reads("l", accesses("l", names))}
export {};
`;
    },
    errors: `
(7,7): error TS2322: Type '0' is not assignable to type 'never'.
(8,7): error TS2322: Type '1' is not assignable to type 'never'.
(9,7): error TS2322: Type 'string' is not assignable to type 'never'.
(10,7): error TS2322: Type '1 | 2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(12,7): error TS2322: Type '"last"' is not assignable to type 'never'.
(13,7): error TS2322: Type '3 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(14,7): error TS2322: Type '19 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(15,7): error TS2322: Type 'any' is not assignable to type 'never'.
(15,21): error TS2339: Property 'none' does not exist on type 'N'.
(16,7): error TS2322: Type '"all" | "clash" | "last" | "two"' is not assignable to type 'never'.
  Type '"all"' is not assignable to type 'never'.
(17,7): error TS2322: Type '"all" | "clash" | "l" | "last" | "two"' is not assignable to type 'never'.
  Type '"all"' is not assignable to type 'never'.
(18,7): error TS2322: Type '0' is not assignable to type 'never'.
(19,7): error TS2322: Type '1' is not assignable to type 'never'.
(20,7): error TS2322: Type 'string' is not assignable to type 'never'.
(21,7): error TS2322: Type '1 | 2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(23,7): error TS2322: Type '"last"' is not assignable to type 'never'.
(24,7): error TS2322: Type '3 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(25,7): error TS2322: Type '19 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(26,7): error TS2322: Type 'any' is not assignable to type 'never'.
(26,21): error TS2339: Property 'none' does not exist on type 'L'.
`,
  },
  "`this` types and generic base types": {
    // `Leaf` has 5 properties besides the filler, `Mid` 4.
    sizes: [1, 25, 26, 27, 100],
    program: count => `
interface Base<T> { value: T; self(): this; map<U>(f: (t: T) => U): Base<U>; }
interface Mid<T> extends Base<T[]> { mid: T; ${filler(count)} }
interface Leaf extends Mid<string> { leaf: this["mid"]; }
type N = Leaf & { n: 1 };
type G<T> = Mid<T> & { g: T };
declare const n: N;
declare const g: G<number>;
${reads("n", accesses("n", ["value", "self()", "self().self().n", "mid", "leaf", "map(x => x.length).value", "f0", "none"]))}
${reads("g", accesses("g", ["value", "self()", "self().g", "mid", "g", "none"]))}
function generic<T>(one: G<T>, list: G<T[]>) {
${reads("one", accesses("one", ["value", "self().g", "mid"]))}
${reads("list", accesses("list", ["value", "self().g", "mid"]))}
}
const n_keys: never = null! as Exclude<keyof N, \`f\${number}\`>;
const g_keys: never = null! as Exclude<keyof G<1>, \`f\${number}\`>;
export {};
`,
    errors: `
(9,7): error TS2322: Type 'string[]' is not assignable to type 'never'.
(10,7): error TS2322: Type 'N' is not assignable to type 'never'.
(11,7): error TS2322: Type '1' is not assignable to type 'never'.
(12,7): error TS2322: Type 'string' is not assignable to type 'never'.
(13,7): error TS2322: Type 'string' is not assignable to type 'never'.
(14,7): error TS2322: Type 'number' is not assignable to type 'never'.
(15,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(16,7): error TS2322: Type 'any' is not assignable to type 'never'.
(16,21): error TS2339: Property 'none' does not exist on type 'N'.
(17,7): error TS2322: Type 'number[]' is not assignable to type 'never'.
(18,7): error TS2322: Type 'G<number>' is not assignable to type 'never'.
(19,7): error TS2322: Type 'number' is not assignable to type 'never'.
(20,7): error TS2322: Type 'number' is not assignable to type 'never'.
(21,7): error TS2322: Type 'number' is not assignable to type 'never'.
(22,7): error TS2322: Type 'any' is not assignable to type 'never'.
(22,21): error TS2339: Property 'none' does not exist on type 'G<number>'.
(24,7): error TS2322: Type 'T[]' is not assignable to type 'never'.
(25,7): error TS2322: Type 'T' is not assignable to type 'never'.
(26,7): error TS2322: Type 'T' is not assignable to type 'never'.
(27,7): error TS2322: Type 'T[][]' is not assignable to type 'never'.
(28,7): error TS2322: Type 'T[]' is not assignable to type 'never'.
(29,7): error TS2322: Type 'T[]' is not assignable to type 'never'.
(31,7): error TS2322: Type '"leaf" | "map" | "mid" | "n" | "self" | "value"' is not assignable to type 'never'.
  Type '"leaf"' is not assignable to type 'never'.
(32,7): error TS2322: Type '"g" | "map" | "mid" | "self" | "value"' is not assignable to type 'never'.
  Type '"g"' is not assignable to type 'never'.
`,
  },
  "an intersection used while a constituent is being resolved": {
    sizes: [1, 30, 31, 32, 100],
    program: count => `
interface Big { b: 1; ${filler(count)} }
type Noted = { [K in "a" | "b"]: Noted["c"] } & { c: 1; ${filler(count)} };
const noted: never = (null! as Noted).a;
const noted_keys: never = null! as Exclude<keyof Noted, \`f\${number}\`>;
type Rec = { next?: Rec; self: Rec["id"]; ${filler(count)} } & { id: 1 };
const rec: never = (null! as Rec).self;
const next: never = (null! as Rec).next!.next!.id;
class C { x = (null! as C & Big).y; y = (null! as C & Big).b; }
const c: never = new C().x;
class D { p = (null! as D & Big).p; q = (null! as D & Big).f0; }
const d: never = new D().q;
type Keys = { [K in Exclude<keyof (Keys & Big), "b">]: 1 };
const keys: never = null! as keyof Keys;
function f() { return (null! as ReturnType<typeof f> & Big).b; }
export {};
`,
    errors: `
(4,7): error TS2322: Type '1' is not assignable to type 'never'.
(5,7): error TS2322: Type '"a" | "b" | "c"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(7,7): error TS2322: Type '1' is not assignable to type 'never'.
(8,7): error TS2322: Type '1' is not assignable to type 'never'.
(9,34): error TS2729: Property 'y' is used before its initialization.
(10,7): error TS2322: Type '1' is not assignable to type 'never'.
(11,11): error TS7022: 'p' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(11,34): error TS2729: Property 'p' is used before its initialization.
(12,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(13,6): error TS2456: Type alias 'Keys' circularly references itself.
(13,21): error TS2313: Type parameter 'K' has a circular constraint.
(14,7): error TS2322: Type 'string | number | symbol' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(15,10): error TS7023: 'f' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
`,
  },
  "a mapped type with only one property read": {
    sizes: [1, 50, isDebug || isASAN ? 400 : 2000],
    program: count => `
type Keys = "first" | ${each(count, i => `"k${i}"`)} | "last";
type M = { [K in Keys]: { key: K } };
type Pair<T> = { [K in Keys]: [K, T] };
declare const m: M;
${reads("m", ["m.first", `m["last"]`, "m.none", `null! as M["k0"]`, "(null! as Pair<1>).last", "(null! as Pair<string>).last"])}
function generic<T>(pair: Pair<T>, list: Pair<T[]>) {
${reads("g", ["pair.first", "list.last"])}
}
const keys: never = null! as Exclude<keyof M, \`k\${number}\`>;
export {};
`,
    errors: `
(6,7): error TS2322: Type '{ key: "first"; }' is not assignable to type 'never'.
(7,7): error TS2322: Type '{ key: "last"; }' is not assignable to type 'never'.
(8,7): error TS2322: Type 'any' is not assignable to type 'never'.
(8,21): error TS2339: Property 'none' does not exist on type 'M'.
(9,7): error TS2322: Type '{ key: "k0"; }' is not assignable to type 'never'.
(10,7): error TS2322: Type '["last", 1]' is not assignable to type 'never'.
(11,7): error TS2322: Type '["last", string]' is not assignable to type 'never'.
(13,7): error TS2322: Type '["first", T]' is not assignable to type 'never'.
(14,7): error TS2322: Type '["last", T[]]' is not assignable to type 'never'.
(16,7): error TS2322: Type '"first" | "last"' is not assignable to type 'never'.
  Type '"first"' is not assignable to type 'never'.
`,
  },
  "`as` clauses and modifiers": {
    sizes: [1, 50],
    program: count => `
interface Source { a: 1; b: 2; c?: 3; readonly d: 4; readonly e?: 5; ${filler(count)} }
type Merged = { [K in keyof Source as K extends "a" | "b" ? "ab" : K]: K };
type Dropped = { [K in keyof Source as K extends "a" | \`f\${number}\` ? never : K]: Source[K] };
type Renamed = { [K in keyof Source as \`get_\${K}\`]: () => Source[K] };
type Same = { [K in keyof Source as K]: Source[K] };
type Copy = { [K in keyof Source]: Source[K] };
type All = { -readonly [K in keyof Source]-?: Source[K] };
type None = { readonly [K in keyof Source]?: Source[K] };
type Picked = Pick<Source, "c" | "d" | "f0">;
type Named = { [K in "c" | "d" | "z"]: K };
${reads("r", [
  ...accesses("(null! as Merged)", ["ab", "c", "a"]),
  ...accesses("(null! as Dropped)", ["b", "a", "f0"]),
  "null! as keyof Dropped",
  ...accesses("(null! as Renamed)", ["get_c", "c"]),
  ...["Same", "Copy", "All", "None", "Picked", "Named"].map(alias => `(null! as ${alias}).c`),
  "(null! as Copy).e",
  "(null! as All).e",
])}
${["Same", "Copy", "All", "None", "Picked"].map(alias => `(null! as ${alias}).d = 4;`).join("\n")}
(null! as Copy).a = 1;
(null! as Named).d = "d";
const copy: Copy = { a: 1, b: 2, d: 4 };
const picked: Picked = {};
export {};
`,
    errors: `
(12,7): error TS2322: Type '"a" | "b"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(13,7): error TS2322: Type '"c" | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(14,7): error TS2322: Type 'any' is not assignable to type 'never'.
(14,37): error TS2339: Property 'a' does not exist on type 'Merged'.
(15,7): error TS2322: Type '2' is not assignable to type 'never'.
(16,7): error TS2322: Type 'any' is not assignable to type 'never'.
(16,38): error TS2339: Property 'a' does not exist on type 'Dropped'.
(17,7): error TS2322: Type 'any' is not assignable to type 'never'.
(17,38): error TS2339: Property 'f0' does not exist on type 'Dropped'.
(18,7): error TS2322: Type '"b" | "c" | "d" | "e"' is not assignable to type 'never'.
  Type '"b"' is not assignable to type 'never'.
(19,7): error TS2322: Type '(() => 3 | undefined) | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(20,7): error TS2322: Type 'any' is not assignable to type 'never'.
(20,38): error TS2339: Property 'c' does not exist on type 'Renamed'.
(21,7): error TS2322: Type '3 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(22,7): error TS2322: Type '3 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(23,7): error TS2322: Type '3' is not assignable to type 'never'.
(24,7): error TS2322: Type '3 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(25,7): error TS2322: Type '3 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(26,7): error TS2322: Type '"c"' is not assignable to type 'never'.
(27,7): error TS2322: Type '5 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(28,7): error TS2322: Type '5' is not assignable to type 'never'.
(29,17): error TS2540: Cannot assign to 'd' because it is a read-only property.
(30,17): error TS2540: Cannot assign to 'd' because it is a read-only property.
(32,17): error TS2540: Cannot assign to 'd' because it is a read-only property.
(33,19): error TS2540: Cannot assign to 'd' because it is a read-only property.
(37,7): error TS2741: Property 'd' is missing in type '{}' but required in type 'Picked'.
`,
  },
  "keys that aren't strings, or that spell the same name": {
    sizes: [1],
    program: () => `
enum E { A = "a", B = "b" }
enum N { Zero, One }
declare const sym: unique symbol;
type ByEnum = { [K in E]: K };
type ByNumber = { [K in N]: K };
type Twice = { [K in "0" | 0 | "1" | E.A | "a"]: K };
type BySymbol = { [K in typeof sym | "s"]: K };
type Open = { [K in \`data-\${string}\` | "x" | number]: K };
declare const byEnum: ByEnum, byNumber: ByNumber, twice: Twice, bySymbol: BySymbol, open: Open;
const spread = { ...byEnum, ...bySymbol };
interface Clash extends ByEnum, Twice {}
interface Heir extends ByNumber, BySymbol { own: 1 }
${reads("r", [
  "byEnum.a",
  "byEnum[E.B]",
  "null! as keyof ByEnum",
  "byNumber[0]",
  "byNumber[N.One]",
  "null! as keyof ByNumber",
  "twice[0]",
  `twice["0"]`,
  "twice[1]",
  "twice.a",
  "null! as keyof Twice",
  "bySymbol[sym]",
  "bySymbol.s",
  "null! as keyof BySymbol",
  "open.x",
  `open["data-y"]`,
  "open[3]",
  "null! as keyof Open",
  "spread.a",
  "spread[sym]",
  "null! as keyof typeof spread",
  "{ ...twice }[0]",
  "(null! as Heir)[1]",
  "(null! as Heir)[sym]",
  "null! as keyof Heir",
])}
export {};
`,
    errors: `
(12,11): error TS2320: Interface 'Clash' cannot simultaneously extend types 'ByEnum' and 'Twice'.
  Named property 'a' of types 'ByEnum' and 'Twice' are not identical.
(14,7): error TS2322: Type 'E.A' is not assignable to type 'never'.
(15,7): error TS2322: Type 'E.B' is not assignable to type 'never'.
(16,7): error TS2322: Type 'E' is not assignable to type 'never'.
(17,7): error TS2322: Type 'N.Zero' is not assignable to type 'never'.
(18,7): error TS2322: Type 'N.One' is not assignable to type 'never'.
(19,7): error TS2322: Type 'N' is not assignable to type 'never'.
(20,7): error TS2322: Type '"0" | 0' is not assignable to type 'never'.
  Type '"0"' is not assignable to type 'never'.
(21,7): error TS2322: Type '"0" | 0' is not assignable to type 'never'.
  Type '"0"' is not assignable to type 'never'.
(22,7): error TS2322: Type '"1"' is not assignable to type 'never'.
(23,7): error TS2322: Type '"a" | E.A' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(24,7): error TS2322: Type '"0" | "1" | "a" | 0 | E.A' is not assignable to type 'never'.
  Type '"0"' is not assignable to type 'never'.
(25,7): error TS2322: Type 'unique symbol' is not assignable to type 'never'.
(26,7): error TS2322: Type '"s"' is not assignable to type 'never'.
(27,7): error TS2322: Type '"s" | unique symbol' is not assignable to type 'never'.
  Type '"s"' is not assignable to type 'never'.
(28,7): error TS2322: Type '"x"' is not assignable to type 'never'.
(29,7): error TS2322: Type '\`data-\${string}\`' is not assignable to type 'never'.
(30,7): error TS2322: Type 'number' is not assignable to type 'never'.
(31,7): error TS2322: Type 'number | "x" | \`data-\${string}\`' is not assignable to type 'never'.
  Type 'number' is not assignable to type 'never'.
(32,7): error TS2322: Type 'E.A' is not assignable to type 'never'.
(33,7): error TS2322: Type 'unique symbol' is not assignable to type 'never'.
(34,7): error TS2322: Type '"s" | unique symbol | E' is not assignable to type 'never'.
  Type '"s"' is not assignable to type 'never'.
(35,7): error TS2322: Type '"0" | 0' is not assignable to type 'never'.
  Type '"0"' is not assignable to type 'never'.
(36,7): error TS2322: Type 'N.One' is not assignable to type 'never'.
(37,7): error TS2322: Type 'unique symbol' is not assignable to type 'never'.
(38,7): error TS2322: Type 'keyof Heir' is not assignable to type 'never'.
  Type '"own"' is not assignable to type 'never'.
`,
  },
  "types derived from a mapped type's properties": {
    sizes: [1, 40],
    program: count => `
type Box<T> = { [K in "a" | "b" | ${each(count, i => `"f${i}"`)}]: { k: K; t: T } };
interface One extends Box<string> { one: 1 }
interface Two extends One { two: this["a"] }
interface Gen<T> extends Box<T[]> { gen: T }
interface Gen2<T> extends Gen<T> { self(): this }
class Impl implements Box<1> { a = null!; b = { k: "b" as const, t: 2 as const }; ${each(count, i => `f${i} = null!;`, " ")} }
${reads("r", [
  "(null! as One).a",
  "(null! as Two).a",
  "(null! as Two).two",
  "(null! as Gen<1>).b",
  "(null! as Gen2<number>).b",
  "(null! as Gen2<1>).self().a",
  "(null! as Box<1> | Box<2>).a",
  "(null! as Box<1> | One).b",
  "(null! as Box<1> & { c: 1 }).a",
  "(null! as Two & { z: 1 }).a",
  "(null! as One & Box<string>).a",
  "(null! as One & Box<number>).a",
  "(null! as Gen2<1> & Gen<1> & { z: 1 }).self().b",
  "{ ...(null! as Box<1>) }.a",
  "{ ...(null! as Two), b: 1 }.a",
  "(null! as Partial<Box<1>>).a",
  "(null! as Readonly<Two>).two",
  `(null! as Pick<Gen2<1>, "a" | "gen">).a`,
])}
function generic<T>(box: Box<T>, heir: Gen2<T>, both: Box<T> & Gen<T>) {
${reads("g", ["box.a", "heir.b", "heir.self().a", "both.a", "{ ...box }.b"])}
}
const up: Box<string> = null! as One;
const down: One = null! as Box<string>;
const other: Box<string> = null! as Box<number>;
const heirs: Gen<string> = null! as Gen2<number>;
export {};
`,
    errors: `
(7,43): error TS2416: Property 'b' in type 'Impl' is not assignable to the same property in base type 'Box<1>'.
  Type '{ k: "b"; t: 2; }' is not assignable to type '{ k: "b"; t: 1; }'.
    Types of property 't' are incompatible.
      Type '2' is not assignable to type '1'.
(8,7): error TS2322: Type '{ k: "a"; t: string; }' is not assignable to type 'never'.
(9,7): error TS2322: Type '{ k: "a"; t: string; }' is not assignable to type 'never'.
(10,7): error TS2322: Type '{ k: "a"; t: string; }' is not assignable to type 'never'.
(11,7): error TS2322: Type '{ k: "b"; t: 1[]; }' is not assignable to type 'never'.
(12,7): error TS2322: Type '{ k: "b"; t: number[]; }' is not assignable to type 'never'.
(13,7): error TS2322: Type '{ k: "a"; t: 1[]; }' is not assignable to type 'never'.
(14,7): error TS2322: Type '{ k: "a"; t: 1; } | { k: "a"; t: 2; }' is not assignable to type 'never'.
  Type '{ k: "a"; t: 1; }' is not assignable to type 'never'.
(15,7): error TS2322: Type '{ k: "b"; t: string; } | { k: "b"; t: 1; }' is not assignable to type 'never'.
  Type '{ k: "b"; t: string; }' is not assignable to type 'never'.
(16,7): error TS2322: Type '{ k: "a"; t: 1; }' is not assignable to type 'never'.
(17,7): error TS2322: Type '{ k: "a"; t: string; }' is not assignable to type 'never'.
(18,7): error TS2322: Type '{ k: "a"; t: string; }' is not assignable to type 'never'.
(19,7): error TS2322: Type '{ k: "a"; t: string; } & { k: "a"; t: number; }' is not assignable to type 'never'.
(20,7): error TS2322: Type '{ k: "b"; t: 1[]; }' is not assignable to type 'never'.
(21,7): error TS2322: Type '{ k: "a"; t: 1; }' is not assignable to type 'never'.
(22,7): error TS2322: Type '{ k: "a"; t: string; }' is not assignable to type 'never'.
(23,7): error TS2322: Type '{ k: "a"; t: 1; } | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(24,7): error TS2322: Type '{ k: "a"; t: string; }' is not assignable to type 'never'.
(25,7): error TS2322: Type '{ k: "a"; t: 1[]; }' is not assignable to type 'never'.
(27,7): error TS2322: Type '{ k: "a"; t: T; }' is not assignable to type 'never'.
(28,7): error TS2322: Type '{ k: "b"; t: T[]; }' is not assignable to type 'never'.
(29,7): error TS2322: Type '{ k: "a"; t: T[]; }' is not assignable to type 'never'.
(30,7): error TS2322: Type '{ k: "a"; t: T; } & { k: "a"; t: T[]; }' is not assignable to type 'never'.
(31,7): error TS2322: Type '{ k: "b"; t: T; }' is not assignable to type 'never'.
(34,7): error TS2741: Property 'one' is missing in type 'Box<string>' but required in type 'One'.
(35,7): error TS2322: Type 'Box<number>' is not assignable to type 'Box<string>'.
  Type 'number' is not assignable to type 'string'.
(36,7): error TS2322: Type 'Gen2<number>' is not assignable to type 'Gen<string>'.
  Types of property 'gen' are incompatible.
    Type 'number' is not assignable to type 'string'.
`,
  },
  "places that copy a mapped type's property": {
    sizes: [1, 40],
    program: count => `
type Box<T> = { [K in "a" | "b" | ${each(count, i => `"f${i}"`)}]: { k: K; t: T } };
interface One extends Box<string> { one: 1 }
interface Checks { check(x: unknown): asserts x is string }
declare const checks: Readonly<Checks>;
declare const unknown: unknown;
checks.check(unknown);
const narrowed: never = unknown;
declare const Base: (new () => { i: 1 }) & Box<1> & Readonly<Record<"fixed", 2>>;
class Heir extends Base { static own = Heir.a; }
Heir.fixed = 2;
const { a, missing = 1 } = { ...(null! as Box<2>) };
let widened = { ...(null! as Record<"call", () => void> & Box<null>), extra: null };
${reads("r", [
  "Heir.a",
  "Heir.own",
  "Heir.fixed",
  "new Heir().i",
  "a",
  "missing",
  "widened.call",
  "widened.a",
  "widened.extra",
  "null! as Exclude<keyof (One & Box<number>), `f${number}`>",
  "null! as Exclude<keyof typeof Heir, `f${number}`>",
  "null! as Exclude<keyof typeof widened, `f${number}`>",
])}
export {};
`,
    errors: `
(8,7): error TS2322: Type 'string' is not assignable to type 'never'.
(11,6): error TS2540: Cannot assign to 'fixed' because it is a read-only property.
(14,7): error TS2322: Type '{ k: "a"; t: 1; }' is not assignable to type 'never'.
(15,7): error TS2322: Type '{ k: "a"; t: 1; }' is not assignable to type 'never'.
(16,7): error TS2322: Type '2' is not assignable to type 'never'.
(17,7): error TS2322: Type '1' is not assignable to type 'never'.
(18,7): error TS2322: Type '{ k: "a"; t: 2; }' is not assignable to type 'never'.
(19,7): error TS2322: Type '1' is not assignable to type 'never'.
(20,7): error TS2322: Type '() => void' is not assignable to type 'never'.
(21,7): error TS2322: Type '{ k: "a"; t: null; }' is not assignable to type 'never'.
(22,7): error TS2322: Type 'null' is not assignable to type 'never'.
(23,7): error TS2322: Type '"a" | "b" | "one"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(24,7): error TS2322: Type '"a" | "b" | "fixed" | "own" | "prototype"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(25,7): error TS2322: Type '"a" | "b" | "call" | "extra"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
`,
  },
  "a union of intersections looked up by name": {
    // Each intersection also has 3 other constituents, with 44 properties.
    sizes: [0, 5, 6, 30],
    program: count => `
interface Base { kind: string; call(): void; ${filler(40)} }
interface Twin { kind: string; ${filler(40)} }
type Wide<K, T> = Base & { tag: K } & { theme: T }${each(count, i => ` & { e${i}?: ${i} }`, "")};
type Three<T> = Wide<"a", T> | Wide<"b", T> | Wide<"c", T>;
type Nine<T> = ${each(9, i => `Wide<${i}, T>`)};
type Mostly<K, T> = Base & Twin & { tag: K; theme: T };
type Callable<K> = Base & { tag: K } & (() => K);
${reads(
  "few",
  ["tag", "theme", "kind", "f0", "toString", "missing"].map(name => `(null! as Three<1>).${name}`),
)}
${reads(
  "many",
  Array.from({ length: 20 }, (_, i) => `(null! as Three<2>).f${i}!`),
)}
${reads(
  "vain",
  Array.from({ length: 20 }, (_, i) => `(null! as Three<3> | { g${i}: 1 }).g${i}`),
)}
${reads(
  "after",
  ["tag", "theme", "f39"].map(name => `(null! as Three<2>).${name}`),
)}
${reads(
  "nine",
  ["tag", "theme", "kind", "f0", "toString"].flatMap(name => [1, 2].map(t => `(null! as Nine<${t}>).${name}`)),
)}
${reads("listed", [
  "null! as Exclude<keyof Three<4>, \`f\${number}\` | \`e\${number}\`>",
  "(null! as Three<4>).tag",
  "{ ...(null! as Three<5>) }.tag",
  "(null! as Three<5>).theme",
  "(null! as Partial<Three<6>>).tag",
])}
${reads(
  "mostly",
  ["tag", "theme", "kind", "f1"].map(name => `(null! as Mostly<1, 1> | Mostly<2, 1>).${name}`),
)}
${reads(
  "callable",
  ["tag", "apply", "toString", "call"].map(name => `(null! as Callable<1> | Callable<2>).${name}`),
)}
function twice<X extends Wide<"a", 7>, Y extends Wide<"a", 7>, Z extends Wide<"b", 7>>(xy: X | Y, xz: X | Z, all: X | Y | Z) {
${reads("t", ["xy.tag", "xy.f1", "xy.toString", "xz.tag", "xz.f1", "all.tag", "all.theme", ...Array.from({ length: 14 }, (_, i) => `xy.f${i + 2}!`), "xy.tag", "all.f1"])}
}
function narrowed(u: Three<8>, n: Nine<8>) {
  if (u.tag === "a") { const a: never = u; } else { const rest: never = u.tag; }
  if (n.tag === 3) { const three: never = n.theme; }
  switch (n.tag) { case 0: case 1: { const low: never = n.tag; } }
}
const target: { tag: string; theme: 9; f0?: 0 } = null! as Three<9>;
const wrong: { tag: "a" | "b"; theme: 9 } = null! as Three<9>;
export {};
`,
    errors: `
(9,7): error TS2322: Type '"a" | "b" | "c"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(10,7): error TS2322: Type '1' is not assignable to type 'never'.
(11,7): error TS2322: Type 'string' is not assignable to type 'never'.
(12,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(13,7): error TS2322: Type '() => string' is not assignable to type 'never'.
(14,7): error TS2322: Type 'any' is not assignable to type 'never'.
(14,41): error TS2339: Property 'missing' does not exist on type 'Three<1>'.
  Property 'missing' does not exist on type 'Wide<"a", 1>'.
(15,7): error TS2322: Type '0' is not assignable to type 'never'.
(16,7): error TS2322: Type '1' is not assignable to type 'never'.
(17,7): error TS2322: Type '2' is not assignable to type 'never'.
(18,7): error TS2322: Type '3' is not assignable to type 'never'.
(19,7): error TS2322: Type '4' is not assignable to type 'never'.
(20,7): error TS2322: Type '5' is not assignable to type 'never'.
(21,7): error TS2322: Type '6' is not assignable to type 'never'.
(22,7): error TS2322: Type '7' is not assignable to type 'never'.
(23,7): error TS2322: Type '8' is not assignable to type 'never'.
(24,7): error TS2322: Type '9' is not assignable to type 'never'.
(25,7): error TS2322: Type '10' is not assignable to type 'never'.
(26,7): error TS2322: Type '11' is not assignable to type 'never'.
(27,7): error TS2322: Type '12' is not assignable to type 'never'.
(28,7): error TS2322: Type '13' is not assignable to type 'never'.
(29,7): error TS2322: Type '14' is not assignable to type 'never'.
(30,7): error TS2322: Type '15' is not assignable to type 'never'.
(31,7): error TS2322: Type '16' is not assignable to type 'never'.
(32,7): error TS2322: Type '17' is not assignable to type 'never'.
(33,7): error TS2322: Type '18' is not assignable to type 'never'.
(34,7): error TS2322: Type '19' is not assignable to type 'never'.
(35,7): error TS2322: Type 'any' is not assignable to type 'never'.
(35,54): error TS2339: Property 'g0' does not exist on type '{ g0: 1; } | Three<3>'.
  Property 'g0' does not exist on type 'Wide<"a", 3>'.
(36,7): error TS2322: Type 'any' is not assignable to type 'never'.
(36,54): error TS2339: Property 'g1' does not exist on type '{ g1: 1; } | Three<3>'.
  Property 'g1' does not exist on type 'Wide<"a", 3>'.
(37,7): error TS2322: Type 'any' is not assignable to type 'never'.
(37,54): error TS2339: Property 'g2' does not exist on type '{ g2: 1; } | Three<3>'.
  Property 'g2' does not exist on type 'Wide<"a", 3>'.
(38,7): error TS2322: Type 'any' is not assignable to type 'never'.
(38,54): error TS2339: Property 'g3' does not exist on type '{ g3: 1; } | Three<3>'.
  Property 'g3' does not exist on type 'Wide<"a", 3>'.
(39,7): error TS2322: Type 'any' is not assignable to type 'never'.
(39,54): error TS2339: Property 'g4' does not exist on type '{ g4: 1; } | Three<3>'.
  Property 'g4' does not exist on type 'Wide<"a", 3>'.
(40,7): error TS2322: Type 'any' is not assignable to type 'never'.
(40,54): error TS2339: Property 'g5' does not exist on type '{ g5: 1; } | Three<3>'.
  Property 'g5' does not exist on type 'Wide<"a", 3>'.
(41,7): error TS2322: Type 'any' is not assignable to type 'never'.
(41,54): error TS2339: Property 'g6' does not exist on type '{ g6: 1; } | Three<3>'.
  Property 'g6' does not exist on type 'Wide<"a", 3>'.
(42,7): error TS2322: Type 'any' is not assignable to type 'never'.
(42,54): error TS2339: Property 'g7' does not exist on type '{ g7: 1; } | Three<3>'.
  Property 'g7' does not exist on type 'Wide<"a", 3>'.
(43,7): error TS2322: Type 'any' is not assignable to type 'never'.
(43,54): error TS2339: Property 'g8' does not exist on type '{ g8: 1; } | Three<3>'.
  Property 'g8' does not exist on type 'Wide<"a", 3>'.
(44,7): error TS2322: Type 'any' is not assignable to type 'never'.
(44,54): error TS2339: Property 'g9' does not exist on type '{ g9: 1; } | Three<3>'.
  Property 'g9' does not exist on type 'Wide<"a", 3>'.
(45,7): error TS2322: Type 'any' is not assignable to type 'never'.
(45,56): error TS2339: Property 'g10' does not exist on type '{ g10: 1; } | Three<3>'.
  Property 'g10' does not exist on type 'Wide<"a", 3>'.
(46,7): error TS2322: Type 'any' is not assignable to type 'never'.
(46,56): error TS2339: Property 'g11' does not exist on type '{ g11: 1; } | Three<3>'.
  Property 'g11' does not exist on type 'Wide<"a", 3>'.
(47,7): error TS2322: Type 'any' is not assignable to type 'never'.
(47,56): error TS2339: Property 'g12' does not exist on type '{ g12: 1; } | Three<3>'.
  Property 'g12' does not exist on type 'Wide<"a", 3>'.
(48,7): error TS2322: Type 'any' is not assignable to type 'never'.
(48,56): error TS2339: Property 'g13' does not exist on type '{ g13: 1; } | Three<3>'.
  Property 'g13' does not exist on type 'Wide<"a", 3>'.
(49,7): error TS2322: Type 'any' is not assignable to type 'never'.
(49,56): error TS2339: Property 'g14' does not exist on type '{ g14: 1; } | Three<3>'.
  Property 'g14' does not exist on type 'Wide<"a", 3>'.
(50,7): error TS2322: Type 'any' is not assignable to type 'never'.
(50,56): error TS2339: Property 'g15' does not exist on type '{ g15: 1; } | Three<3>'.
  Property 'g15' does not exist on type 'Wide<"a", 3>'.
(51,7): error TS2322: Type 'any' is not assignable to type 'never'.
(51,56): error TS2339: Property 'g16' does not exist on type '{ g16: 1; } | Three<3>'.
  Property 'g16' does not exist on type 'Wide<"a", 3>'.
(52,7): error TS2322: Type 'any' is not assignable to type 'never'.
(52,56): error TS2339: Property 'g17' does not exist on type '{ g17: 1; } | Three<3>'.
  Property 'g17' does not exist on type 'Wide<"a", 3>'.
(53,7): error TS2322: Type 'any' is not assignable to type 'never'.
(53,56): error TS2339: Property 'g18' does not exist on type '{ g18: 1; } | Three<3>'.
  Property 'g18' does not exist on type 'Wide<"a", 3>'.
(54,7): error TS2322: Type 'any' is not assignable to type 'never'.
(54,56): error TS2339: Property 'g19' does not exist on type '{ g19: 1; } | Three<3>'.
  Property 'g19' does not exist on type 'Wide<"a", 3>'.
(55,7): error TS2322: Type '"a" | "b" | "c"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(56,7): error TS2322: Type '2' is not assignable to type 'never'.
(57,7): error TS2322: Type '39 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(58,7): error TS2322: Type '0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8' is not assignable to type 'never'.
  Type '0' is not assignable to type 'never'.
(59,7): error TS2322: Type '0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8' is not assignable to type 'never'.
  Type '0' is not assignable to type 'never'.
(60,7): error TS2322: Type '1' is not assignable to type 'never'.
(61,7): error TS2322: Type '2' is not assignable to type 'never'.
(62,7): error TS2322: Type 'string' is not assignable to type 'never'.
(63,7): error TS2322: Type 'string' is not assignable to type 'never'.
(64,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(65,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(66,7): error TS2322: Type '() => string' is not assignable to type 'never'.
(67,7): error TS2322: Type '() => string' is not assignable to type 'never'.
(68,7): error TS2322: Type '"call" | "kind" | "tag" | "theme"' is not assignable to type 'never'.
  Type '"call"' is not assignable to type 'never'.
(69,7): error TS2322: Type '"a" | "b" | "c"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(70,7): error TS2322: Type '"a" | "b" | "c"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(71,7): error TS2322: Type '5' is not assignable to type 'never'.
(72,7): error TS2322: Type '"a" | "b" | "c" | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(73,7): error TS2322: Type '1 | 2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(74,7): error TS2322: Type '1' is not assignable to type 'never'.
(75,7): error TS2322: Type 'string' is not assignable to type 'never'.
(76,7): error TS2322: Type '1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(77,7): error TS2322: Type '1 | 2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(78,7): error TS2322: Type '{ <T, R>(this: (this: T) => R, thisArg: T): R; <T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, args: A): R; }' is not assignable to type 'never'.
(79,7): error TS2322: Type '(() => string) & (() => string)' is not assignable to type 'never'.
(80,7): error TS2322: Type '() => void' is not assignable to type 'never'.
(82,7): error TS2322: Type '"a"' is not assignable to type 'never'.
(83,7): error TS2322: Type '1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(84,7): error TS2322: Type '() => string' is not assignable to type 'never'.
(85,7): error TS2322: Type '"a" | "b"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(86,7): error TS2322: Type '1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(87,7): error TS2322: Type '"a" | "b"' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(88,7): error TS2322: Type '7' is not assignable to type 'never'.
(89,7): error TS2322: Type '2' is not assignable to type 'never'.
(90,7): error TS2322: Type '3' is not assignable to type 'never'.
(91,7): error TS2322: Type '4' is not assignable to type 'never'.
(92,7): error TS2322: Type '5' is not assignable to type 'never'.
(93,7): error TS2322: Type '6' is not assignable to type 'never'.
(94,7): error TS2322: Type '7' is not assignable to type 'never'.
(95,7): error TS2322: Type '8' is not assignable to type 'never'.
(96,7): error TS2322: Type '9' is not assignable to type 'never'.
(97,7): error TS2322: Type '10' is not assignable to type 'never'.
(98,7): error TS2322: Type '11' is not assignable to type 'never'.
(99,7): error TS2322: Type '12' is not assignable to type 'never'.
(100,7): error TS2322: Type '13' is not assignable to type 'never'.
(101,7): error TS2322: Type '14' is not assignable to type 'never'.
(102,7): error TS2322: Type '15' is not assignable to type 'never'.
(103,7): error TS2322: Type '"a"' is not assignable to type 'never'.
(104,7): error TS2322: Type '1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(107,30): error TS2322: Type 'Wide<"a", 8>' is not assignable to type 'never'.
(107,59): error TS2322: Type '"b" | "c"' is not assignable to type 'never'.
  Type '"b"' is not assignable to type 'never'.
(108,28): error TS2322: Type '8' is not assignable to type 'never'.
(109,44): error TS2322: Type '0 | 1' is not assignable to type 'never'.
  Type '0' is not assignable to type 'never'.
(112,7): error TS2322: Type 'Three<9>' is not assignable to type '{ tag: "a" | "b"; theme: 9; }'.
  Type 'Wide<"c", 9>' is not assignable to type '{ tag: "a" | "b"; theme: 9; }'.
    Types of property 'tag' are incompatible.
      Type '"c"' is not assignable to type '"a" | "b"'.
`,
  },
};

// Whether an intersection reduces to `never` is decided property by property, from the properties that several
// constituents share. Up to 8 constituents are compared pairwise. A union's property is created on request, which
// resolves the types of the properties it combines. So a lookup by name must not enumerate the other properties, and an
// enumeration has to list them in the constituents' order.

/** `text(1)` .. `text(4)` */
const four = (text: (i: number) => string) => [1, 2, 3, 4].map(text);

// `errors`: what TypeScript 7.0.2 reports for `program(count)`, for every `count` in `sizes`, without the file name.
const reduced: typeof members = {
  "an intersection of the same object types and one more that shares no name with them": {
    // There are also 4 other constituents, with 8 properties.
    sizes: [0, 3, 4, 5, 40],
    program: count => `
interface P { kind: "p"; same: string; a?: 1 }
interface Q { kind: "q"; same: string; b?: 1 }
interface P2 { kind: "p"; same: string; c?: 1 }
interface Opt { kind?: "q"; same: string }
interface Opt2 { kind?: "p"; d?: 1 }
interface Tag<K> { kind: K; same: string }
interface Other<K> { kind: K; o?: 1 }
type More = { more?: 1 }${each(count, i => ` & { e${i}?: ${i}; same: string }`, "")};
type With<T> = { theme: T };
type Conflict<T> = P & Q & More & With<T>;
type Same<T> = P & P2 & More & With<T>;
type Optional<T> = Opt & Opt2 & More & With<T>;
type Half<T> = P & Opt & More & With<T>;
type Tags<A, B, T> = Tag<A> & Other<B> & More & With<T>;
type Kind<T> = P & P2 & More & { theme: T; kind: T };
type Union<T> = (P | Q) & P2 & More & With<T>;
type IsNever<T> = [T] extends [never] ? true : false;
type Keys<T> = Exclude<keyof { [K in keyof Same<T>]: 1 }, \`e\${number}\`>;
${reads(
  "conflict",
  four(i => `(null! as Conflict<${i}>).theme`),
)}
${reads(
  "same",
  four(i => `(null! as Same<${i}>).theme`),
)}
${reads(
  "optional",
  four(i => `(null! as Optional<${i}>).kind`),
)}
${reads(
  "half",
  four(i => `(null! as Half<${i}>).theme`),
)}
${reads(
  "tags",
  [1, 2, 3, 4, 5, 6].map(i => `(null! as Tags<"a", "${i % 2 ? "a" : "b"}", ${i}>).theme`),
)}
${reads(
  "kinds",
  ["p", "q", "p", "q", "r"].map(k => `(null! as Kind<"${k}">).theme`),
)}
${reads(
  "union",
  four(i => `(null! as Union<${i}>).a`),
)}
function generic<T, K extends "p" | "q">() {
${reads(
  "g",
  ["Conflict<T>", "Same<T>", "Same<T[]>", "Conflict<T[]>", "Same<[T]>", "Conflict<[T]>"].map(
    t => `(null! as ${t}).theme`,
  ),
)}
${reads(
  "k",
  ["P", "Q", "P2"].flatMap(p => ["T", "T[]", "[T]"].map(t => `(null! as ${p} & Tag<K> & More & With<${t}>).kind`)),
)}
}
${reads(
  "never",
  four(i => `null! as [IsNever<Conflict<[${i}]>>, IsNever<Same<[${i}]>>]`),
)}
${reads(
  "keys",
  four(i => `null! as Keys<${i}>`),
)}
export {};
`,
    errors: `
(20,7): error TS2322: Type 'any' is not assignable to type 'never'.
(20,49): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Conflict<1>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(21,7): error TS2322: Type 'any' is not assignable to type 'never'.
(21,49): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Conflict<2>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(22,7): error TS2322: Type 'any' is not assignable to type 'never'.
(22,49): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Conflict<3>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(23,7): error TS2322: Type 'any' is not assignable to type 'never'.
(23,49): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Conflict<4>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(24,7): error TS2322: Type '1' is not assignable to type 'never'.
(25,7): error TS2322: Type '2' is not assignable to type 'never'.
(26,7): error TS2322: Type '3' is not assignable to type 'never'.
(27,7): error TS2322: Type '4' is not assignable to type 'never'.
(28,7): error TS2322: Type 'undefined' is not assignable to type 'never'.
(29,7): error TS2322: Type 'undefined' is not assignable to type 'never'.
(30,7): error TS2322: Type 'undefined' is not assignable to type 'never'.
(31,7): error TS2322: Type 'undefined' is not assignable to type 'never'.
(32,7): error TS2322: Type 'any' is not assignable to type 'never'.
(32,41): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Half<1>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(33,7): error TS2322: Type 'any' is not assignable to type 'never'.
(33,41): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Half<2>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(34,7): error TS2322: Type 'any' is not assignable to type 'never'.
(34,41): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Half<3>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(35,7): error TS2322: Type 'any' is not assignable to type 'never'.
(35,41): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Half<4>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(36,7): error TS2322: Type '1' is not assignable to type 'never'.
(37,7): error TS2322: Type 'any' is not assignable to type 'never'.
(37,51): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Tags<"a", "b", 2>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(38,7): error TS2322: Type '3' is not assignable to type 'never'.
(39,7): error TS2322: Type 'any' is not assignable to type 'never'.
(39,51): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Tags<"a", "b", 4>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(40,7): error TS2322: Type '5' is not assignable to type 'never'.
(41,7): error TS2322: Type 'any' is not assignable to type 'never'.
(41,51): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Tags<"a", "b", 6>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(42,7): error TS2322: Type '"p"' is not assignable to type 'never'.
(43,7): error TS2322: Type 'any' is not assignable to type 'never'.
(43,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Kind<"q">' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(44,7): error TS2322: Type '"p"' is not assignable to type 'never'.
(45,7): error TS2322: Type 'any' is not assignable to type 'never'.
(45,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Kind<"q">' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(46,7): error TS2322: Type 'any' is not assignable to type 'never'.
(46,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Kind<"r">' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(47,7): error TS2322: Type '1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(48,7): error TS2322: Type '1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(49,7): error TS2322: Type '1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(50,7): error TS2322: Type '1 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(52,7): error TS2322: Type 'any' is not assignable to type 'never'.
(52,42): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Conflict<T>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(53,7): error TS2322: Type 'T' is not assignable to type 'never'.
(54,7): error TS2322: Type 'T[]' is not assignable to type 'never'.
(55,7): error TS2322: Type 'any' is not assignable to type 'never'.
(55,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Conflict<T[]>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(56,7): error TS2322: Type '[T]' is not assignable to type 'never'.
(57,7): error TS2322: Type 'any' is not assignable to type 'never'.
(57,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Conflict<[T]>' was reduced to 'never' because property 'kind' has conflicting types in some constituents.
(58,7): error TS2322: Type '"p"' is not assignable to type 'never'.
(59,7): error TS2322: Type '"p"' is not assignable to type 'never'.
(60,7): error TS2322: Type '"p"' is not assignable to type 'never'.
(61,7): error TS2322: Type '"q"' is not assignable to type 'never'.
(62,7): error TS2322: Type '"q"' is not assignable to type 'never'.
(63,7): error TS2322: Type '"q"' is not assignable to type 'never'.
(64,7): error TS2322: Type '"p"' is not assignable to type 'never'.
(65,7): error TS2322: Type '"p"' is not assignable to type 'never'.
(66,7): error TS2322: Type '"p"' is not assignable to type 'never'.
(68,7): error TS2322: Type '[true, false]' is not assignable to type 'never'.
(69,7): error TS2322: Type '[true, false]' is not assignable to type 'never'.
(70,7): error TS2322: Type '[true, false]' is not assignable to type 'never'.
(71,7): error TS2322: Type '[true, false]' is not assignable to type 'never'.
(72,7): error TS2322: Type 'Keys<1>' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(73,7): error TS2322: Type 'Keys<2>' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(74,7): error TS2322: Type 'Keys<3>' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(75,7): error TS2322: Type 'Keys<4>' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
`,
  },
  "private and protected properties, and `this`, in such an intersection": {
    sizes: [0, 3, 4, 5, 40],
    program: count => `
class C1 { private x = 1; y = 1 }
class C2 { private x = 1; y = 2; z = 1 }
class D1 { protected p = 1; y = 1 }
class D2 { protected p = 1; y = 1 }
class E1 extends C1 { e = 1 }
interface Self<T> { me(): this; v: T; y: number }
class Me { me() { return this; } w = 1 }
type More = { more?: 1 }${each(count, i => ` & { e${i}?: ${i}; y: number }`, "")};
type With<T> = { theme: T };
type Private<T> = C1 & C2 & More & With<T>;
type Protected<T> = D1 & D2 & More & With<T>;
type Heir<T> = C1 & E1 & More & With<T>;
type Selves<V, T> = Self<1> & { v: V } & More & With<T>;
type Aside<T> = D1 & D2 & More & Me & With<T>;
type Tuple<V, T> = [1, 2] & { 0: V } & More & With<T>;
${reads(
  "priv",
  four(i => `(null! as Private<${i}>).theme`),
)}
${reads(
  "prot",
  four(i => `(null! as Protected<${i}>).theme`),
)}
${reads(
  "heir",
  four(i => `(null! as Heir<${i}>).theme`),
)}
${reads(
  "self",
  four(i => `(null! as Selves<1, ${i}>).me().theme`),
)}
${reads(
  "selves",
  four(i => `(null! as Selves<2, ${i}>).me().theme`),
)}
${reads(
  "aside",
  four(i => `(null! as Aside<${i}>).me().theme`),
)}
${reads(
  "tuple",
  four(i => `(null! as Tuple<1, ${i}>).theme`),
)}
${reads(
  "tuples",
  four(i => `(null! as Tuple<2, ${i}>).theme`),
)}
export {};
`,
    errors: `
(17,7): error TS2322: Type 'any' is not assignable to type 'never'.
(17,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Private<1>' was reduced to 'never' because property 'x' exists in multiple constituents and is private in some.
(18,7): error TS2322: Type 'any' is not assignable to type 'never'.
(18,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Private<2>' was reduced to 'never' because property 'x' exists in multiple constituents and is private in some.
(19,7): error TS2322: Type 'any' is not assignable to type 'never'.
(19,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Private<3>' was reduced to 'never' because property 'x' exists in multiple constituents and is private in some.
(20,7): error TS2322: Type 'any' is not assignable to type 'never'.
(20,44): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Private<4>' was reduced to 'never' because property 'x' exists in multiple constituents and is private in some.
(21,7): error TS2322: Type '1' is not assignable to type 'never'.
(22,7): error TS2322: Type '2' is not assignable to type 'never'.
(23,7): error TS2322: Type '3' is not assignable to type 'never'.
(24,7): error TS2322: Type '4' is not assignable to type 'never'.
(25,7): error TS2322: Type '1' is not assignable to type 'never'.
(26,7): error TS2322: Type '2' is not assignable to type 'never'.
(27,7): error TS2322: Type '3' is not assignable to type 'never'.
(28,7): error TS2322: Type '4' is not assignable to type 'never'.
(29,7): error TS2322: Type '1' is not assignable to type 'never'.
(30,7): error TS2322: Type '2' is not assignable to type 'never'.
(31,7): error TS2322: Type '3' is not assignable to type 'never'.
(32,7): error TS2322: Type '4' is not assignable to type 'never'.
(33,7): error TS2322: Type 'any' is not assignable to type 'never'.
(33,48): error TS2339: Property 'me' does not exist on type 'never'.
  The intersection 'Selves<2, 1>' was reduced to 'never' because property 'v' has conflicting types in some constituents.
(34,7): error TS2322: Type 'any' is not assignable to type 'never'.
(34,48): error TS2339: Property 'me' does not exist on type 'never'.
  The intersection 'Selves<2, 2>' was reduced to 'never' because property 'v' has conflicting types in some constituents.
(35,7): error TS2322: Type 'any' is not assignable to type 'never'.
(35,48): error TS2339: Property 'me' does not exist on type 'never'.
  The intersection 'Selves<2, 3>' was reduced to 'never' because property 'v' has conflicting types in some constituents.
(36,7): error TS2322: Type 'any' is not assignable to type 'never'.
(36,48): error TS2339: Property 'me' does not exist on type 'never'.
  The intersection 'Selves<2, 4>' was reduced to 'never' because property 'v' has conflicting types in some constituents.
(37,7): error TS2322: Type '1' is not assignable to type 'never'.
(38,7): error TS2322: Type '2' is not assignable to type 'never'.
(39,7): error TS2322: Type '3' is not assignable to type 'never'.
(40,7): error TS2322: Type '4' is not assignable to type 'never'.
(41,7): error TS2322: Type '1' is not assignable to type 'never'.
(42,7): error TS2322: Type '2' is not assignable to type 'never'.
(43,7): error TS2322: Type '3' is not assignable to type 'never'.
(44,7): error TS2322: Type '4' is not assignable to type 'never'.
(45,7): error TS2322: Type 'any' is not assignable to type 'never'.
(45,47): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Tuple<2, 1>' was reduced to 'never' because property '0' has conflicting types in some constituents.
(46,7): error TS2322: Type 'any' is not assignable to type 'never'.
(46,47): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Tuple<2, 2>' was reduced to 'never' because property '0' has conflicting types in some constituents.
(47,7): error TS2322: Type 'any' is not assignable to type 'never'.
(47,47): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Tuple<2, 3>' was reduced to 'never' because property '0' has conflicting types in some constituents.
(48,7): error TS2322: Type 'any' is not assignable to type 'never'.
(48,47): error TS2339: Property 'theme' does not exist on type 'never'.
  The intersection 'Tuple<2, 4>' was reduced to 'never' because property '0' has conflicting types in some constituents.
`,
  },
  "a property whose type is being resolved, in such an intersection": {
    sizes: [0, 4, 5, 40],
    program: count => `
declare function f<T>(x: T): T;
type More = { more?: 1 }${each(count, i => ` & { e${i}?: ${i} }`, "")};
type With<T> = { theme: T };
${four(i => `f(null! as C & { x?: 1 } & More & With<${i}>);`).join("\n")}
class C { x? = { ${four(i => `a${i}: f(null! as C & { x?: 1 } & More & With<${i}>)`).join(", ")} } }
class T { x? = \`\${this}\` as const; y = [${four(i => `(null! as T & { x?: "a" } & More & With<${i}>).theme`).join(", ")}] }
class L {
${four(i => `  kind${i === 1 ? "" : i} = (null! as L & { kind: 1 } & More & With<${i}>).theme;`).join("\n")}
}
${reads(
  "l",
  four(i => `(null! as L & { kind: 1 } & More & With<${i}>).theme`),
)}
${reads(
  "c",
  four(i => `(null! as C & { x?: 1 } & More & With<${i}>).theme`),
)}
${reads(
  "t",
  four(i => `(null! as T & { x?: "a" } & More & With<${i}>).x`),
)}
export {};
`,
    errors: `
(10,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(12,3): error TS7022: 'kind' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(17,7): error TS2322: Type '1' is not assignable to type 'never'.
(18,7): error TS2322: Type '2' is not assignable to type 'never'.
(19,7): error TS2322: Type '3' is not assignable to type 'never'.
(20,7): error TS2322: Type '4' is not assignable to type 'never'.
(21,7): error TS2322: Type '1' is not assignable to type 'never'.
(22,7): error TS2322: Type '2' is not assignable to type 'never'.
(23,7): error TS2322: Type '3' is not assignable to type 'never'.
(24,7): error TS2322: Type '4' is not assignable to type 'never'.
(25,7): error TS2322: Type 'any' is not assignable to type 'never'.
(26,7): error TS2322: Type 'any' is not assignable to type 'never'.
(27,7): error TS2322: Type 'any' is not assignable to type 'never'.
(28,7): error TS2322: Type 'any' is not assignable to type 'never'.
`,
  },
  "a property that a union's members all get from one type": {
    sizes: [2, 9, 130],
    program: count => {
      const union = (shared: (i: number) => string) => each(count, i => `({ t: ${i} } & ${shared(i)})`);
      return `
type With = { theme: 1; readonly ro: 1; opt?: 2; method(): 3 };
interface G<T, X = 0> { g: T; readonly fixed: T; maybe?: X }
class Get { get value() { return 1; } get both() { return 1; } set both(v) {} plain = 1 }
class Plain { value = 1; both = 1; plain = 1 }
declare const one: ${union(() => "With")};
declare const generic: ${union(() => "G<1>")};
declare const equal: ${union(i => `G<1, ${i}>`)};
declare const differs: ${union(i => `G<${i % 2}>`)};
declare const getters: ${union(() => "Get")};
declare const mixed: ${union(i => (i === 1 ? "Plain" : "Get"))};
${reads("r", [
  ...accesses("one", ["theme", "ro", "opt", "method()"]),
  ...accesses("generic", ["g", "fixed", "maybe"]),
  ...accesses("equal", ["g", "fixed"]),
  ...accesses("differs", ["g", "fixed"]),
  ...accesses("getters", ["value", "both", "plain"]),
  ...accesses("mixed", ["value", "both", "plain"]),
])}
one.ro = 1;
one.theme = 1;
generic.fixed = 1;
equal.fixed = 1;
equal.g = 1;
differs.fixed = 1;
getters.value = 1;
getters.both = 1;
mixed.value = 1;
mixed.both = 1;
export {};
`;
    },
    errors: `
(12,7): error TS2322: Type '1' is not assignable to type 'never'.
(13,7): error TS2322: Type '1' is not assignable to type 'never'.
(14,7): error TS2322: Type '2 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(15,7): error TS2322: Type '3' is not assignable to type 'never'.
(16,7): error TS2322: Type '1' is not assignable to type 'never'.
(17,7): error TS2322: Type '1' is not assignable to type 'never'.
(18,7): error TS2322: Type '0 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(19,7): error TS2322: Type '1' is not assignable to type 'never'.
(20,7): error TS2322: Type '1' is not assignable to type 'never'.
(21,7): error TS2322: Type '0 | 1' is not assignable to type 'never'.
  Type '0' is not assignable to type 'never'.
(22,7): error TS2322: Type '0 | 1' is not assignable to type 'never'.
  Type '0' is not assignable to type 'never'.
(23,7): error TS2322: Type 'number' is not assignable to type 'never'.
(24,7): error TS2322: Type 'number' is not assignable to type 'never'.
(25,7): error TS2322: Type 'number' is not assignable to type 'never'.
(26,7): error TS2322: Type 'number' is not assignable to type 'never'.
(27,7): error TS2322: Type 'number' is not assignable to type 'never'.
(28,7): error TS2322: Type 'number' is not assignable to type 'never'.
(29,5): error TS2540: Cannot assign to 'ro' because it is a read-only property.
(31,9): error TS2540: Cannot assign to 'fixed' because it is a read-only property.
(32,7): error TS2540: Cannot assign to 'fixed' because it is a read-only property.
(34,9): error TS2540: Cannot assign to 'fixed' because it is a read-only property.
(35,9): error TS2540: Cannot assign to 'value' because it is a read-only property.
(37,7): error TS2540: Cannot assign to 'value' because it is a read-only property.
`,
  },
  "the index signatures of a mapped type over a type parameter whose constraint is a union": {
    sizes: [2, 9, 130],
    program: count => {
      const union = (member: (i: number) => string) => each(count, i => `(${member(i)} & { t${i}?: ${i} })`);
      return `
interface RO { readonly [k: string]: unknown; id: string }
interface RW { [k: string]: unknown; id: string }
interface None { id: string }
interface Num { readonly [k: number]: 1; id: string }
interface Pattern { readonly [k: \`on\${string}\`]: 2; id: string }
interface Calls { (): 1; readonly [k: string]: unknown; id: string }
type Writable<T, K extends keyof T> = { -readonly [P in K]: T[P] };
type Frozen<T, K extends keyof T> = { readonly [P in K]: T[P] };
type Rest<T> = Exclude<keyof T, "id">;
function f<
  A extends ${union(() => "RO")},
  B extends ${union(i => (i === 1 ? "RO" : "RW"))},
  C extends ${union(() => "RW")},
  D extends ${union(i => (i === 1 ? "None" : "RO"))},
  E extends ${union(() => "Num")},
  F extends ${union(() => "Pattern")},
  G extends ${union(() => "Calls")},
>(a: Omit<A, "id">, b: Omit<B, "id">, c: Omit<C, "id">, d: Omit<D, "id">, e: Omit<E, "id">, f: Omit<F, "id">, g: Omit<G, "id">, whole: G) {
  a[0] = null!;
  a["x"] = null!;
  b[0] = null!;
  c[0] = null!;
  d[0] = null!;
  e[0] = null!;
  f["onx"] = null!;
  g[0] = null!;
  (null! as Writable<A, Rest<A>>)[0] = null!;
  (null! as Frozen<C, Rest<C>>)[0] = null!;
${reads("r", ["a[0]", "b[0]", "c[0]", "e[0]", 'f["onx"]', "g[0]", "whole()", "whole.id", "whole.other"])}
}
export {};
`;
    },
    errors: `
(20,3): error TS2542: Index signature in type 'Omit<A, "id">' only permits reading.
(21,3): error TS2862: Type 'Omit<A, "id">' is generic and can only be indexed for reading.
(22,3): error TS2542: Index signature in type 'Omit<B, "id">' only permits reading.
(24,3): error TS7053: Element implicitly has an 'any' type because expression of type '0' can't be used to index type 'Omit<D, "id">'.
  Property '0' does not exist on type 'Omit<D, "id">'.
(25,3): error TS2542: Index signature in type 'Omit<E, "id">' only permits reading.
(26,3): error TS2862: Type 'Omit<F, "id">' is generic and can only be indexed for reading.
(27,3): error TS2542: Index signature in type 'Omit<G, "id">' only permits reading.
(29,3): error TS2542: Index signature in type 'Frozen<C, Exclude<keyof C, "id">>' only permits reading.
(30,7): error TS2322: Type 'A[number]' is not assignable to type 'never'.
(31,7): error TS2322: Type 'B[number]' is not assignable to type 'never'.
(32,7): error TS2322: Type 'C[number]' is not assignable to type 'never'.
(33,7): error TS2322: Type 'E[number]' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(34,7): error TS2322: Type 'F[\`on\${string}\`]' is not assignable to type 'never'.
  Type '2' is not assignable to type 'never'.
(35,7): error TS2322: Type 'G[number]' is not assignable to type 'never'.
(36,7): error TS2322: Type '1' is not assignable to type 'never'.
(37,7): error TS2322: Type 'string' is not assignable to type 'never'.
(38,7): error TS2322: Type 'unknown' is not assignable to type 'never'.
`,
  },
  "a union property that nothing requests isn't created": {
    sizes: [2, 9],
    program: count => {
      // An index signature of the members, a parameter's type, and what the type parameter is intersected with for the
      // argument. Each is used in the initializer of a variable that `shape`'s type depends on.
      const inInitializer = [
        ["[k: string]: unknown; ", "", ""],
        ["", "{ id: string } & { extra: number }", "{ extra: 1 }"],
        ["", "{ id: string }", "{ extra: 1 }"],
        ["", "{ id: string } & { extra: number }", "{ extra: 1; id: string }"],
        ["", "{ id: string } & { extra: number }", "{ extra: 1; shape?: 1 }"],
        ["", "{ id?: string }", "{ extra: 1 }"],
        ["", "{ id: string; shape?: unknown }", "{ extra: 1 }"],
        ["", "{ id: string; shape?: string }", "{ extra: 1 }"],
      ];
      const programs = inInitializer.map(
        ([index, target, source], n) => `
interface A${n} { ${index}id: string; shape?: 1 }
interface B${n} { ${index}id: string; shape?: keyof typeof shapes${n} }
type Members${n} = A${n} | B${n}${each(count - 2, i => ` | (A${n} & { t${i}?: ${i} })`, "")};
declare function accept${n}(t: ${target || "unknown"}): 1;
const shapes${n} = { circle: (<U extends Members${n}>${target ? `() => accept${n}(null! as U & ${source}))()` : `(p: Omit<U, "id">) => p[0])(null!)`} };
const whole${n}: never = shapes${n};`,
      );
      return `${programs.join("")}\nexport {};\n`;
    },
    errors: `
(7,7): error TS2322: Type '{ circle: unknown; }' is not assignable to type 'never'.
(13,7): error TS2322: Type '{ circle: 1; }' is not assignable to type 'never'.
(19,7): error TS2322: Type '{ circle: 1; }' is not assignable to type 'never'.
(25,7): error TS2322: Type '{ circle: 1; }' is not assignable to type 'never'.
(27,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(30,7): error TS7022: 'shapes4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(30,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(31,7): error TS2322: Type 'any' is not assignable to type 'never'.
(33,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(36,7): error TS7022: 'shapes5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(36,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(37,7): error TS2322: Type 'any' is not assignable to type 'never'.
(39,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(42,7): error TS7022: 'shapes6' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(42,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(43,7): error TS2322: Type 'any' is not assignable to type 'never'.
(48,62): error TS2345: Argument of type 'U & { extra: 1; }' is not assignable to parameter of type '{ id: string; shape?: string | undefined; }'.
(49,7): error TS2322: Type '{ circle: 1; }' is not assignable to type 'never'.
`,
  },
  "reducing an intersection with a type parameter creates the properties of its constraint": {
    sizes: [2, 9],
    program: count => {
      // More type parameters of a function, and what it returns. Each is called in the initializer of a variable that
      // `shape`'s type depends on.
      const inInitializer = [
        ["", "(null! as U & { extra: 1; id: string }).id"],
        ["", "(null! as U & { extra: 1; id: string }).extra"],
        ["", "(null! as { extra: 1; id?: string } & U).extra"],
        ["", '(null! as U & { extra: 1; id: "a" }).extra'],
        ["", "(null! as U & { extra: 1; shape?: 1 }).extra"],
        [", V extends C | D", "(null! as U & V).id"],
        [", V extends C | D", "(null! as V & U).id"],
        [", V extends C | D", "(null! as U & V & { z: 1 }).z"],
        [", V extends E | F", "(null! as U & V).id"],
        [", V extends G | H", "(null! as U & V).id"],
        ["", "(null! as U & (C | D)).id"],
        ["", "(null! as U & C).id"],
        ["", "(null! as (U & C) | D).id"],
        ["", "null! as keyof (U & C)"],
        ["", "({ ...(null! as U & C) })"],
        ["", "{ const { id } = null! as U & C; return id; }"],
        ["", "{ for (const k in null! as U & C) return k; return 1; }"],
        ["", '"id" in (null! as U & C)'],
      ];
      const programs = inInitializer.map(
        ([more, returned], n) => `
interface A${n} { id: string; shape?: 1 }
interface B${n} { id: string; shape?: keyof typeof shapes${n} }
type Members${n} = A${n} | B${n}${each(count - 2, i => ` | (A${n} & { t${i}?: ${i} })`, "")};
const shapes${n} = { circle: (<U extends Members${n}${more}>() => ${returned})() };
const whole${n}: never = shapes${n};`,
      );
      return `
interface C { id: string; other?: 1 }
interface D { id: string; other?: 2 }
interface E { name: string; other?: 1 }
interface F { name: string; other?: 2 }
interface G { name: string; shape?: 1 }
interface H { name: string; shape?: 2 }${programs.join("")}\nexport {};\n`;
    },
    errors: `
(12,7): error TS2322: Type '{ circle: string; }' is not assignable to type 'never'.
(17,7): error TS2322: Type '{ circle: 1; }' is not assignable to type 'never'.
(22,7): error TS2322: Type '{ circle: 1; }' is not assignable to type 'never'.
(27,7): error TS2322: Type '{ circle: 1; }' is not assignable to type 'never'.
(29,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(31,7): error TS7022: 'shapes4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(31,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(32,7): error TS2322: Type 'any' is not assignable to type 'never'.
(37,7): error TS2322: Type '{ circle: string; }' is not assignable to type 'never'.
(42,7): error TS2322: Type '{ circle: string; }' is not assignable to type 'never'.
(47,7): error TS2322: Type '{ circle: 1; }' is not assignable to type 'never'.
(52,7): error TS2322: Type '{ circle: string; }' is not assignable to type 'never'.
(54,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(56,7): error TS7022: 'shapes9' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(56,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(57,7): error TS2322: Type 'any' is not assignable to type 'never'.
(59,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(61,7): error TS7022: 'shapes10' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(61,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(62,7): error TS2322: Type 'any' is not assignable to type 'never'.
(67,7): error TS2322: Type '{ circle: string; }' is not assignable to type 'never'.
(69,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(71,7): error TS7022: 'shapes12' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(71,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(72,7): error TS2322: Type 'any' is not assignable to type 'never'.
(74,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(76,7): error TS7022: 'shapes13' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(76,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(77,7): error TS2322: Type 'any' is not assignable to type 'never'.
(79,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(81,7): error TS7022: 'shapes14' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(81,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(82,7): error TS2322: Type 'any' is not assignable to type 'never'.
(84,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(86,7): error TS7022: 'shapes15' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(86,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(86,66): error TS7022: 'id' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(87,7): error TS2322: Type 'any' is not assignable to type 'never'.
(89,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(91,7): error TS7022: 'shapes16' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(91,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(91,69): error TS7022: 'k' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(92,7): error TS2322: Type 'any' is not assignable to type 'never'.
(94,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(96,7): error TS7022: 'shapes17' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(96,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(97,7): error TS2322: Type 'any' is not assignable to type 'never'.
`,
  },
  "the constraint's properties are created even if no other member of the intersection shares a name with them": {
    sizes: [2, 9],
    program: count => {
      const inInitializer = [
        ["", "(null! as U & (E | F)).other"],
        ["", "(null! as (U & E) | F).other"],
        ["", "(null! as (U & { z: 1 }) | { z: 2 }).z"],
        ["", "null! as keyof (U & E)"],
        ["", "({ ...(null! as U & E) })"],
        ["", "{ const { name } = null! as U & E; return name; }"],
        ["", "{ for (const k in null! as U & E) return k; return 1; }"],
        ["", '"name" in (null! as U & E)'],
        ["", "null! as keyof (U & {})"],
        ["", "null! as keyof (U & object)"],
        ["", "null! as keyof (U & string)"],
        [", V", "null! as keyof (U & V)"],
        ["", "null! as keyof ((U & E) | undefined)"],
        ["", "(null! as U & E).name"],
        ["", "null! as keyof U"],
        [", V extends B", "null! as keyof (V & E)"],
      ];
      const programs = inInitializer.map(
        ([more, returned], n) => `
interface A${n} { id: string; shape?: 1 }
interface B${n} { id: string; shape?: keyof typeof shapes${n} }
type Members${n} = A${n} | B${n}${each(count - 2, i => ` | (A${n} & { t${i}?: ${i} })`, "")};
const shapes${n} = { circle: (<U extends Members${n}${more.replace(/B$/, `B${n}`)}>() => ${returned})() };
const whole${n}: never = shapes${n};`,
      );
      return `
interface E { name: string; other?: 1 }
interface F { name: string; other?: 2 }${programs.join("")}\nexport {};\n`;
    },
    errors: `
(5,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(7,7): error TS7022: 'shapes0' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(7,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(8,7): error TS2322: Type 'any' is not assignable to type 'never'.
(10,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(12,7): error TS7022: 'shapes1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(12,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(13,7): error TS2322: Type 'any' is not assignable to type 'never'.
(15,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(17,7): error TS7022: 'shapes2' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(17,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(18,7): error TS2322: Type 'any' is not assignable to type 'never'.
(20,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(22,7): error TS7022: 'shapes3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(22,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(23,7): error TS2322: Type 'any' is not assignable to type 'never'.
(25,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(27,7): error TS7022: 'shapes4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(27,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(28,7): error TS2322: Type 'any' is not assignable to type 'never'.
(30,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(32,7): error TS7022: 'shapes5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(32,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(32,64): error TS7022: 'name' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(33,7): error TS2322: Type 'any' is not assignable to type 'never'.
(35,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(37,7): error TS7022: 'shapes6' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(37,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(37,67): error TS7022: 'k' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(38,7): error TS2322: Type 'any' is not assignable to type 'never'.
(40,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(42,7): error TS7022: 'shapes7' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(42,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(43,7): error TS2322: Type 'any' is not assignable to type 'never'.
(45,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(47,7): error TS7022: 'shapes8' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(47,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(48,7): error TS2322: Type 'any' is not assignable to type 'never'.
(50,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(52,7): error TS7022: 'shapes9' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(52,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(53,7): error TS2322: Type 'any' is not assignable to type 'never'.
(55,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(57,7): error TS7022: 'shapes10' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(57,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(58,7): error TS2322: Type 'any' is not assignable to type 'never'.
(60,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(62,7): error TS7022: 'shapes11' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(62,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(63,7): error TS2322: Type 'any' is not assignable to type 'never'.
(65,29): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(67,7): error TS7022: 'shapes12' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(67,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(68,7): error TS2322: Type 'any' is not assignable to type 'never'.
(73,7): error TS2322: Type '{ circle: string; }' is not assignable to type 'never'.
(78,7): error TS2322: Type '{ circle: "id" | "shape"; }' is not assignable to type 'never'.
(83,7): error TS2322: Type '{ circle: keyof B15 | keyof E; }' is not assignable to type 'never'.
`,
  },
  "the constraint's properties are created for a parameter typed as such an intersection": {
    sizes: [2, 9],
    program: count => `
interface C { id: string; other?: 1 }
interface E { name: string; other?: 1 }
interface A { id: string; shape?: 1 }
interface B { id: string; shape?: keyof typeof shapes }
type Members = A | B${each(count - 2, i => ` | (A & { t${i}?: ${i} })`, "")};
declare function accept<V extends Members>(t: V & E): 1;
const shapes = { circle: (<U extends Members>() => accept<U>(null! as U & C))() };
const whole: never = shapes;
export {};
`,
    errors: `
(5,27): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(8,7): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(8,27): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(8,62): error TS2345: Argument of type 'U & C' is not assignable to parameter of type 'U & E'.
  Type 'U & C' is not assignable to type 'E'.
(9,7): error TS2322: Type 'any' is not assignable to type 'never'.
`,
  },
  "a mapped type over a type parameter and the type parameter, in either order": {
    sizes: [0],
    program: () => {
      const types = [
        "Partial<T> & T",
        "T & Partial<T>",
        "Required<T> & P",
        "P & Required<T>",
        "Readonly<T> & T",
        "{ [K in keyof T]: T[K] } & T",
        'Omit<T, "id"> & P',
        'P & Omit<T, "id">',
        'Pick<T, "id"> & T',
        "Record<string, unknown> & T",
      ];
      const bodies = [
        "return register(make<V>());",
        "return register(null! as V);",
        "return Object.keys(make<V>());",
        "return register(v!);",
        "return v!.id;",
        "const made = make<V>(); return register(made);",
      ];
      const programs = types
        .flatMap(type => bodies.map(body => [type, body]))
        .map(
          ([type, body], n) => `
interface Page${n} { id: string; title?: string }
interface Link${n} { id: string; to?: keyof typeof routes${n} }
function load${n}<T extends Page${n} | Link${n}, P extends T>(v?: ${type}) { ${body.replace("V", type)} }
const routes${n} = { home: load${n}() };`,
        );
      return `
declare function register(entry: { id: string }): number;
declare function make<M>(): M;${programs.join("")}\nexport {};\n`;
    },
    errors: `
(21,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(22,10): error TS7023: 'load4' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(23,7): error TS7022: 'routes4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(29,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(30,10): error TS7023: 'load6' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(31,7): error TS7022: 'routes6' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(33,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(34,10): error TS7023: 'load7' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(35,7): error TS7022: 'routes7' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(45,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(46,10): error TS7023: 'load10' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(47,7): error TS7022: 'routes10' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(69,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(70,10): error TS7023: 'load16' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(71,7): error TS7022: 'routes16' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(77,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(78,10): error TS7023: 'load18' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(79,7): error TS7022: 'routes18' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(81,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(82,10): error TS7023: 'load19' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(83,7): error TS7022: 'routes19' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(93,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(94,10): error TS7023: 'load22' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(95,7): error TS7022: 'routes22' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(117,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(118,10): error TS7023: 'load28' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(119,7): error TS7022: 'routes28' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(141,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(142,10): error TS7023: 'load34' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(143,7): error TS7022: 'routes34' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
`,
  },
  "a parameter typed as such an intersection or undefined": {
    sizes: [0],
    program: () => {
      const types = [
        "T & Partial<T>",
        "Partial<T> & T",
        "{ draft?: boolean } & T & Partial<T>",
        "T & { draft?: boolean } & Partial<T>",
        "{ draft?: boolean } & Partial<T> & T",
        "{ draft?: boolean } & T & Required<T>",
        "T & { extra?: 1 }",
      ];
      const bodies = [
        "return x!;",
        "return register(x!);",
        "return x!.id;",
        "return x && other;",
        "return x || other;",
        "return x ?? other;",
        "if (x || other) return x; return other;",
      ];
      const programs = types
        .flatMap(type => bodies.map(body => [type, body]))
        .map(
          ([type, body], n) => `
interface Page${n} { id: string; title?: string }
interface Link${n} { id: string; to?: keyof typeof routes${n} }
function load${n}<T extends Page${n} | Link${n}>(x: (${type}) | undefined) { ${body} }
const routes${n} = { home: load${n}(other) };`,
        );
      return `
declare function register(entry: { id: string }): number;
declare const other: { id: string };${programs.join("")}\nexport {};\n`;
    },
    errors: `
(5,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(7,7): error TS7022: 'routes0' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(13,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(15,7): error TS7022: 'routes2' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(17,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(19,7): error TS7022: 'routes3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(21,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(23,7): error TS7022: 'routes4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(25,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(27,7): error TS7022: 'routes5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(29,31): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(30,10): error TS7023: 'load6' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(31,7): error TS7022: 'routes6' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(49,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(51,7): error TS7022: 'routes11' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(53,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(55,7): error TS7022: 'routes12' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(57,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(58,10): error TS7023: 'load13' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(59,7): error TS7022: 'routes13' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(77,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(79,7): error TS7022: 'routes18' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(81,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(83,7): error TS7022: 'routes19' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(85,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(86,10): error TS7023: 'load20' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(87,7): error TS7022: 'routes20' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(89,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(91,7): error TS7022: 'routes21' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(97,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(99,7): error TS7022: 'routes23' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(101,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(103,7): error TS7022: 'routes24' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(105,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(107,7): error TS7022: 'routes25' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(109,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(111,7): error TS7022: 'routes26' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(113,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(114,10): error TS7023: 'load27' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(115,7): error TS7022: 'routes27' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(133,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(135,7): error TS7022: 'routes32' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(137,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(139,7): error TS7022: 'routes33' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(141,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(142,10): error TS7023: 'load34' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(143,7): error TS7022: 'routes34' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(161,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(163,7): error TS7022: 'routes39' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(165,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(167,7): error TS7022: 'routes40' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(169,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(170,10): error TS7023: 'load41' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(171,7): error TS7022: 'routes41' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(189,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(191,7): error TS7022: 'routes46' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(193,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(195,7): error TS7022: 'routes47' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(197,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(198,10): error TS7023: 'load48' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(199,7): error TS7022: 'routes48' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
`,
  },
  "the constraint's properties are created when a union with such an intersection is reduced to its supertypes": {
    sizes: [2, 9],
    program: count => {
      const inInitializer = [
        ["v: (U & { extra: 1 }) | undefined", "v || (null! as { id: string })"],
        ["v: (U & { extra: 1 }) | undefined", "v ?? (null! as { id: string })"],
        ["v: U & { extra: 1 }", "v || (null! as { id: string })"],
        ["v: U & { extra: 1 }", "[v, null! as { id: string }]"],
        ["v: U & { extra: 1 }, c?: boolean", "c ? v : (null! as { id: string })"],
        ["v: U & { extra: 1 }", "v || 1"],
        ["v: U & { extra: 1 }", "[v, v]"],
        ["v: U", "v || (null! as { id: string })"],
        ["v: U", "[v, null! as { id: string }]"],
        ["v: { extra: 1 } & { id: string }", "v || (null! as { id: string })"],
      ];
      const programs = inInitializer.map(
        ([parameters, returned], n) => `
interface A${n} { id: string; shape?: 1 }
interface B${n} { id: string; shape?: keyof typeof shapes${n} }
type Members${n} = A${n} | B${n}${each(count - 2, i => ` | (A${n} & { t${i}?: ${i} })`, "")};
const shapes${n} = { circle: (<U extends Members${n}>(${parameters}) => ${returned})(null!) };
const whole${n}: never = shapes${n};`,
      );
      return `${programs.join("")}\nexport {};\n`;
    },
    errors: `
(3,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(5,7): error TS7022: 'shapes0' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(6,7): error TS2322: Type 'any' is not assignable to type 'never'.
(8,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(10,7): error TS7022: 'shapes1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(11,7): error TS2322: Type 'any' is not assignable to type 'never'.
(16,7): error TS2322: Type '{ circle: never; }' is not assignable to type 'never'.
(18,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(20,7): error TS7022: 'shapes3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(20,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(21,7): error TS2322: Type 'any' is not assignable to type 'never'.
(23,28): error TS2502: 'shape' is referenced directly or indirectly in its own type annotation.
(25,7): error TS7022: 'shapes4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(25,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(26,7): error TS2322: Type 'any' is not assignable to type 'never'.
(31,7): error TS2322: Type '{ circle: never; }' is not assignable to type 'never'.
(36,7): error TS2322: Type '{ circle: never[]; }' is not assignable to type 'never'.
(41,7): error TS2322: Type '{ circle: never; }' is not assignable to type 'never'.
(46,7): error TS2322: Type '{ circle: { id: string; }[]; }' is not assignable to type 'never'.
(51,7): error TS2322: Type '{ circle: { extra: 1; } & { id: string; }; }' is not assignable to type 'never'.
`,
  },
  "an intersection with a type parameter whose constraint is a union, compared with object types": {
    sizes: [2, 9, 130],
    program: count => {
      const targets = [
        "{ id: string } & { extra: number }",
        "{ id: string } & { extra: string }",
        "{ id: string } & { shape?: 3 }",
        "{ id: string } & { shape?: 1 | 2 }",
        "{ both: 1 | 2 } & { extra: 1 }",
        "{ both: 1 } & { extra: 1 }",
        "{ onlyA: 1 } & { extra: 1 }",
        "{ onlyA?: 1 } & { extra: 1 }",
        "{ none: 1; nor: 2 } & { extra: 1 }",
        "{ toString(): string } & { extra: 1 }",
        "{ toString(): number } & { extra: 1 }",
        "{ valueOf(): object } & { extra: 1 }",
        "{ valueOf(): 1 } & { extra: 1 }",
        "{ shape?: 1 | 2 }",
        "{ shape?: 3 }",
        "{ id: string; shape?: 3 }",
        "{ id: string; extra?: string }",
        "{ id: string; both?: 1 }",
        "{ id: string; onlyA?: 2 }",
        "{ id: string; toString?(): 1 }",
        "typeof literal",
        "typeof literal & { extra: 1 }",
        "typeof wider",
      ];
      const compared = targets.map((target, i) => `  const t${i}: ${target} = null! as S<U>;`).join("\n");
      return `
interface A { id: string; shape?: 1; both: 1; onlyA: 1; toString(): "a" }
interface B { id: string; shape?: 2; both: 2 }
type Members = A | B${each(count - 2, i => ` | { id: string; shape?: 1; both: 1; m${i}?: ${i} }`, "")};
type Indexed = (A & Record<string, unknown>) | (B & Record<string, unknown>)${each(count - 2, i => ` | { [name: string]: unknown; id: string; shape?: 1; both: 1; m${i}?: ${i} }`, "")};
type S<U> = U & { extra: 1 };
let literal = { id: "", extra: 1 as const };
let wider = { id: "", extra: 1 as const, shape: 1 as 1 | 2 | undefined, both: 1 as 1 | 2 };
function plain<U extends Members>() {
${compared}
}
function indexed<U extends Indexed>() {
${compared}
}
function one<U extends A>() {
${compared}
}
export {};
`;
    },
    errors: `
(11,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; } & { extra: string; }'.
  Type 'S<U>' is not assignable to type '{ extra: string; }'.
(12,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; } & { shape?: 3 | undefined; }'.
  Type 'S<U>' is not assignable to type '{ shape?: 3 | undefined; }'.
(15,9): error TS2322: Type 'S<U>' is not assignable to type '{ both: 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ both: 1; }'.
(16,9): error TS2322: Type 'S<U>' is not assignable to type '{ onlyA: 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ onlyA: 1; }'.
(17,9): error TS2322: Type 'S<U>' is not assignable to type '{ onlyA?: 1 | undefined; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ onlyA?: 1 | undefined; }'.
(18,9): error TS2322: Type 'S<U>' is not assignable to type '{ none: 1; nor: 2; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ none: 1; nor: 2; }'.
(20,9): error TS2322: Type 'S<U>' is not assignable to type '{ toString(): number; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ toString(): number; }'.
(22,9): error TS2322: Type 'S<U>' is not assignable to type '{ valueOf(): 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ valueOf(): 1; }'.
(24,9): error TS2322: Type 'S<U>' is not assignable to type '{ shape?: 3 | undefined; }'.
(25,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; shape?: 3 | undefined; }'.
(26,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra?: string | undefined; }'.
  Types of property 'extra' are incompatible.
    Type 'number' is not assignable to type 'string'.
(27,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; both?: 1 | undefined; }'.
(28,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; onlyA?: 2 | undefined; }'.
(29,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; toString?(): 1; }'.
(30,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra: 1; }'.
(31,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra: 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ id: string; extra: 1; }'.
(32,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra: 1; shape: 1 | 2 | undefined; both: 1 | 2; }'.
(36,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; } & { extra: string; }'.
  Type 'S<U>' is not assignable to type '{ extra: string; }'.
(37,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; } & { shape?: 3 | undefined; }'.
  Type 'S<U>' is not assignable to type '{ shape?: 3 | undefined; }'.
(40,9): error TS2322: Type 'S<U>' is not assignable to type '{ both: 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ both: 1; }'.
(41,9): error TS2322: Type 'S<U>' is not assignable to type '{ onlyA: 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ onlyA: 1; }'.
(42,9): error TS2322: Type 'S<U>' is not assignable to type '{ onlyA?: 1 | undefined; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ onlyA?: 1 | undefined; }'.
(43,9): error TS2322: Type 'S<U>' is not assignable to type '{ none: 1; nor: 2; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ none: 1; nor: 2; }'.
(45,9): error TS2322: Type 'S<U>' is not assignable to type '{ toString(): number; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ toString(): number; }'.
(47,9): error TS2322: Type 'S<U>' is not assignable to type '{ valueOf(): 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ valueOf(): 1; }'.
(49,9): error TS2322: Type 'S<U>' is not assignable to type '{ shape?: 3 | undefined; }'.
(50,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; shape?: 3 | undefined; }'.
(51,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra?: string | undefined; }'.
  Types of property 'extra' are incompatible.
    Type 'number' is not assignable to type 'string'.
(52,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; both?: 1 | undefined; }'.
(53,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; onlyA?: 2 | undefined; }'.
(54,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; toString?(): 1; }'.
(55,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra: 1; }'.
(56,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra: 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ id: string; extra: 1; }'.
(57,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra: 1; shape: 1 | 2 | undefined; both: 1 | 2; }'.
(61,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; } & { extra: string; }'.
  Type 'S<U>' is not assignable to type '{ extra: string; }'.
    Types of property 'extra' are incompatible.
      Type 'number' is not assignable to type 'string'.
(62,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; } & { shape?: 3 | undefined; }'.
  Type 'S<U>' is not assignable to type '{ shape?: 3 | undefined; }'.
    Types of property 'shape' are incompatible.
      Type '1 | undefined' is not assignable to type '3 | undefined'.
        Type '1' is not assignable to type '3'.
(68,9): error TS2322: Type 'S<U>' is not assignable to type '{ none: 1; nor: 2; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ none: 1; nor: 2; }'.
    Type 'A & { extra: 1; }' is missing the following properties from type '{ none: 1; nor: 2; }': none, nor
(70,9): error TS2322: Type 'S<U>' is not assignable to type '{ toString(): number; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ toString(): number; }'.
    The types returned by 'toString()' are incompatible between these types.
      Type 'string' is not assignable to type 'number'.
(72,9): error TS2322: Type 'S<U>' is not assignable to type '{ valueOf(): 1; } & { extra: 1; }'.
  Type 'S<U>' is not assignable to type '{ valueOf(): 1; }'.
    The types returned by 'valueOf()' are incompatible between these types.
      Type 'Object' is not assignable to type '1'.
(74,9): error TS2322: Type 'S<U>' is not assignable to type '{ shape?: 3 | undefined; }'.
  Types of property 'shape' are incompatible.
    Type '1 | undefined' is not assignable to type '3 | undefined'.
      Type '1' is not assignable to type '3'.
(75,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; shape?: 3 | undefined; }'.
  Types of property 'shape' are incompatible.
    Type '1 | undefined' is not assignable to type '3 | undefined'.
      Type '1' is not assignable to type '3'.
(76,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra?: string | undefined; }'.
  Types of property 'extra' are incompatible.
    Type 'number' is not assignable to type 'string'.
(78,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; onlyA?: 2 | undefined; }'.
  Types of property 'onlyA' are incompatible.
    Type '1' is not assignable to type '2'.
(79,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; toString?(): 1; }'.
  The types returned by 'toString()' are incompatible between these types.
    Type '"a"' is not assignable to type '1'.
(82,9): error TS2322: Type 'S<U>' is not assignable to type '{ id: string; extra: 1; shape: 1 | 2 | undefined; both: 1 | 2; }'.
  Property 'shape' is optional in type 'A & { extra: 1; }' but required in type '{ id: string; extra: 1; shape: 1 | 2 | undefined; both: 1 | 2; }'.
`,
  },
  "repeated intersections of the same object types and one more": {
    // The number of object types that have each name.
    sizes: [2, 3, 4, 5, 12],
    program: count => `
${each(count, i => `interface H${i} { kind: "k"; same: string; n?: number; h${i}?: 1; ${filler(4, `h${i}_`)} }`, " ")}
${each(count, i => `interface T${i}<K> { kind: K; same: string; t${i}?: K; ${filler(4, `t${i}_`)} }`, " ")}
${each(count, i => `declare class G${i} { get v(): 1; set v(x: 1 | ${i + 2}); get r(): "r"; g${i}: 1; ${filler(4, `g${i}_`)} }`, " ")}
${each(count, i => `declare const o${i}: { kind: "k"; lit: ${i % 2}; ${filler(4, `o${i}_`)} };`, " ")}
interface Big { kind: "k"; same: string; ${filler(8, "b")} }
type All = ${each(count, i => `H${i}`, " & ")};
type Tags<K> = ${each(count, i => `T${i}<K>`, " & ")};
type Mixed<K> = ${each(count, i => `T${i}<${i === 1 ? "K" : '"k"'}>`, " & ")};
type Accessors = ${each(count, i => `G${i}`, " & ")};
type Picked = ${each(count, i => `Pick<Big & { p${i}?: 1 }, "kind" | "same" | "p${i}" | "b${i % 8}">`, " & ")};
type Optional = ${each(count, i => `Partial<H${i}>`, " & ")};
type Spread = ${each(count, i => `typeof o${i}`, " & ")};
type IsNever<T> = [T] extends [never] ? true : false;
type Deep<T> = { at: IsNever<All & { theme: T }>; tags: IsNever<Tags<T> & { theme: T }>; of: (All & { theme: T })["kind"] };
${reads(
  "all",
  four(i => `(null! as All & { theme: ${i} }).theme`),
)}
${reads(
  "tags",
  ["k", "k", "j", "k"].map((k, i) => `(null! as Tags<"${k}"> & { theme: ${i} }).kind`),
)}
${reads(
  "mixed",
  ["k", "j", "k", "j"].map((k, i) => `null! as IsNever<Mixed<"${k}"> & { theme: ${i} }>`),
)}
${reads(
  "accessors",
  four(i => `(null! as Accessors & { theme: ${i} }).v`),
)}
${reads(
  "picked",
  four(i => `(null! as Picked & { theme: ${i} }).kind`),
)}
${reads(
  "optional",
  four(i => `(null! as Optional & { theme: ${i} }).kind`),
)}
${reads(
  "spread",
  four(i => `null! as IsNever<Spread & { theme: ${i} }>`),
)}
${reads(
  "deep",
  four(i => `null! as Deep<${i}>[keyof Deep<${i}>]`),
)}
function generic<T extends string, K extends "k" | "j">() {
${reads(
  "g",
  ["T", "T[]", "K", "[K]"].flatMap(t => [
    `(null! as All & { theme: ${t} }).theme`,
    `(null! as Tags<K> & { theme: ${t} }).kind`,
  ]),
)}
${reads(
  "v",
  ["T", "K", "T", "K"].map(
    t =>
      `(null! as ${each(count, i => `{ p: ${i ? "string" : t}; q${i}?: 1; ${filler(4, `q${i}_`)} }`, " & ")} & { theme: ${t} }).p`,
  ),
)}
${reads(
  "d",
  ["T", "K", "T"].flatMap(t => ["at", "tags", "of"].map(name => `(null! as Deep<${t}>).${name}`)),
)}
}
interface Cycle { kind: "k"; same: keyof typeof cyclic }
const cyclic = { same: (null! as All & Cycle).same };
${reads(
  "later",
  four(i => `(null! as All & { theme: [${i}] }).theme`),
)}
${reads(
  "picked_later",
  four(i => `(null! as Picked & { theme: [${i}] }).kind`),
)}
export {};
`,
    errors: `
(16,7): error TS2322: Type '1' is not assignable to type 'never'.
(17,7): error TS2322: Type '2' is not assignable to type 'never'.
(18,7): error TS2322: Type '3' is not assignable to type 'never'.
(19,7): error TS2322: Type '4' is not assignable to type 'never'.
(20,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(21,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(22,7): error TS2322: Type '"j"' is not assignable to type 'never'.
(23,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(24,7): error TS2322: Type 'false' is not assignable to type 'never'.
(25,7): error TS2322: Type 'true' is not assignable to type 'never'.
(26,7): error TS2322: Type 'false' is not assignable to type 'never'.
(27,7): error TS2322: Type 'true' is not assignable to type 'never'.
(28,7): error TS2322: Type '1' is not assignable to type 'never'.
(29,7): error TS2322: Type '1' is not assignable to type 'never'.
(30,7): error TS2322: Type '1' is not assignable to type 'never'.
(31,7): error TS2322: Type '1' is not assignable to type 'never'.
(32,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(33,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(34,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(35,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(36,7): error TS2322: Type '"k" | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(37,7): error TS2322: Type '"k" | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(38,7): error TS2322: Type '"k" | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(39,7): error TS2322: Type '"k" | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(40,7): error TS2322: Type 'true' is not assignable to type 'never'.
(41,7): error TS2322: Type 'true' is not assignable to type 'never'.
(42,7): error TS2322: Type 'true' is not assignable to type 'never'.
(43,7): error TS2322: Type 'true' is not assignable to type 'never'.
(44,7): error TS2322: Type '"k" | false' is not assignable to type 'never'.
  Type '"k"' is not assignable to type 'never'.
(45,7): error TS2322: Type '"k" | false' is not assignable to type 'never'.
  Type '"k"' is not assignable to type 'never'.
(46,7): error TS2322: Type '"k" | false' is not assignable to type 'never'.
  Type '"k"' is not assignable to type 'never'.
(47,7): error TS2322: Type '"k" | false' is not assignable to type 'never'.
  Type '"k"' is not assignable to type 'never'.
(49,7): error TS2322: Type 'T' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(50,7): error TS2322: Type '"j" | "k"' is not assignable to type 'never'.
  Type '"j"' is not assignable to type 'never'.
(51,7): error TS2322: Type 'T[]' is not assignable to type 'never'.
(52,7): error TS2322: Type '"j" | "k"' is not assignable to type 'never'.
  Type '"j"' is not assignable to type 'never'.
(53,7): error TS2322: Type '"j" | "k"' is not assignable to type 'never'.
  Type '"j"' is not assignable to type 'never'.
(54,7): error TS2322: Type '"j" | "k"' is not assignable to type 'never'.
  Type '"j"' is not assignable to type 'never'.
(55,7): error TS2322: Type '[K]' is not assignable to type 'never'.
(56,7): error TS2322: Type '"j" | "k"' is not assignable to type 'never'.
  Type '"j"' is not assignable to type 'never'.
(57,7): error TS2322: Type 'T' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(58,7): error TS2322: Type '"j" | "k"' is not assignable to type 'never'.
  Type '"j"' is not assignable to type 'never'.
(59,7): error TS2322: Type 'T' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(60,7): error TS2322: Type '"j" | "k"' is not assignable to type 'never'.
  Type '"j"' is not assignable to type 'never'.
(61,7): error TS2322: Type 'false' is not assignable to type 'never'.
(62,7): error TS2322: Type 'false' is not assignable to type 'never'.
(63,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(64,7): error TS2322: Type 'false' is not assignable to type 'never'.
(65,7): error TS2322: Type 'false' is not assignable to type 'never'.
(66,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(67,7): error TS2322: Type 'false' is not assignable to type 'never'.
(68,7): error TS2322: Type 'false' is not assignable to type 'never'.
(69,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(71,30): error TS2502: 'same' is referenced directly or indirectly in its own type annotation.
(72,7): error TS7022: 'cyclic' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(73,7): error TS2322: Type '[1]' is not assignable to type 'never'.
(74,7): error TS2322: Type '[2]' is not assignable to type 'never'.
(75,7): error TS2322: Type '[3]' is not assignable to type 'never'.
(76,7): error TS2322: Type '[4]' is not assignable to type 'never'.
(77,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(78,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(79,7): error TS2322: Type '"k"' is not assignable to type 'never'.
(80,7): error TS2322: Type '"k"' is not assignable to type 'never'.
`,
  },
  "a protected property of several members of an intersection that has an alias": {
    sizes: [0],
    program: () => `
class C { protected p = 1; c = 1 }
class E { protected p = 1; e = 1 }
interface I extends C { i: 1 }
interface J extends E { j: 1 }
type N = C & E & { x: 1 };
type O = I & J;
type G<T> = C & E & { x: T };
type M = C & { x: 1 };
declare const n: N, o: O, g: G<1>, u: N | O, direct: C & E;
n.p;
let q: typeof n.p;
n?.p;
n!.p;
n.p = 1;
o.p;
g.p;
u.p;
direct.p;
function f<T extends N>(t: T) { t.p; }
const { p } = n;
({ p: n.c } = n);
class D extends C {
  m(x: N, y: M, z: M | C) {
    x.p;
    y.p;
    z.p;
    const { p } = y;
    ({ p: y.c } = y);
  }
}
export {};
`,
    errors: `
(11,3): error TS2445: Property 'p' is protected and only accessible within class 'C & E & { x: 1; }' and its subclasses.
(12,17): error TS2445: Property 'p' is protected and only accessible within class 'C & E & { x: 1; }' and its subclasses.
(13,4): error TS2445: Property 'p' is protected and only accessible within class 'C & E & { x: 1; }' and its subclasses.
(14,4): error TS2445: Property 'p' is protected and only accessible within class 'C & E & { x: 1; }' and its subclasses.
(15,3): error TS2445: Property 'p' is protected and only accessible within class 'C & E & { x: 1; }' and its subclasses.
(16,3): error TS2445: Property 'p' is protected and only accessible within class 'I & J' and its subclasses.
(17,3): error TS2445: Property 'p' is protected and only accessible within class 'C & E & { x: 1; }' and its subclasses.
(18,3): error TS2445: Property 'p' is protected and only accessible within class 'N | O' and its subclasses.
(19,8): error TS2445: Property 'p' is protected and only accessible within class 'C & E' and its subclasses.
(20,35): error TS2445: Property 'p' is protected and only accessible within class 'C & E & { x: 1; }' and its subclasses.
(21,9): error TS2445: Property 'p' is protected and only accessible within class 'N' and its subclasses.
(22,4): error TS2445: Property 'p' is protected and only accessible within class 'N' and its subclasses.
(25,7): error TS2445: Property 'p' is protected and only accessible within class 'C & E & { x: 1; }' and its subclasses.
(26,7): error TS2446: Property 'p' is protected and only accessible through an instance of class 'D'. This is an instance of class 'C & { x: 1; }'.
(27,7): error TS2446: Property 'p' is protected and only accessible through an instance of class 'D'. This is an instance of class 'C | M'.
(28,13): error TS2446: Property 'p' is protected and only accessible through an instance of class 'D'. This is an instance of class 'M'.
(29,8): error TS2446: Property 'p' is protected and only accessible through an instance of class 'D'. This is an instance of class 'M'.
`,
  },
  "an interface that extends a mapped type over an intersection with itself": {
    sizes: [0],
    program: () => {
      const bases = [
        'Pick<Loop & Big, "b">',
        'Pick<Big & Loop, "b">',
        'Pick<Loop & Big, "b" | "own">',
        'Pick<Both, "b">',
        'P<Loop & Big, "b">',
        "Q<Loop & Big>",
        "Mid",
      ];
      return `
interface Big { a: 1; b: 2; c: 3 }
type P<T, K extends keyof T> = { [X in K]: T[X] };
type Q<T> = { [X in "b"]: 5 } & { z: T };
${bases
  .map(
    (base, n) => `namespace N${n} {
  type Both = Loop & Big;
  interface Mid extends Pick<Loop & Big, "b"> { mid: 1 }
  interface Loop extends ${base} { own: 1 }
  declare const loop: Loop, both: Loop & Big;
  const b: never = loop.b;
  const own: never = loop.own;
  const k: keyof Loop = "zzz";
  const whole: { own: 1; b: 3 } = loop;
  const c: never = both.b;
}`,
  )
  .join("\n")}
namespace First {
  declare const loop: Loop;
  const b: never = loop.b;
  interface Loop extends Pick<Loop & Big, "b"> { own: 1 }
}
export {};
`;
    },
    errors: `
(10,9): error TS2322: Type '2' is not assignable to type 'never'.
(11,9): error TS2322: Type '1' is not assignable to type 'never'.
(12,9): error TS2322: Type '"zzz"' is not assignable to type 'keyof Loop'.
(13,9): error TS2322: Type 'Loop' is not assignable to type '{ own: 1; b: 3; }'.
  Types of property 'b' are incompatible.
    Type '2' is not assignable to type '3'.
(14,9): error TS2322: Type '2' is not assignable to type 'never'.
(18,13): error TS2615: Type of property 'b' circularly references itself in mapped type 'Pick<Big & Loop, "b">'.
(21,9): error TS2322: Type 'any' is not assignable to type 'never'.
(22,9): error TS2322: Type '1' is not assignable to type 'never'.
(23,9): error TS2322: Type '"zzz"' is not assignable to type 'keyof Loop'.
(25,9): error TS2322: Type 'any' is not assignable to type 'never'.
(32,9): error TS2322: Type '2' is not assignable to type 'never'.
(33,9): error TS2322: Type '1' is not assignable to type 'never'.
(34,9): error TS2322: Type '"zzz"' is not assignable to type 'keyof Loop'.
(35,9): error TS2322: Type 'Loop' is not assignable to type '{ own: 1; b: 3; }'.
  Types of property 'b' are incompatible.
    Type '2' is not assignable to type '3'.
(36,9): error TS2322: Type '2' is not assignable to type 'never'.
(40,13): error TS2615: Type of property 'b' circularly references itself in mapped type 'Pick<Both, "b">'.
(43,9): error TS2322: Type 'any' is not assignable to type 'never'.
(44,9): error TS2322: Type '1' is not assignable to type 'never'.
(45,9): error TS2322: Type '"zzz"' is not assignable to type 'keyof Loop'.
(47,9): error TS2322: Type 'any' is not assignable to type 'never'.
(54,9): error TS2322: Type '2' is not assignable to type 'never'.
(55,9): error TS2322: Type '1' is not assignable to type 'never'.
(56,9): error TS2322: Type '"zzz"' is not assignable to type 'keyof Loop'.
(57,9): error TS2322: Type 'Loop' is not assignable to type '{ own: 1; b: 3; }'.
  Types of property 'b' are incompatible.
    Type '2' is not assignable to type '3'.
(58,9): error TS2322: Type '2' is not assignable to type 'never'.
(65,9): error TS2322: Type '5' is not assignable to type 'never'.
(66,9): error TS2322: Type '1' is not assignable to type 'never'.
(67,9): error TS2322: Type '"zzz"' is not assignable to type 'keyof Loop'.
(68,9): error TS2322: Type 'Loop' is not assignable to type '{ own: 1; b: 3; }'.
  Types of property 'b' are incompatible.
    Type '5' is not assignable to type '3'.
(69,9): error TS2322: Type 'any' is not assignable to type 'never'.
(69,25): error TS2339: Property 'b' does not exist on type 'never'.
  The intersection 'Loop & Big' was reduced to 'never' because property 'b' has conflicting types in some constituents.
(76,9): error TS2322: Type '2' is not assignable to type 'never'.
(77,9): error TS2322: Type '1' is not assignable to type 'never'.
(78,9): error TS2322: Type '"zzz"' is not assignable to type 'keyof Loop'.
(79,9): error TS2322: Type 'Loop' is not assignable to type '{ own: 1; b: 3; }'.
  Types of property 'b' are incompatible.
    Type '2' is not assignable to type '3'.
(80,9): error TS2322: Type '2' is not assignable to type 'never'.
(84,9): error TS2322: Type 'any' is not assignable to type 'never'.
(84,20): error TS2615: Type of property 'b' circularly references itself in mapped type 'Pick<Loop & Big, "b">'.
`,
  },
  "a mapped type's property that two keys spell, and copies of it": {
    sizes: [0],
    program: () => `
enum A { x = "k" }
enum B { y = "k" }
declare const twice: { [K in A.x | B.y]: K };
const spread = { ...twice };
const both = { ...twice, ...{ z: 1 } };
const again = { ...spread };
const { ...rest } = twice;
declare const u: typeof twice | { k: 1 };
declare const i: typeof twice & { z: 1 };
type M = { [K in keyof typeof twice]: 1 };
type S = { [K in keyof typeof spread]: 1 };
${reads("keys", [
  "null! as keyof typeof twice",
  "null! as keyof typeof spread",
  "null! as keyof typeof both",
  "null! as keyof typeof again",
  "null! as keyof typeof rest",
  "null! as keyof typeof u",
  "null! as keyof typeof i",
  "null! as keyof M",
  "null! as keyof S",
  "null! as keyof Pick<typeof twice, A.x>",
])}
${reads("values", [
  "spread.k",
  "again.k",
  "(null! as M).k",
  "(null! as S).k",
  "(null! as Readonly<typeof twice>).k",
  "(null! as Partial<typeof spread>).k",
])}
const byString: { [k: string]: 1 } = spread;
const ofMapped: { [k: string]: 1 } = twice;
function f<T>(t: { [K in keyof T]: T[K] }): T { return null!; }
${reads("inferred", ["f(spread)", "f(twice)"])}
for (const key in spread) { const h: never = key; }
export {};
`,
    errors: `
(13,7): error TS2322: Type 'A | B' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(15,7): error TS2322: Type '"z"' is not assignable to type 'never'.
(19,7): error TS2322: Type '"z" | A | B' is not assignable to type 'never'.
  Type '"z"' is not assignable to type 'never'.
(20,7): error TS2322: Type 'A | B' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(22,7): error TS2322: Type 'A' is not assignable to type 'never'.
(23,7): error TS2322: Type 'A | B' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(24,7): error TS2322: Type 'A | B' is not assignable to type 'never'.
  Type 'A' is not assignable to type 'never'.
(25,7): error TS2322: Type 'any' is not assignable to type 'never'.
(25,37): error TS2339: Property 'k' does not exist on type 'M'.
(26,7): error TS2322: Type 'any' is not assignable to type 'never'.
(26,37): error TS2339: Property 'k' does not exist on type 'S'.
(27,7): error TS2322: Type 'any' is not assignable to type 'never'.
(27,58): error TS2339: Property 'k' does not exist on type 'Readonly<{ k: A | B; }>'.
(28,7): error TS2322: Type 'any' is not assignable to type 'never'.
(28,58): error TS2339: Property 'k' does not exist on type 'Partial<{ k: A | B; }>'.
(29,7): error TS2322: Type '{ k: A | B; }' is not assignable to type '{ [k: string]: 1; }'.
  Property 'k' is incompatible with index signature.
    Type 'A | B' is not assignable to type '1'.
      Type 'A' is not assignable to type '1'.
(30,7): error TS2322: Type '{ k: A | B; }' is not assignable to type '{ [k: string]: 1; }'.
  Property 'k' is incompatible with index signature.
    Type 'A | B' is not assignable to type '1'.
      Type 'A' is not assignable to type '1'.
(32,7): error TS2322: Type '{ k: A | B; }' is not assignable to type 'never'.
(33,7): error TS2322: Type '{ k: A | B; }' is not assignable to type 'never'.
(34,35): error TS2322: Type 'string' is not assignable to type 'never'.
`,
  },
  "the index signatures of the modifiers type of a mapped type with readonly, with -readonly and without": {
    sizes: [0],
    program: () => {
      const rows = [
        ["readonly ", "B", "string", '"x"'],
        ["-readonly ", "B", "string", '"x"'],
        ["", "B", "string", '"x"'],
        ["+readonly ", "B", "string", '"x"'],
        ["readonly ", "B | { [k: string]: 1 }", "string", '"x"'],
        ["-readonly ", "B | { readonly [k: string]: 1 }", "string", '"x"'],
        ["", "B | { readonly [k: string]: 1 }", "string", '"x"'],
        ["readonly ", "B", '"a"', '"a"'],
        ["readonly ", "B", "number", "0"],
        ["readonly ", "B & { z: 1 }", "string", '"x"'],
        ["", "B & { readonly [k: string]: 1 }", "string", '"x"'],
      ];
      return (
        rows
          .map(
            ([modifier, modifiers, keys, key], n) => `
namespace N${n} {
  const shapes = { circle: (null! as RP<${modifiers}, ${keys}>)[${key}] };
  type RP<T, K extends keyof T> = { ${modifier}[P in K]: 1 };
  interface Base<T> { [k: string]: 1 }
  interface B extends Base<typeof shapes> {}
  interface Plain { [k: string]: 1 }
  declare const written: RP<${modifiers.replace(/\bB\b/, "Plain")}, ${keys}>;
  written[${key}] = 1;
}`,
          )
          .join("") + "\nexport {};\n"
      );
    },
    errors: `
(3,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(6,13): error TS2310: Type 'B' recursively references itself as a base type.
(9,3): error TS2542: Index signature in type 'RP<Plain, string>' only permits reading.
(12,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(15,13): error TS2310: Type 'B' recursively references itself as a base type.
(21,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(24,13): error TS2310: Type 'B' recursively references itself as a base type.
(30,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(33,13): error TS2310: Type 'B' recursively references itself as a base type.
(36,3): error TS2542: Index signature in type 'RP<Plain, string>' only permits reading.
(39,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(42,13): error TS2310: Type 'B' recursively references itself as a base type.
(45,3): error TS2542: Index signature in type 'RP<Plain | { [k: string]: 1; }, string>' only permits reading.
(48,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(51,13): error TS2310: Type 'B' recursively references itself as a base type.
(57,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(60,13): error TS2310: Type 'B' recursively references itself as a base type.
(63,3): error TS2542: Index signature in type 'RP<Plain | { readonly [k: string]: 1; }, string>' only permits reading.
(66,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(69,13): error TS2310: Type 'B' recursively references itself as a base type.
(72,11): error TS2540: Cannot assign to 'a' because it is a read-only property.
(75,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(78,13): error TS2310: Type 'B' recursively references itself as a base type.
(81,3): error TS2542: Index signature in type 'RP<Plain, number>' only permits reading.
(84,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(87,13): error TS2310: Type 'B' recursively references itself as a base type.
(90,3): error TS2542: Index signature in type 'RP<Plain & { z: 1; }, string>' only permits reading.
(93,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(96,13): error TS2310: Type 'B' recursively references itself as a base type.
`,
  },
  "a mapped type with readonly or -readonly requests a union's index signatures": {
    sizes: [0],
    program: () => {
      const rows = [
        ["readonly ", "B"],
        ["-readonly ", "B"],
        ["", "B"],
        ["readonly ", "B | { [k: string]: 1 }"],
        ["-readonly ", "B | { readonly [k: string]: 1 }"],
        ["", "B | { readonly [k: string]: 1 }"],
        ["readonly ", "B & { z: 1 }"],
        ["-readonly ", "B & { z: 1 }"],
      ];
      // The type isn't written in the initializer, where its type arguments would be checked against their constraints.
      const forms = [
        (type: string) => `const shapes = { circle: v["x"] };\n  declare const v: ${type};`,
        (type: string) => `const shapes = { circle: (null! as V)["x"] };\n  type V = ${type};`,
        (type: string) => `const shapes = { circle: make()["x"] };\n  declare function make(): ${type};`,
      ];
      return (
        forms
          .flatMap(form => rows.map(([modifier, modifiers]) => [modifier, form(`RP<${modifiers}, string>`)]))
          .map(
            ([modifier, uses], n) => `
namespace N${n} {
  ${uses}
  type RP<T, K extends keyof T> = { ${modifier}[P in K]: 1 };
  interface Base<T> { [k: string]: 1 }
  interface B extends Base<typeof shapes> {}
}`,
          )
          .join("") + "\nexport {};\n"
      );
    },
    errors: `
(3,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(7,13): error TS2310: Type 'B' recursively references itself as a base type.
(10,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(14,13): error TS2310: Type 'B' recursively references itself as a base type.
(17,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(21,13): error TS2310: Type 'B' recursively references itself as a base type.
(24,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(28,13): error TS2310: Type 'B' recursively references itself as a base type.
(31,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(35,13): error TS2310: Type 'B' recursively references itself as a base type.
(38,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(42,13): error TS2310: Type 'B' recursively references itself as a base type.
(45,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(49,13): error TS2310: Type 'B' recursively references itself as a base type.
(52,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(56,13): error TS2310: Type 'B' recursively references itself as a base type.
(59,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(63,13): error TS2310: Type 'B' recursively references itself as a base type.
(66,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(70,13): error TS2310: Type 'B' recursively references itself as a base type.
(73,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(77,13): error TS2310: Type 'B' recursively references itself as a base type.
(80,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(84,13): error TS2310: Type 'B' recursively references itself as a base type.
(87,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(91,13): error TS2310: Type 'B' recursively references itself as a base type.
(94,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(98,13): error TS2310: Type 'B' recursively references itself as a base type.
(101,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(105,13): error TS2310: Type 'B' recursively references itself as a base type.
(108,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(112,13): error TS2310: Type 'B' recursively references itself as a base type.
(115,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(119,13): error TS2310: Type 'B' recursively references itself as a base type.
(122,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(126,13): error TS2310: Type 'B' recursively references itself as a base type.
(129,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(133,13): error TS2310: Type 'B' recursively references itself as a base type.
(136,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(140,13): error TS2310: Type 'B' recursively references itself as a base type.
(143,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(147,13): error TS2310: Type 'B' recursively references itself as a base type.
(150,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(154,13): error TS2310: Type 'B' recursively references itself as a base type.
(157,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(161,13): error TS2310: Type 'B' recursively references itself as a base type.
(164,9): error TS7022: 'shapes' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(168,13): error TS2310: Type 'B' recursively references itself as a base type.
`,
  },
  "a call reached again, through a property's type, while it's being resolved for the second time": {
    sizes: [0],
    program: () => {
      const types = [
        "{ a?: 1 } & Partial<T> & T",
        "{ a?: 1 } & T & Partial<T> & Required<T>",
        "T & Partial<T>",
        "T & Partial<T> & Readonly<T>",
        "T & { a?: 1 }",
      ];
      const bodies = [
        (type: string) => `return register((x satisfies (${type}) | null | undefined)!);`,
        () => "return register(x!);",
        () => "return x!;",
      ];
      const programs = types
        .flatMap(type => bodies.flatMap(body => [true, false].map(first => [type, body(type), first] as const)))
        .map(([type, body, isFunctionFirst], n) => {
          const load = `function load${n}<T extends Page${n} | Link${n}>(x: (${type}) | undefined) { ${body} }`;
          const routes = `const routes${n} = { home: load${n}(given) };`;
          return `
${isFunctionFirst ? load : routes}
${isFunctionFirst ? routes : load}
interface Page${n} { id: string; title?: string }
interface Link${n} { id: string; to?: keyof typeof routes${n} }`;
        });
      return `
declare function register(entry: { id: string }): number;
declare const given: { id: string; title?: string };${programs.join("")}\nexport {};\n`;
    },
    errors: `
(29,31): error TS2345: Argument of type '{ id: string; title?: string | undefined; }' is not assignable to parameter of type '{ a?: 1 | undefined; } & { id: string; title?: string | undefined; } & Partial<{ id: string; title?: string | undefined; }> & Required<{ id: string; title?: string | undefined; }>'.
  Type '{ id: string; title?: string | undefined; }' is not assignable to type 'Required<{ id: string; title?: string | undefined; }>'.
    Types of property 'title' are incompatible.
      Type 'string | undefined' is not assignable to type 'string'.
        Type 'undefined' is not assignable to type 'string'.
(32,31): error TS2345: Argument of type '{ id: string; title?: string | undefined; }' is not assignable to parameter of type '{ a?: 1 | undefined; } & { id: string; title?: string | undefined; } & Partial<{ id: string; title?: string | undefined; }> & Required<{ id: string; title?: string | undefined; }>'.
  Type '{ id: string; title?: string | undefined; }' is not assignable to type 'Required<{ id: string; title?: string | undefined; }>'.
    Types of property 'title' are incompatible.
      Type 'string | undefined' is not assignable to type 'string'.
        Type 'undefined' is not assignable to type 'string'.
(37,31): error TS2345: Argument of type '{ id: string; title?: string | undefined; }' is not assignable to parameter of type '{ a?: 1 | undefined; } & { id: string; title?: string | undefined; } & Partial<{ id: string; title?: string | undefined; }> & Required<{ id: string; title?: string | undefined; }>'.
  Type '{ id: string; title?: string | undefined; }' is not assignable to type 'Required<{ id: string; title?: string | undefined; }>'.
    Types of property 'title' are incompatible.
      Type 'string | undefined' is not assignable to type 'string'.
        Type 'undefined' is not assignable to type 'string'.
(40,31): error TS2345: Argument of type '{ id: string; title?: string | undefined; }' is not assignable to parameter of type '{ a?: 1 | undefined; } & { id: string; title?: string | undefined; } & Partial<{ id: string; title?: string | undefined; }> & Required<{ id: string; title?: string | undefined; }>'.
  Type '{ id: string; title?: string | undefined; }' is not assignable to type 'Required<{ id: string; title?: string | undefined; }>'.
    Types of property 'title' are incompatible.
      Type 'string | undefined' is not assignable to type 'string'.
        Type 'undefined' is not assignable to type 'string'.
(45,33): error TS2345: Argument of type '{ id: string; title?: string | undefined; }' is not assignable to parameter of type '{ a?: 1 | undefined; } & { id: string; title?: string | undefined; } & Partial<{ id: string; title?: string | undefined; }> & Required<{ id: string; title?: string | undefined; }>'.
  Type '{ id: string; title?: string | undefined; }' is not assignable to type 'Required<{ id: string; title?: string | undefined; }>'.
    Types of property 'title' are incompatible.
      Type 'string | undefined' is not assignable to type 'string'.
        Type 'undefined' is not assignable to type 'string'.
(48,7): error TS7022: 'routes11' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(48,33): error TS2345: Argument of type '{ id: string; title?: string | undefined; }' is not assignable to parameter of type '{ a?: 1 | undefined; } & { id: string; title?: string | undefined; } & Partial<{ id: string; title?: string | undefined; }> & Required<{ id: string; title?: string | undefined; }>'.
  Type '{ id: string; title?: string | undefined; }' is not assignable to type 'Required<{ id: string; title?: string | undefined; }>'.
    Types of property 'title' are incompatible.
      Type 'string | undefined' is not assignable to type 'string'.
        Type 'undefined' is not assignable to type 'string'.
(51,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(72,7): error TS7022: 'routes17' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(75,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(76,10): error TS7023: 'load18' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(77,7): error TS7022: 'routes18' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(79,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(80,7): error TS7022: 'routes19' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(81,10): error TS7023: 'load19' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(83,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(85,7): error TS7022: 'routes20' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(87,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(88,7): error TS7022: 'routes21' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(89,10): error TS7023: 'load21' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
(91,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(93,7): error TS7022: 'routes22' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(95,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
(96,7): error TS7022: 'routes23' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
(99,32): error TS2502: 'to' is referenced directly or indirectly in its own type annotation.
`,
  },
};

const bySize = { ...members, ...reduced };

test.concurrent.each(Object.keys(bySize))("reports the same errors at any size and thread count: %s", async title => {
  const { sizes, program, errors } = bySize[title];
  using dir = tempDir("bun-check-members", {
    "tsconfig.json": tsconfig,
    ...Object.fromEntries(sizes.map(size => [`size${size}.ts`, program(size)])),
  });
  const root = String(dir);
  const expected = Object.fromEntries(sizes.map(size => [`size${size}.ts`, errors.trim().split("\n")]));
  const runs = [1, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root));
  for (const lines of await Promise.all(runs)) {
    const found = Object.entries(byFile(lines)).map(([file, about]) => [file, about.map(it => it.replace(file, ""))]);
    expect(Object.fromEntries(found)).toEqual(expected);
  }
});

const membersOfAnotherFile = {
  "shared.ts": `
export type Keys = "first" | ${each(200, i => `"k${i}"`)} | "last";
export type M = { [K in Keys]: { key: K } };
export type Pair<T> = { [K in Keys]: [K, T] };
export interface Heir extends M { own: 1 }
export interface Props { a: 1; self(): this; ${filler(40)} }
export type Both = Props & M;
export type With<T> = Props & Pair<T> & { with: T };
`,
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => {
      const values = [
        `(null! as M).k${i}`,
        `(null! as Pair<${i % 3}>).last`,
        `(null! as Heir).k${i + 1}`,
        `(null! as Both).k${i}`,
        `(null! as Both).f${i}`,
        `(null! as Both).self().k${i % 2}`,
        `(null! as With<${i % 2}>).k${i}`,
        `(null! as With<${i % 2}>).with`,
      ];
      // Every fourth file enumerates the properties that the others look up by name.
      if (i % 4 === 3) {
        values.push("null! as Exclude<keyof Both, `k${number}` | `f${number}`>", "{ ...(null! as With<1>) }.first");
      }
      return [`user${i}.ts`, `import type { Both, Heir, M, Pair, With } from "./shared";\n${reads("r", values)}\n`];
    }),
  ),
};

test.concurrent.skipIf(!tsc)("matches tsc on members of another file's types on any thread count", async () => {
  using dir = tempDir("bun-check-members", { "tsconfig.json": tsconfig, ...membersOfAnotherFile });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  expect(Object.keys(byFile(theirs)).length).toBe(12);
  for (const lines of ours) expect(byFile(lines)).toEqual(byFile(theirs));
});

// The file checked first decides where the cycle is entered: at the property, at the function or at the constant.
test.concurrent(
  "accepts a table, its entry types and the function that builds the entries in three files, in any file order",
  async () => {
    const orders = ["abc", "acb", "bac", "bca", "cab", "cba"];
    const types = [
      "T & Partial<T>",
      "T & Readonly<T>",
      "T & { [K in keyof T]: T[K] }",
      "{ draft?: boolean } & T & Partial<T>",
    ];
    const files = orders.flatMap(order =>
      types.flatMap((type, n) => {
        const [entries, helper, table] = [...order].map(letter => `${order}${n}${letter}`);
        return [
          [
            `${entries}.ts`,
            `import type { routes } from "./${table}";
export interface Page { id: string; title?: string }
export interface Link { id: string; to?: keyof typeof routes }
export type Entry = Page | Link;
`,
          ],
          [
            `${helper}.ts`,
            `import type { Entry } from "./${entries}";
declare function register(entry: { id: string }): number;
export function load<T extends Entry>(x: (${type}) | undefined) { return register(x!); }
`,
          ],
          [
            `${table}.ts`,
            `import { load } from "./${helper}";
declare const page: { id: string; title?: string };
export const routes = { home: load(page) };
`,
          ],
        ];
      }),
    );
    using dir = tempDir("bun-check-table", {
      "tsconfig.json": tsconfig,
      "wrong.ts": `export const wrong: number = "";\n`,
      ...Object.fromEntries(files),
    });
    const root = String(dir);
    const runs = [1, 1, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root));
    for (const lines of await Promise.all(runs)) {
      expect(Object.keys(byFile(lines))).toEqual(["wrong.ts"]);
    }
  },
);

// An imported file comes before its importer, so the table is checked first here, and entered from there the cycle is
// an error.
test.concurrent("reports a cycle through three files the same way in 1 and in 60 folders of one project", async () => {
  const files = {
    "a.ts": `import type { Entry } from "./c";
declare function register(entry: { id: string }): number;
export function load<T extends Entry>(x: (T & Partial<T>) | undefined) { return x!; }
`,
    "b.ts": `import { load } from "./a";
declare const given: any;
export const routes = { home: load(given) };
`,
    "c.ts": `import type { routes } from "./b";
export interface Page { id: string; title?: string }
export interface Link { id: string; to?: keyof typeof routes }
export type Entry = Page | Link;
`,
  };
  for (const count of [1, 60]) {
    const folders = Array.from({ length: count }, (_, i) => `k${i}`);
    using dir = tempDir("bun-check-folders", {
      "tsconfig.json": tsconfig,
      ...Object.fromEntries(
        folders.flatMap(folder => Object.entries(files).map(([name, text]) => [`${folder}/${name}`, text])),
      ),
    });
    const root = String(dir);
    const lines = await linesOf([bunExe(), "check", "--threads", "1"], root, root);
    const errors = lines.flatMap(
      line => /^(k\d+)[\\/](\w+\.ts)\(\d+,\d+\): error (TS\d+)/.exec(line)?.slice(1, 4).join(" ") ?? [],
    );
    expect(errors.sort()).toEqual(folders.flatMap(folder => [`${folder} b.ts TS7022`, `${folder} c.ts TS2502`]).sort());
  }
});

// A new union or intersection derives its flags from its constituents, up to 7 of which are stored inline in the type.
// Here they come from another file or from the requesting file, and they're object types, mapped types with and without
// a type variable, intersections that are and aren't `never`, `null` and `undefined`, and fresh and regular literal
// types.
const constituentsOfAnotherFile = (count: number) => `
${each(count, i => `export interface P${i} { kind: ${i}; p${i}: string; all: ${i % 2 ? "string" : "number"} }`, "\n")}
${each(count, i => `export interface Q${i} { q${i}: ${i} }`, "\n")}
export type Copy<T> = { [K in keyof T]: T[K] };
export type Plain = ${each(count, i => `P${i}`)};
export type OrNothing = Plain | null | undefined;
export type Both = ${each(count, i => `Q${i}`, " & ")};
export type Reduced = ${each(count, i => (i === 1 ? "(P0 & P1)" : i === 2 ? "(P2 & Q2)" : `P${i}`))};
export type Literals = ${each(count, i => (i % 2 ? `"s${i}"` : `${i}`))};
`;
const constituentsOfThisFile = (count: number, n: number) => `
import type { Both, Copy, Literals, OrNothing, Plain, Reduced, ${each(count, i => `P${i}, Q${i}`, ", ")} } from "./shared${count}";
const plain${n}: never = null! as Plain;
const orNothing${n}: never = null! as OrNothing;
const both${n}: never = null! as Both;
const reduced${n}: never = null! as Reduced;
const kinds${n}: never = (null! as Reduced).kind;
const own${n}: never = null! as ${each(count, i => `{ own${n}: ${i} }`)};
const ownBoth${n}: never = null! as ${each(count, i => `{ own${i}: ${n} }`, " & ")};
const mixed${n}: never = null! as Plain | { own: ${n} } | (Q0 & { own: ${n} });
function generic${n}<T, U extends Plain>(mapped: Copy<T> & Both, closed: Copy<P0> & Both, u: U | Plain, t: T | OrNothing) {
  const a: never = mapped.q0;
  const b: never = closed.p0;
  const c: never = mapped;
  const d: never = closed;
  const e: never = u;
  const f: never = t;
  const g: never = null! as keyof (Copy<T> & Both);
  const h: never = null! as keyof (Copy<P0> & Both);
}
let widened${n} = [${each(count, i => (i === 0 ? "null" : i === 1 ? "undefined" : i === 2 ? `{ a: ${n} }` : i === 3 ? "[]" : `${i}`), ", ")}];
const widenedIs${n}: never = widened${n};
let literal${n} = null! as Literals;
const fresh${n} = [${each(count, i => (i % 2 ? `"s${i}"` : `${i}`), ", ")}] as const;
let element${n} = fresh${n}[null! as number];
const elementIs${n}: never = element${n};
const literalIs${n}: never = literal${n};
declare function pick${n}<T>(...values: T[]): T;
const picked${n}: never = pick${n}(${each(count, i => `null! as P${i}`, ", ")});
const pickedOwn${n}: never = pick${n}(${each(count, i => `{ v: ${i}, w: null }`, ", ")});
export {};
`;

test.concurrent.skipIf(!tsc)("matches tsc on 2 to 9 constituents from this file and from another", async () => {
  const sizes = [2, 7, 8, 9];
  using dir = tempDir("bun-check-constituents", {
    "tsconfig.json": tsconfig,
    ...Object.fromEntries(sizes.map(size => [`shared${size}.ts`, constituentsOfAnotherFile(size)])),
    ...Object.fromEntries(
      sizes.flatMap(size => [0, 1].map(n => [`user${size}_${n}.ts`, constituentsOfThisFile(size, n)])),
    ),
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  const errors = Object.values(byFile(theirs)).map(about => about.filter(it => /^\w+\.ts\(/.test(it)).length);
  expect(errors).toEqual(sizes.flatMap(() => [22, 22]));
  for (const lines of ours) expect(byFile(lines)).toEqual(byFile(theirs));
});

// A type mapper keeps its pairs in the order the type parameters were created in. Here the first type parameter's
// constraint is the last one, so that one is created first, and the pairs, which are built in declaration order, have
// to be sorted. Up to 8 of them are sorted without an allocation.
const parametersOutOfOrder = (count: number) => `
declare function last<${each(count, i => (i === 0 ? `T0 extends T${count - 1}` : `T${i}`), ", ")}>(${each(count, i => `t${i}: T${i}`, ", ")}): [${each(count, i => `T${count - 1 - i}`, ", ")}];
const a: never = last(${each(count, i => (i % 2 ? `"s${i}"` : `${i}`), ", ")});
class Chain<${each(count, i => (i === 0 ? `T0 extends T${count - 1}` : `T${i}`), ", ")}> {
  constructor(${each(count, i => `public t${i}: T${i}`, ", ")}) {}
  turn(): Chain<${each(count, i => (i === 0 ? `T${count - 1}` : i === count - 1 ? "T0" : `T${i}`), ", ")}> { return null!; }
  pair<U extends T${count - 1}>(u: U): [U, ${each(count, i => `T${i}`, ", ")}] { return null!; }
}
const b: never = new Chain(${each(count, i => `${i}`, ", ")}).turn();
const c: never = new Chain(${each(count, i => `${i} as number`, ", ")}).pair(1);
type Swap<${each(count, i => `T${i}`, ", ")}> = { ${each(count, i => `k${i}: T${count - 1 - i}`, "; ")} };
type Twice<${each(count, i => `T${i}`, ", ")}> = Swap<${each(count, i => `T${count - 1 - i}`, ", ")}>;
const d: never = null! as Twice<${each(count, i => `${i}`, ", ")}>["k0"];
const e: never = null! as Swap<${each(count, i => `${i}`, ", ")}>["k0"];
export {};
`;

test.concurrent.skipIf(!tsc)(
  "matches tsc on 2 to 21 type parameters that aren't created in declaration order",
  async () => {
    const sizes = [2, 3, 4, 8, 9, 21];
    using dir = tempDir("bun-check-mappers", {
      "tsconfig.json": tsconfig,
      ...Object.fromEntries(sizes.map(size => [`params${size}.ts`, parametersOutOfOrder(size)])),
    });
    const root = String(dir);
    const [theirs, ...ours] = await Promise.all([
      linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
      ...[1, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
    ]);
    expect(Object.keys(byFile(theirs)).length).toBe(sizes.length);
    for (const lines of ours) expect(byFile(lines)).toEqual(byFile(theirs));
  },
);

// A theme's style rules: an indexed access by a type parameter into an interface of `count` props types, each an
// intersection, intersected with `Record<string, unknown>` and with object types that share none, one or all of their
// names. One of the props types has its own `ownerState` and `theme`.
const themed = (count: number) => `
interface Common { className?: string; style?: { color?: string }; children?: unknown }
interface Html { id?: string; kind?: string; title?: string; hidden?: boolean; className?: string }
${each(count, i => `interface Own${i} { variant?: "v${i}" | "w"; size${i}?: ${i}; kind: "k${i}"; classes?: { root${i}?: string }${i === 1 ? "; ownerState?: { open?: boolean }; theme?: A" : ""} }`, " ")}
${each(count, i => `type Props${i} = Own${i} & Common & Omit<Html, keyof Own${i} | keyof Common>;`, " ")}
interface List { ${each(count, i => `C${i}: Props${i};`, " ")} }
type Primitive = string | number | null | undefined;
interface Fn<P> { (props: P): Interpolation<P> }
interface Variants<P> { color?: string; variants?: Array<{ props: Partial<P> | ((props: Partial<P> & { ownerState: Partial<P> }) => boolean); style: Primitive | ((props: Omit<P, "theme">) => Primitive) }> }
type Interpolation<P> = Primitive | Variants<P> | Fn<P> | Interpolation<P>[];
type Rules<ClassKey extends string = string, Name = keyof List, Theme = unknown, Extra = {}> = Record<ClassKey, Interpolation<(Name extends keyof List ? List[Name] & Record<string, unknown> & { ownerState: List[Name] & Record<string, unknown> } : {}) & { theme: Theme } & Extra & Record<string, unknown>>>;
type Overrides<Theme = unknown> = { [Name in keyof List]?: Partial<Rules<"root" | "label", Name, Theme>> };
interface Components<Theme = unknown> { ${each(count, i => `C${i}?: { defaultProps?: Partial<List["C${i}"]>; styleOverrides?: Overrides<Theme>["C${i}"] };`, " ")} }
interface A { a: 1 }
interface B extends A { b: 2 }
class Private { private kind = "k0" as const }
class Protected { protected kind = "k0" as const }
declare const first: Components<A>;
declare const second: Components<A>;
declare const third: Components<B>;
const spread = { ...first, ...second };
const mixed = { ...first, ...third };
const c0: Components<A> = spread;
const c1: Components<B> = spread;
const c2: Components<A> = mixed;
const c3: Components<B> = mixed;
const r0: Rules<"root", "C0", A> = null! as Rules<"root", "C0", B>;
const r1: Rules<"root", "C0", B> = null! as Rules<"root", "C0", A>;
const r2: Rules<"root", "C0", A> = null! as Rules<"root", "C1", A>;
const r3: Rules<"root", keyof List, A> = null! as Rules<"root", "C1", A>;
const r4: Rules<"root", "C1", A> = null! as Rules<"root", keyof List, A>;
const r5: Rules<"root" | "label", "C1", A> = null! as Rules<"root", "C1", A>;
const r6: Rules<"root", "C1", A> = null! as Rules<"root" | "label", "C1", A>;
const e0: Rules<"root", "C0", A, { className?: string }> = null! as Rules<"root", "C0", A, { className?: number }>;
const e1: Rules<"root", "C0", A, { kind: "k0" }> = null! as Rules<"root", "C0", A, { kind: "k1" }>;
const e2: Rules<"root", "C0", A, { kind: "k1" }> = null! as Rules<"root", "C0", A, { kind: "k0" }>;
const e3: Rules<"root", keyof List, A, { kind: "k1" }> = null! as Rules<"root", "C1", A>;
const e4: Rules<"root", "C1", A> = null! as Rules<"root", keyof List, A, { kind: "k1" }>;
const e5: Rules<"root", "C0", A, Own0> = null! as Rules<"root", "C0", A>;
const e6: Rules<"root", "C0", A, Own1> = null! as Rules<"root", "C0", A>;
const e7: Rules<"root", "C0", A, Private> = null! as Rules<"root", "C0", A>;
const e8: Rules<"root", "C0", A, Protected> = null! as Rules<"root", "C0", A>;
const e9: Rules<"root", keyof List, A, Private> = null! as Rules<"root", keyof List, A, Protected>;
function generic<N extends keyof List, M extends N, T, U extends T>() {
  const g0: Rules<"root", N, T> = null! as Rules<"root", N, U>;
  const g1: Rules<"root", N, U> = null! as Rules<"root", N, T>;
  const g2: Rules<"root", N, T> = null! as Rules<"root", M, T>;
  const g3: Rules<"root", M, T> = null! as Rules<"root", N, T>;
  const g4: Rules<"root", N, T> = null! as Rules<"root", keyof List, T>;
  const g5: Rules<"root", keyof List, T> = null! as Rules<"root", N, T>;
  const g6: Rules<"root", N, T, { kind: "k0" }> = null! as Rules<"root", N, T>;
  const g7: Rules<"root", N, T> = null! as Rules<"root", N, T, { kind: "k0" }>;
  const g8: Rules<"root", N, T, Private> = null! as Rules<"root", N, T, Protected>;
  const p0: { theme: T } & { kind: string } = null! as List[N] & Record<string, unknown> & { theme: T };
  const p1: { theme: T } & { kind: "k0" } = null! as List[N] & Record<string, unknown> & { theme: T };
  const p2: { theme: T; className?: number } = null! as List[N] & Record<string, unknown> & { theme: T };
  const p3: { theme: T; anything?: number } = null! as List[N] & Record<string, unknown> & { theme: T };
  const p4: never = (null! as Omit<List[N] & Record<string, unknown> & { theme: T }, "theme">)[0];
  (null! as Omit<List[N] & Readonly<Record<string, unknown>> & { theme: T }, "theme">)[0] = 1;
}
const rule: Rules<"root", "C1", A> = { root: props => [props.kind, props.theme.a, props.ownerState.kind, { variants: [{ props: { kind: "k1", theme: { a: 1 } }, style: "" }, { props: { kind: "k0" }, style: "" }, { props: p => p.ownerState?.kind === "k1", style: p => p.kind }] }] };
export {};
`;

test.concurrent.skipIf(!tsc)("matches tsc on a theme's style rules for 3, 8 and 40 components", async () => {
  const sizes = [3, 8, 40];
  using dir = tempDir("bun-check-members", {
    "tsconfig.json": tsconfig,
    ...Object.fromEntries(sizes.map(size => [`size${size}.ts`, themed(size)])),
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  // The types in the messages depend on the size. The lines that have errors don't.
  const withErrors = Object.values(byFile(theirs)).map(about =>
    about.flatMap(it => /^\w+\.ts\((\d+),/.exec(it)?.[1] ?? []),
  );
  expect(withErrors).toEqual(
    sizes.map(() =>
      "24 25 26 27 28 29 30 31 32 34 35 36 40 41 43 45 46 47 48 49 50 51 52 53 55 56 58 59 61".split(" "),
    ),
  );
  for (const lines of ours) expect(byFile(lines)).toEqual(byFile(theirs));
});
