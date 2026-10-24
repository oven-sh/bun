function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function twice(x: number): number;
function twice(x: string): string;
function twice(x: number | string): number | string {
  return typeof x === "number" ? x * 2 : x + x;
}

type Both = ((n: number) => number) & ((s: string) => string);
type OnlyNumbers = (n: number) => number;
type OnlyStrings = (s: string) => string;

const both: Both = twice;
const numbers: OnlyNumbers = twice;
const strings: OnlyStrings = twice;

function applyNumber(f: OnlyNumbers, n: number): number {
  return f(n) + 1;
}
function applyString(f: OnlyStrings, s: string): number {
  return f(s).length;
}
function applyBoth(f: Both): string {
  return f(2) + " " + f("ab");
}

show("direct number", () => twice(2));
show("direct string", () => twice("ab"));
show("both", () => applyBoth(both));
show("as numbers only", () => applyNumber(numbers, 3));
show("as strings only", () => applyString(strings, "abc"));
show("handed over directly", () => applyNumber(twice, 4) + " " + applyString(twice, "abcd"));
show("map numbers", () => [1, 2].map(numbers));
show("map strings", () => ["a", "b"].map(strings));
show("same function", () => new Set<unknown>([numbers, strings, both, twice]).size);

class Parser {
  base: number = 10;
  read(text: string): number;
  read(text: string, asText: true): string;
  read(text: string, asText?: boolean): number | string {
    return asText ? text + this.base : parseInt(text, this.base);
  }
}
const parser = new Parser();
const readNumber: (text: string) => number = parser.read.bind(parser);
show("method: number", () => parser.read("12") + 1);
show("method: text", () => parser.read("12", true).length);
show("bound to the first overload", () => readNumber("12") + 1);
show("map with the bound one: the index arrives as asText", () => ["12", "12", "12"].map(readNumber).map(v => typeof v + " " + v));

interface Converter {
  (n: number): string;
  (s: string): number;
  unit: string;
}
function convertImplementation(x: number): string;
function convertImplementation(x: string): number;
function convertImplementation(x: number | string): number | string {
  return typeof x === "number" ? x + converter.unit : x.length;
}
const converter: Converter = Object.assign(convertImplementation, { unit: "cm" });
show("hybrid with two call signatures: number", () => converter(5));
show("hybrid with two call signatures: string", () => converter("five") + 1);
converter.unit = "in";
show("after a store", () => converter(5));

let total = 0;
for (let i = 0; i < 2000; i++) total += applyNumber(twice, i);
show("2000 numbers", () => total);
show("then a string at the other site", () => applyString(twice, "xyz"));
const plainDouble: OnlyNumbers = n => n * 2;
show("a plain function at the first site", () => applyNumber(plainDouble, 5));
