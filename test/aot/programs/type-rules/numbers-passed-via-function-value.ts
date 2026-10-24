// A function with parameters of type number that is called through a value: every number arrives as it is, whichever way it is kept, undefined and null pass, and anything else is turned away with a TypeError that names what was expected and what came. The parameter of the arrow function that `makeAdder` returns has no annotation of its own, so it is not tested.
function oneNumber(a: number): number {
  return a + 1;
}
function threeNumbers(a: number, b: number, c: number): number {
  return a + b * 2 + c * 4;
}
function fourNumbers(a: number, b: number, c: number, d: number): number {
  return a + b * 2 + c * 4 + d * 8;
}
function fiveNumbers(a: number, b: number, c: number, d: number, e: number): number {
  return a + b * 2 + c * 4 + d * 8 + e * 16;
}
function amongOthers(s: string, a: number, flag: boolean, b: number): string {
  return s + (flag ? a : b);
}
function behindAnObject(point: { x: number }, a: number): number {
  return point.x * a;
}
function calledInPlaceToo(a: number, b: number): number {
  return a / b;
}
function makeAdder(amount: number): (a: number) => number {
  return a => a + amount;
}
class Scale {
  factor = 3;
  apply(a: number): number {
    return a * this.factor;
  }
}
const table: Record<string, Function> = { oneNumber, threeNumbers, fourNumbers, fiveNumbers, amongOthers, behindAnObject, calledInPlaceToo, adder: makeAdder(0.5), apply: Scale.prototype.apply.bind(new Scale()) };
const values: unknown[] = [0, -0, 1, -1, 2147483647, -2147483648, 2147483648, 0.5, NaN, Infinity, 1e300, "1", "", null, undefined, true, false, {}, [], [1], () => 1, 1n, Symbol.iterator, new Number(1)];
const show = (value: unknown) => (Object.is(value, -0) ? "-0" : typeof value === "symbol" || typeof value === "bigint" || typeof value === "function" ? typeof value : typeof value === "object" && value ? value.constructor.name : String(value));
function attempt(name: string, ...given: unknown[]) {
  try {
    console.log(name, given.map(show).join(" "), "->", show(table[name](...given)));
  } catch (error) {
    console.log(name, given.map(show).join(" "), "throws", (error as Error).constructor.name + ":", (error as Error).message.split("\n")[0]);
  }
}
for (const value of values) {
  attempt("oneNumber", value);
  attempt("adder", value);
  attempt("apply", value);
  for (let place = 0; place < 3; place++) attempt("threeNumbers", ...[1, 2, 3].map((other, index) => (index === place ? value : other)));
  for (let place = 0; place < 4; place++) attempt("fourNumbers", ...[1, 2, 3, 4].map((other, index) => (index === place ? value : other)));
  for (let place = 0; place < 5; place++) attempt("fiveNumbers", ...[1, 2, 3, 4, 5].map((other, index) => (index === place ? value : other)));
  attempt("amongOthers", "s", value, true, 2);
  attempt("amongOthers", "s", 1, false, value);
  attempt("behindAnObject", { x: 2 }, value);
  attempt("calledInPlaceToo", value, 2);
  attempt("calledInPlaceToo", 1, value);
}
attempt("oneNumber");
attempt("threeNumbers", 1, 2);
attempt("threeNumbers", 1, 2, 3, "more");
console.log(calledInPlaceToo(1, 4), calledInPlaceToo(6, 3));
function nested(name: string, value: unknown): string {
  try {
    return String(table[name](value));
  } catch (error) {
    return (error as Error).stack!.split("\n").length > 1 ? "has a stack" : "has no stack";
  }
}
console.log(nested("oneNumber", "x"), nested("oneNumber", 1));
