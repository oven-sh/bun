// A function of TypeScript that untyped code gets hold of in an object, and that has one body only, holds what it is called with to the types of its parameters: where an array, a function or a built-in class is declared, an object of another kind is refused, as a number is.
export {};
function list(value: string[]): unknown { return value; }
function pair(value: [number, string]): unknown { return value; }
function optionalList(value?: readonly number[]): unknown { return value; }
function callback(value: (x: number) => number): unknown { return value; }
function anyFunction(value: Function): unknown { return value; }
function map(value: Map<string, number>): unknown { return value; }
function listOrSet(value: string[] | Set<string>): unknown { return value; }
function listOrFunction(value: string[] | (() => void)): unknown { return value; }
const arrow = (value: string[]): unknown => value;
async function later(value: string[]): Promise<unknown> { return [value]; }
function second(first: number, value: string[]): unknown { return value; }
function used(value: string[]): string { return "length " + value.length; }
class Heir extends Array<string> {}
const untyped: any = { list, pair, optionalList, callback, anyFunction, map, listOrSet, listOrFunction, arrow, later, used, second: (value: unknown) => untyped.inner.second(1, value), inner: { second } };
const byName: Record<string, (...given: any[]) => unknown> = { list, callback, map };
const values: [string, () => any][] = [
  ["an array", () => ["a"]], ["an empty array", () => []], ["an array of numbers", () => [1, 2]], ["an heir of Array", () => new Heir()], ["a frozen array", () => Object.freeze(["a"])],
  ["an object", () => ({})], ["an object with a length", () => ({ length: 1, 0: "a" })], ["a function", () => () => 1], ["a class", () => Heir], ["a bound function", () => list.bind(null)],
  ["a Map", () => new Map()], ["a Set", () => new Set()], ["a Date", () => new Date(0)], ["bytes", () => new Uint8Array(2)], ["a proxy of an array", () => new Proxy([], {})], ["a proxy of a function", () => new Proxy(() => 1, {})],
  ["a number", () => 5], ["a string", () => "text"], ["null", () => null], ["undefined", () => undefined],
];
async function tell(name: string, f: () => unknown): Promise<void> { let said: string; try { await f(); said = "taken"; } catch (e) { said = (e as Error).name; } console.log(name + ": " + said); }
for (const name of ["list", "pair", "optionalList", "callback", "anyFunction", "map", "listOrSet", "listOrFunction", "arrow", "later", "second", "used"]) for (const [what, make] of values) await tell(name + " | " + what, () => untyped[name](make()));
for (const name of ["list", "callback", "map"]) for (const [what, make] of values) await tell("through a record of functions | " + name + " | " + what, () => byName[name]!(make()));
const own: string[] = ["a"];
console.log(String(list(own)), String(list(new Heir())), typeof callback(x => x + 1), String(used(own)), (map(new Map([["a", 1]])) as Map<string, number>).size);
