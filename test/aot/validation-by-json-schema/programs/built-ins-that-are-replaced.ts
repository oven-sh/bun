// A program can replace what it can reach, and a polyfill or a merge of a request body into an object does. A check calls nothing that can be replaced
// and reads nothing through a prototype, so it answers as before. Everything is replaced at once, before the first check of each type and again after it.
import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { finish, handsBack, noteCall, refuses } from "./check";

type Unique = unknown[] & Schema.UniqueItems;
type UniqueObjects = { b?: number; a?: number }[] & Schema.UniqueItems;
type Closed = { a?: number } & Schema.Strict;
type Needed = { a: number };
type Numbers = number[];
type Whole = number & Schema.Int;
type Cents = number & Schema.MultipleOf<0.01>;
type Short = string & Schema.MaxLength<2>;
type Lower = string & Schema.Pattern<"^[a-z]+$">;
type NotLower = string & Schema.Not<Lower>;
type Expression = string & Schema.Format<"regex">;
type Day = string & Schema.Format<"date">;
type Address = string & Schema.Format<"email">;
type Link = string & Schema.Format<"url">;
type One = [string];
type OneOrTwo = [string, number?];
type NoUnderscore = { a?: unknown } & Schema.PatternProperties<{ "^_": never }>;
type OnlyA = Record<string, unknown> & Schema.PropertyNames<"a">;
type AtMostOne = Record<string, unknown> & Schema.MaxProperties<1>;
type AtLeastOne = Record<string, unknown> & Schema.MinProperties<1>;
type Needs = Record<string, unknown> & Schema.DependentRequired<{ a: ["b"] }>;
type OneNumber = unknown[] & Schema.Contains<number, 1, 1>;
type SomeNumber = unknown[] & Schema.Contains<number>;
type WholeOrLarge = number & Schema.OneOf<[number & Schema.Int, number & Schema.Min<2>]>;
type Tagged = { k: "x"; a: number } | { k: "y"; a: string };
interface Chain {
  next?: Chain & Schema.OneOf<[Chain, Chain & { never: 1 }]>;
}

const refused = Symbol("refused");
const checks: [what: string, expected: unknown, run: () => unknown][] = [
  ["unique: the first again", refused, () => validate<Unique>([1, 2, 1])],
  ["unique: the first again, by text", refused, () => JSON.parse<Unique>("[1,2,1]")],
  ["unique", [2, 1, 3], () => validate<Unique>([2, 1, 3])],
  ["unique objects: alike but for the order of keys", refused, () => validate<UniqueObjects>([{ a: 1, b: 2 }, { a: 2 }, { b: 2, a: 1 }])],
  ["unique objects", [{ a: 1, b: 2 }, { b: 1, a: 2 }], () => validate<UniqueObjects>([{ a: 1, b: 2 }, { b: 1, a: 2 }])],
  ["closed: another key", refused, () => validate<Closed>({ a: 1, b: 1 })],
  ["closed: another key, by text", refused, () => JSON.parse<Closed>('{"a":1,"b":1}')],
  ["closed", { a: 1 }, () => validate<Closed>({ a: 1 })],
  ["closed, by text", { a: 1 }, () => JSON.parse<Closed>('{"a":1}')],
  ["closed: an array", refused, () => validate<Closed>([])],
  ["needed: absent", refused, () => validate<Needed>({})],
  ["needed: absent, by text", refused, () => JSON.parse<Needed>("{}")],
  ["needed: a text", refused, () => validate<Needed>({ a: "1" })],
  ["needed", { a: 1 }, () => validate<Needed>({ a: 1 })],
  ["numbers: an object", refused, () => validate<Numbers>({ length: 0 })],
  ["numbers: a text", refused, () => validate<Numbers>([1, "2"])],
  ["numbers", [1, 2], () => validate<Numbers>([1, 2])],
  ["numbers, by text", [1, 2], () => JSON.parse<Numbers>("[1,2]")],
  ["whole: a fraction", refused, () => validate<Whole>(1.5)],
  ["whole: not a number", refused, () => validate<Whole>(NaN)],
  ["whole: not finite", refused, () => validate<Whole>(Infinity)],
  ["whole", 2, () => validate<Whole>(2)],
  ["cents: a part of a cent", refused, () => validate<Cents>(0.075)],
  ["cents", 0.07, () => validate<Cents>(0.07)],
  ["short: three characters", refused, () => validate<Short>("abc")],
  ["short: two characters of two units", "💩💩", () => validate<Short>("💩💩")],
  ["lower: a digit", refused, () => validate<Lower>("a1")],
  ["lower", "ab", () => validate<Lower>("ab")],
  ["not lower: lower", refused, () => validate<NotLower>("ab")],
  ["not lower", "a1", () => validate<NotLower>("a1")],
  ["an expression: none", refused, () => validate<Expression>("(")],
  ["an expression", "(a)", () => validate<Expression>("(a)")],
  ["a day: none", refused, () => validate<Day>("2021-02-29")],
  ["a day", "2020-02-29", () => validate<Day>("2020-02-29")],
  ["an address: none", refused, () => validate<Address>("a@")],
  ["an address", "a@b.co", () => validate<Address>("a@b.co")],
  ["a link: none", refused, () => validate<Link>("not a url")],
  ["one: two elements", refused, () => validate<One>(["a", ["b"]])],
  ["one: two elements, by text", refused, () => JSON.parse<One>('["a",["b"]]')],
  ["one: none", refused, () => validate<One>([])],
  ["one", ["a"], () => validate<One>(["a"])],
  ["one or two: three elements", refused, () => validate<OneOrTwo>(["a", 1, 1])],
  ["one or two: none", refused, () => validate<OneOrTwo>([])],
  ["one or two", ["a"], () => validate<OneOrTwo>(["a"])],
  ["no underscore: one", refused, () => validate<NoUnderscore>({ _a: 1 })],
  ["no underscore", { b: 1 }, () => validate<NoUnderscore>({ b: 1 })],
  ["only a: b", refused, () => validate<OnlyA>({ b: 1 })],
  ["only a", { a: 1 }, () => validate<OnlyA>({ a: 1 })],
  ["at most one: two", refused, () => validate<AtMostOne>({ a: 1, b: 1 })],
  ["at most one", { a: 1 }, () => validate<AtMostOne>({ a: 1 })],
  ["at least one: none", refused, () => validate<AtLeastOne>({})],
  ["needs: a without b", refused, () => validate<Needs>({ a: 1 })],
  ["needs", { a: 1, b: 1 }, () => validate<Needs>({ a: 1, b: 1 })],
  ["one number: two", refused, () => validate<OneNumber>([1, 2])],
  ["one number: none", refused, () => validate<OneNumber>(["a"])],
  ["one number", ["a", 1], () => validate<OneNumber>(["a", 1])],
  ["some number: none", refused, () => validate<SomeNumber>(["a"])],
  ["some number: three", [1, 2, 3], () => validate<SomeNumber>([1, 2, 3])],
  ["whole or large: both", refused, () => validate<WholeOrLarge>(3)],
  ["whole or large: neither", refused, () => validate<WholeOrLarge>(1.5)],
  ["whole or large", 1, () => validate<WholeOrLarge>(1)],
  ["tagged: the member of the other arm", refused, () => validate<Tagged>({ k: "x", a: "s" })],
  ["tagged", { k: "y", a: "s" }, () => validate<Tagged>({ k: "y", a: "s" })],
  ["a chain whose end is wrong", refused, () => validate<Chain>({ next: { next: { next: 1 } } })],
  ["a chain", { next: { next: {} } }, () => validate<Chain>({ next: { next: {} } })],
];

const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const deleteProperty = Reflect.deleteProperty;
const namesOfTheCalled: Record<string, boolean> = Object.create(null);
const receiver = Symbol("the receiver");

/** What each answers in the first round, and in the second. */
const functions: [holder: object, name: PropertyKey, label: string, first: unknown, second: unknown][] = [
  [Array.prototype, "sort", "Array.prototype.sort", receiver, receiver],
  [Array.prototype, "push", "Array.prototype.push", 0, 0],
  [Array.prototype, "join", "Array.prototype.join", "", ""],
  [Array.prototype, "includes", "Array.prototype.includes", true, false],
  [Array.prototype, "indexOf", "Array.prototype.indexOf", 0, -1],
  [Array.prototype, "slice", "Array.prototype.slice", [], []],
  [Array.prototype, "every", "Array.prototype.every", true, true],
  [Array.prototype, "some", "Array.prototype.some", false, true],
  [Array.prototype, "map", "Array.prototype.map", [], []],
  [Array.prototype, "filter", "Array.prototype.filter", [], []],
  [Array.prototype, Symbol.iterator, "Array.prototype[Symbol.iterator]", { next: () => ({ done: true, value: undefined }) }, { next: () => ({ done: true, value: undefined }) }],
  [Array, "isArray", "Array.isArray", true, false],
  [Array, "from", "Array.from", [], []],
  [Object, "keys", "Object.keys", [], []],
  [Object, "entries", "Object.entries", [], []],
  [Object, "values", "Object.values", [], []],
  [Object, "getOwnPropertyNames", "Object.getOwnPropertyNames", [], []],
  [Object, "getOwnPropertyDescriptor", "Object.getOwnPropertyDescriptor", { value: 1, enumerable: true }, undefined],
  [Object, "getPrototypeOf", "Object.getPrototypeOf", Object.prototype, null],
  [Object, "hasOwn", "Object.hasOwn", true, false],
  [Object, "is", "Object.is", false, true],
  [Object, "assign", "Object.assign", {}, {}],
  [Object, "defineProperty", "Object.defineProperty", {}, {}],
  [Object.prototype, "hasOwnProperty", "Object.prototype.hasOwnProperty", true, false],
  [Object.prototype, "propertyIsEnumerable", "Object.prototype.propertyIsEnumerable", true, false],
  [Object.prototype, "toString", "Object.prototype.toString", "[object Object]", "[object Array]"],
  [Object.prototype, "valueOf", "Object.prototype.valueOf", 1, 1],
  [Reflect, "ownKeys", "Reflect.ownKeys", [], []],
  [Reflect, "get", "Reflect.get", 1, 1],
  [Reflect, "has", "Reflect.has", true, false],
  [Number, "isInteger", "Number.isInteger", true, true],
  [Number, "isFinite", "Number.isFinite", true, true],
  [Number, "isSafeInteger", "Number.isSafeInteger", true, true],
  [Number, "isNaN", "Number.isNaN", false, false],
  [Number.prototype, "toString", "Number.prototype.toString", "1", "1"],
  [globalThis, "isFinite", "isFinite", true, true],
  [globalThis, "isNaN", "isNaN", false, false],
  [globalThis, "String", "String", "1", "1"],
  [globalThis, "Number", "Number", 1, 1],
  [Math, "floor", "Math.floor", 0, 0],
  [Math, "round", "Math.round", 0, 0],
  [Math, "trunc", "Math.trunc", 0, 0],
  [Math, "abs", "Math.abs", 0, 0],
  [Math, "min", "Math.min", 0, 0],
  [Math, "max", "Math.max", 0, 0],
  [RegExp.prototype, "exec", "RegExp.prototype.exec", [""], null],
  [RegExp.prototype, "test", "RegExp.prototype.test", true, false],
  [RegExp.prototype, Symbol.match, "RegExp.prototype[Symbol.match]", [""], null],
  [RegExp.prototype, Symbol.search, "RegExp.prototype[Symbol.search]", 0, -1],
  [globalThis, "RegExp", "RegExp", {}, {}],
  [String.prototype, "codePointAt", "String.prototype.codePointAt", 97, 97],
  [String.prototype, "charCodeAt", "String.prototype.charCodeAt", 97, 97],
  [String.prototype, "charAt", "String.prototype.charAt", "a", "a"],
  [String.prototype, "at", "String.prototype.at", "a", "a"],
  [String.prototype, "slice", "String.prototype.slice", "", ""],
  [String.prototype, "substring", "String.prototype.substring", "", ""],
  [String.prototype, "indexOf", "String.prototype.indexOf", 0, -1],
  [String.prototype, "lastIndexOf", "String.prototype.lastIndexOf", 0, -1],
  [String.prototype, "includes", "String.prototype.includes", true, false],
  [String.prototype, "startsWith", "String.prototype.startsWith", true, false],
  [String.prototype, "endsWith", "String.prototype.endsWith", true, false],
  [String.prototype, "split", "String.prototype.split", [], []],
  [String.prototype, "match", "String.prototype.match", [""], null],
  [String.prototype, "search", "String.prototype.search", 0, -1],
  [String.prototype, "toLowerCase", "String.prototype.toLowerCase", "a", "a"],
  [String.prototype, Symbol.iterator, "String.prototype[Symbol.iterator]", { next: () => ({ done: true, value: undefined }) }, { next: () => ({ done: true, value: undefined }) }],
  [Map.prototype, "get", "Map.prototype.get", undefined, true],
  [Map.prototype, "set", "Map.prototype.set", receiver, receiver],
  [Map.prototype, "has", "Map.prototype.has", false, true],
  [Set.prototype, "add", "Set.prototype.add", receiver, receiver],
  [Set.prototype, "has", "Set.prototype.has", false, true],
  [WeakMap.prototype, "get", "WeakMap.prototype.get", undefined, true],
  [WeakMap.prototype, "set", "WeakMap.prototype.set", receiver, receiver],
  [WeakMap.prototype, "has", "WeakMap.prototype.has", false, true],
  [globalThis.JSON, "parse", "JSON.parse", [{ shape: "Unknown" }], [{ shape: "Unknown" }]],
  [globalThis.JSON, "stringify", "JSON.stringify", "1", "1"],
  [URL, "canParse", "URL.canParse", true, true],
];

/** Names that the description of a check may leave out. A value of that name on `Object.prototype` is not the description's. */
const inherited: [name: string, value: unknown][] = [
  ["rest", 0],
  ["required", 0],
  ["maximum", 4294967295],
  ["minimum", 0],
  ["default", 5],
  ["isOptional", true],
  ["mustBeOwn", false],
  ["undeclared", "Allowed"],
  ["others", 0],
  ["unicode", true],
  ["elements", []],
  ["members", []],
  ["arms", [0]],
  ["rules", []],
  ["remembers", false],
  ["b", 1],
  ["never", 1],
  ["k", "x"],
];

function answering(label: string, answer: unknown) {
  return function (this: unknown) {
    noteCall();
    namesOfTheCalled[label] = true;
    return answer === receiver ? this : answer;
  };
}

function runWhileReplaced(round: string, isFirst: boolean) {
  const before: (PropertyDescriptor | undefined)[] = new Array(functions.length).fill(undefined);
  const isReplaced: boolean[] = new Array(functions.length).fill(false);
  const isInherited: boolean[] = new Array(inherited.length + 2).fill(false);
  const outcomes: (() => unknown)[] = new Array(checks.length).fill(() => undefined);
  const replacements = functions.map(([, , label, first, second]) => answering(label, isFirst ? first : second));
  const stored = answering("a setter that is inherited", undefined);

  for (let i = 0; i < functions.length; i++) {
    before[i] = getOwnPropertyDescriptor(functions[i][0], functions[i][1]);
    try {
      defineProperty(functions[i][0], functions[i][1], { value: replacements[i], writable: true, configurable: true, enumerable: false });
      isReplaced[i] = true;
    } catch {}
  }
  for (let i = 0; i < inherited.length; i++) {
    try {
      defineProperty(Object.prototype, inherited[i][0], { value: inherited[i][1], writable: true, configurable: true, enumerable: true });
      isInherited[i] = true;
    } catch {}
  }
  try {
    defineProperty(Object.prototype, "a", { set: stored, get: undefined, configurable: true });
    isInherited[inherited.length] = true;
  } catch {}
  try {
    defineProperty(Array.prototype, "0", { set: stored, get: undefined, configurable: true });
    isInherited[inherited.length + 1] = true;
  } catch {}

  for (let i = 0; i < checks.length; i++) {
    try {
      const value = checks[i][2]();
      outcomes[i] = () => value;
    } catch (error) {
      outcomes[i] = () => {
        throw error;
      };
    }
  }

  if (isInherited[inherited.length + 1]) deleteProperty(Array.prototype, "0");
  if (isInherited[inherited.length]) deleteProperty(Object.prototype, "a");
  for (let i = 0; i < inherited.length; i++) if (isInherited[i]) deleteProperty(Object.prototype, inherited[i][0]);
  for (let i = 0; i < functions.length; i++) {
    const was = before[i];
    if (isReplaced[i] && was !== undefined) defineProperty(functions[i][0], functions[i][1], was);
    else if (isReplaced[i]) deleteProperty(functions[i][0], functions[i][1]);
  }

  checks.forEach(([what, expected], i) => {
    if (expected === refused) refuses(round + " | " + what, outcomes[i]);
    else handsBack(round + " | " + what, expected, outcomes[i]);
  });
}

runWhileReplaced("before the first check", true);
runWhileReplaced("after the first check", false);
for (const label in namesOfTheCalled) console.log("CALLED | " + label);

finish();
