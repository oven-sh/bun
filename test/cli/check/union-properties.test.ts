import { afterAll, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren } from "../children";
import { linesOf, tsc } from "./differential";

afterAll(endChildren);

// To make a property of a short union, `bun check` asks every member for the name. In a union of 8 members or more it
// keeps what it has found out about a member that it meets again. In one of 128 or more it comes to visit only the members
// that have the name, with sets of members that have 64 to a word, and up to 128 without an allocation. So each program
// here is checked with unions on both sides of such sizes, and the size must not change what is reported.

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

/** `text(0)`, `text(1)` .. up to `count` of them. */
const each = (count: number, text: (i: number) => string, separator = " | ") =>
  Array.from({ length: count }, (_, i) => text(i)).join(separator);

// `errors`: what TypeScript 7.0.2 reports about `program(count)`, for every `count` in `sizes`, after the name of the file.
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
      // Each has a property of its own, so that none is a subtype of another.
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
  "the names of the properties of Object and Function": {
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
  "one property after the other of the same union": {
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
  "unions that have members in common": {
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
  "a member that is being resolved while the union is asked": {
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
};

// `program` with one more line at the top, which asks each of its unions for 12 names that no member has. After that,
// `bun check` has kept all that it ever keeps about a union and its members.
function afterOtherNames(program: string) {
  const aliases = Array.from(program.matchAll(/^type (\w+) =/gm), found => found[1]);
  const reads = aliases.flatMap(alias => Array.from({ length: 12 }, (_, i) => `(null! as ${alias}).other${i}`));
  return `// @ts-ignore\n[${reads.join(", ")}];${program}`;
}

test.concurrent.each(Object.keys(cases))("%s", async title => {
  const { sizes = [7, 8, 65, 130], program, errors } = cases[title];
  using dir = tempDir("bun-check-union", {
    "tsconfig.json": tsconfig,
    ...Object.fromEntries(sizes.map(size => [`first${size}.ts`, program(size)])),
    ...Object.fromEntries(sizes.map(size => [`later${size}.ts`, afterOtherNames(program(size))])),
  });
  const byFile: Record<string, string[]> = {};
  let file = "";
  for (const line of await linesOf([bunExe(), "check"], String(dir), String(dir))) {
    // The lines that explain an error come after it, indented.
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

test.concurrent.skipIf(!tsc)("every kind of member and every kind of name, as in TypeScript", async () => {
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
  // A debug build is 10 to 100 times slower, so it checks a sample. It is always the same sample.
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
