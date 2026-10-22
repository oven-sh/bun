interface Printable {
  toString(): string;
}

interface Valued {
  valueOf(): number | object;
}

interface Built {
  constructor: Function;
}

interface Checker {
  hasOwnProperty(key: string): boolean;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function print(p: Printable): string {
  return p.toString();
}

function concatenate(p: Printable): string {
  return "<" + p + ">";
}

function builder(b: Built): string {
  return b.constructor.name;
}

function owns(c: Checker, key: string): boolean {
  return c.hasOwnProperty(key);
}

class Custom {
  toString(): string {
    return "custom";
  }
}

const empty: Printable = {};
const own: Printable = { toString: () => "own" };
const custom: Printable = new Custom();
const bare: Printable = Object.create(null);
const bareWithOwn: Printable = Object.assign(Object.create(null), { toString: () => "bare with its own" });
const returnsObject: Printable = Object.assign({}, { valueOf: () => 5 });

const printables: [string, Printable][] = [
  ["an empty literal", empty],
  ["an own arrow", own],
  ["a class", custom],
  ["no prototype", bare],
  ["no prototype, its own member", bareWithOwn],
  ["only valueOf", returnsObject],
  ["an array", [1, 2]],
  ["a date", new Date(0)],
  ["a regular expression", /x/g],
  ["an error", new RangeError("r")],
];

for (const [label, p] of printables) {
  attempt(label + ", toString", () => print(p).slice(0, 24));
  attempt(label + ", concatenated", () => concatenate(p).slice(0, 24));
  attempt(label + ", template", () => `${p}`.slice(0, 24));
  attempt(label + ", own", () => Object.hasOwn(p, "toString"));
}

const builts: [string, Built][] = [
  ["a literal", {}],
  ["an instance", new Custom()],
  ["an own member", { constructor: Custom }],
  ["no prototype", Object.create(null)],
  ["an array", []],
];
for (const [label, b] of builts) attempt(label + ", constructor", () => builder(b));

const checkers: [string, Checker][] = [
  ["a literal", { a: 1 }],
  ["one that lies", { hasOwnProperty: () => true }],
  ["no prototype", Object.create(null)],
];
for (const [label, c] of checkers) attempt(label + ", hasOwnProperty", () => owns(c, "a") + " " + owns(c, "b"));

const valued: Valued[] = [{}, { valueOf: () => 7 }, new Date(5), [3]];
for (const v of valued) attempt("valueOf", () => typeof v.valueOf() + " " + JSON.stringify(v.valueOf()));

let length = 0;
for (let i = 0; i < 2000; i++) length += print(custom).length;
console.log("2000 honest: " + length);
attempt("then an empty literal", () => print(empty));
attempt("then no prototype", () => print(bare));
attempt("then the class", () => print(custom));

export {};
