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
  // The contextual type of a property of an object literal comes from the members of the union that have the property or
  // an index signature. The others are passed over once enough is known about them.
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

// A union keeps its members in one order, whatever it is made of. `bun check` sorts types that aren't unions. The
// members of a union are in order already, so it merges them with the rest. Where all come from one union that was
// narrowed, it takes them from that union by their positions. And it keeps the answers for lists of types that it has
// seen. An assignment that fails prints the union, and the line after it names the first member.

// What TypeScript 7.0.2 reports about each program, with `noErrorTruncation`.
const orders: Record<string, { program: string; errors: string }> = {
  "unions whose members interleave, overlap, follow each other, are the same or are none": {
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
  "what a wider member, a pattern, a supertype or a constraint takes out of merged unions": {
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
  "members that nothing but the order of their creation tells apart": {
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
(10,7): error TS2322: Type '"a" | 3n | 1n | 2n | B' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(11,7): error TS2322: Type '"a" | 3n | 1n | 2n | B | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(12,7): error TS2322: Type '"a" | 0n | 3n | 1n | 2n | 5n | 4n | B' is not assignable to type 'never'.
  Type '"a"' is not assignable to type 'never'.
(13,7): error TS2322: Type '0n | 3n | 1n | 5n | 4n' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
(14,7): error TS2322: Type '0n | 3n | 5n | 4n | 6n' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
(15,7): error TS2322: Type 'string | 2 | 3n | 1n | 2n | B' is not assignable to type 'never'.
  Type 'string' is not assignable to type 'never'.
(16,7): error TS2322: Type 'bigint | "a" | A | B' is not assignable to type 'never'.
  Type 'bigint' is not assignable to type 'never'.
(19,9): error TS2322: Type '0n | 3n | 2n | 5n | 4n | B' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
(21,9): error TS2322: Type '0n | 3n | 2n | 5n | 4n | B' is not assignable to type 'never'.
  Type '0n' is not assignable to type 'never'.
(23,11): error TS2322: Type '0n | 3n | 2n | 5n | 4n' is not assignable to type 'never'.
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
  "three types whose order goes in a circle, among others": {
    program: `
interface A1 { a1: 1 } interface A2 { a2: 1 } interface K { k: 1 } interface M { m: 1 } interface P { p: 1 }
interface W { w: 1 } interface Y { y: 1 } interface Z { z: 1 }
interface Box<T> { value: T }
// N.X<A1, P> comes before N.X<A2, K>, that one before O.X, and that one before N.X<A1, P>.
namespace N { export type X<T, U> = U & T }
namespace O { export type X = M & A1 }
type V = W & A1;
type Y2 = Y & A1;
interface Runs {
  both: N.X<A1, P> | N.X<A2, K>;
  bothAndMore: A1 | N.X<A2, K> | V | Z | N.X<A1, P> | Y2 | "text";
  bothAndMany: A1 | A2 | K | M | P | W | Y | Z | N.X<A1, P> | N.X<A2, K> | V | Y2;
  third: O.X | A2;
  thirdAndMore: K | O.X | 1 | V | Y2 | undefined;
  first: N.X<A1, P> | M;
  second: N.X<A2, K> | P;
  firstAndThird: N.X<A1, P> | O.X;
  all: O.X | N.X<A2, K> | N.X<A1, P>;
  boxes: Box<N.X<A1, P>> | Box<N.X<A2, K>> | Box<A1> | Box<Z>;
  box: Box<O.X> | Box<A2>;
}
const c1: never = null! as Runs["both"] | Runs["third"];
const c2: never = null! as Runs["third"] | Runs["both"];
const c3: never = null! as Runs["bothAndMore"] | Runs["thirdAndMore"];
const c4: never = null! as Runs["thirdAndMore"] | Runs["bothAndMore"];
const c5: never = null! as Runs["first"] | Runs["second"] | Runs["third"];
const c6: never = null! as Runs["third"] | Runs["second"] | Runs["first"];
const c7: never = null! as Runs["second"] | Runs["third"] | Runs["first"];
const c8: never = null! as Runs["firstAndThird"] | Runs["second"];
const c9: never = null! as Runs["second"] | Runs["firstAndThird"];
const c10: never = null! as Runs["all"] | Z;
const c11: never = null! as A1 | Runs["all"];
const c12: never = null! as Runs["all"] | Runs["both"];
const c13: never = null! as Runs["both"] | Runs["all"];
const c14: never = null! as Runs["bothAndMore"] | O.X;
const c15: never = null! as O.X | Runs["bothAndMore"];
const c16: never = null! as Runs["bothAndMany"] | O.X;
const c17: never = null! as O.X | Runs["bothAndMany"] | 1;
const c18: never = null! as Runs["bothAndMany"] | Runs["thirdAndMore"] | Runs["all"];
const c19: never = null! as Runs["boxes"] | Runs["box"];
const c20: never = null! as Box<O.X> | Runs["boxes"] | Box<M>;
const c21: never = null! as Runs["boxes"] | Box<M> | Box<O.X>;
const c22: never = null! as Runs["first"] | Runs["second"] | Runs["third"];
function narrowed(x: Runs["all"] | Z | W, y: Runs["bothAndMany"] | O.X) {
  if ("z" in x) return;
  const withoutZ: never = x;
  if ("w" in x) x; else x;
  const joined: never = x;
  if ("z" in y || "y" in y) return;
  const withoutTwo: never = y;
}
export {};
`,
    errors: `
(23,7): error TS2322: Type 'A2 | O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(24,7): error TS2322: Type 'A2 | O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(25,7): error TS2322: Type '"text" | 1 | A1 | K | Z | V | N.X<A1, P> | N.X<A2, K> | O.X | Y2 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(26,7): error TS2322: Type '"text" | 1 | A1 | K | Z | V | N.X<A1, P> | N.X<A2, K> | O.X | Y2 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(27,7): error TS2322: Type 'A2 | M | P | N.X<A1, P> | N.X<A2, K> | O.X' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(28,7): error TS2322: Type 'A2 | M | P | N.X<A2, K> | O.X | N.X<A1, P>' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(29,7): error TS2322: Type 'A2 | M | P | N.X<A2, K> | O.X | N.X<A1, P>' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(30,7): error TS2322: Type 'P | N.X<A2, K> | O.X | N.X<A1, P>' is not assignable to type 'never'.
  Type 'P' is not assignable to type 'never'.
(31,7): error TS2322: Type 'P | N.X<A2, K> | O.X | N.X<A1, P>' is not assignable to type 'never'.
  Type 'P' is not assignable to type 'never'.
(32,7): error TS2322: Type 'Z | N.X<A2, K> | O.X | N.X<A1, P>' is not assignable to type 'never'.
  Type 'Z' is not assignable to type 'never'.
(33,7): error TS2322: Type 'A1 | N.X<A1, P> | N.X<A2, K> | O.X' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(34,7): error TS2322: Type 'N.X<A2, K> | O.X | N.X<A1, P>' is not assignable to type 'never'.
  Type 'X<A2, K>' is not assignable to type 'never'.
(35,7): error TS2322: Type 'N.X<A2, K> | O.X | N.X<A1, P>' is not assignable to type 'never'.
  Type 'X<A2, K>' is not assignable to type 'never'.
(36,7): error TS2322: Type '"text" | A1 | Z | V | N.X<A1, P> | N.X<A2, K> | O.X | Y2' is not assignable to type 'never'.
  Type '"text"' is not assignable to type 'never'.
(37,7): error TS2322: Type '"text" | A1 | Z | V | N.X<A1, P> | N.X<A2, K> | O.X | Y2' is not assignable to type 'never'.
  Type '"text"' is not assignable to type 'never'.
(38,7): error TS2322: Type 'A1 | A2 | K | M | P | W | Y | Z | V | O.X | N.X<A1, P> | N.X<A2, K> | Y2' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
(39,7): error TS2322: Type '1 | A1 | A2 | K | M | P | W | Y | Z | V | O.X | N.X<A1, P> | N.X<A2, K> | Y2' is not assignable to type 'never'.
  Type '1' is not assignable to type 'never'.
(40,7): error TS2322: Type '1 | A1 | A2 | K | M | P | W | Y | Z | V | N.X<A2, K> | O.X | N.X<A1, P> | N.X<A2, K> | Y2 | undefined' is not assignable to type 'never'.
  Type 'undefined' is not assignable to type 'never'.
(41,7): error TS2322: Type 'Box<A1> | Box<A2> | Box<Z> | Box<X<A1, P>> | Box<X<A2, K>> | Box<X>' is not assignable to type 'never'.
  Type 'Box<A1>' is not assignable to type 'never'.
(42,7): error TS2322: Type 'Box<A1> | Box<M> | Box<Z> | Box<X<A2, K>> | Box<X> | Box<X<A1, P>>' is not assignable to type 'never'.
  Type 'Box<A1>' is not assignable to type 'never'.
(43,7): error TS2322: Type 'Box<A1> | Box<M> | Box<Z> | Box<X<A1, P>> | Box<X<A2, K>> | Box<X>' is not assignable to type 'never'.
  Type 'Box<A1>' is not assignable to type 'never'.
(44,7): error TS2322: Type 'A2 | M | P | N.X<A1, P> | N.X<A2, K> | O.X' is not assignable to type 'never'.
  Type 'A2' is not assignable to type 'never'.
(47,9): error TS2322: Type 'W | N.X<A2, K> | O.X | N.X<A1, P>' is not assignable to type 'never'.
  Type 'W' is not assignable to type 'never'.
(49,9): error TS2322: Type 'W | N.X<A1, P> | N.X<A2, K> | O.X' is not assignable to type 'never'.
  Type 'W' is not assignable to type 'never'.
(51,9): error TS2322: Type 'A1 | A2 | K | M | P | W | V | O.X | N.X<A1, P> | N.X<A2, K>' is not assignable to type 'never'.
  Type 'A1' is not assignable to type 'never'.
`,
  },
  "what narrowing has taken apart is put together again": {
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
};

const untruncated = JSON.stringify({
  compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, noErrorTruncation: true },
});

test.concurrent.each(Object.keys(orders))("%s", async title => {
  const { program, errors } = orders[title];
  using dir = tempDir("bun-check-union", { "tsconfig.json": untruncated, "a.ts": program });
  const lines = await linesOf([bunExe(), "check"], String(dir), String(dir));
  expect(lines.map(line => line.replace(/^a\.ts/, ""))).toEqual(errors.trim().split("\n"));
});

const named = (i: number) => `T${String(i).padStart(5, "0")}`;

/** A union of `size` types next to one more type, which belongs before, among or after them, and next to unions. */
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

/** A union of `size` types that is narrowed, and joined again. */
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

/** Unions that one file declares and others put together. */
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

/** The lines about each file. The lines that explain an error come after it, indented. */
function byFile(lines: string[]) {
  const found: Record<string, string[]> = {};
  let file = "";
  for (const line of lines) {
    file = /^(\w+\.ts)\(/.exec(line)?.[1] ?? file;
    (found[file] ??= []).push(line);
  }
  return found;
}

// A type is searched for in a union that is 8 times as long as what it comes with, and merged otherwise. Positions
// are looked for in a union of up to 16 times as many members as two types have together: 48 for a union of two and
// one more type.
test.concurrent.skipIf(!tsc)("unions of 2 to 5,000 members, as in TypeScript", async () => {
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

test.concurrent.skipIf(!tsc)("unions of another file, on any number of threads, as in TypeScript", async () => {
  using dir = tempDir("bun-check-union", { "tsconfig.json": untruncated, ...shared });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 3, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  expect(Object.keys(byFile(theirs))).toEqual(["user0.ts", "user1.ts", "user2.ts", "user3.ts"]);
  for (const lines of ours) expect(byFile(lines)).toEqual(byFile(theirs));
});
