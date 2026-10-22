function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Taker = (a?: number) => string;

function optional(a?: number): string {
  return arguments.length + " arguments, a is " + text(a);
}

function defaulted(a: number = 7): string {
  return arguments.length + " arguments, a is " + text(a) + ", a + 1 is " + text(a + 1);
}

function rest(...a: (number | undefined)[]): string {
  return arguments.length + " arguments, " + a.length + " collected, 0 in it " + (0 in a) + ", first " + text(a[0]);
}

function optionalThenRest(a?: number, ...others: number[]): string {
  return arguments.length + " arguments, a is " + text(a) + ", others " + text(others);
}

function defaultThenDefault(a: number = 1, b: number = a + 1): string {
  return arguments.length + " arguments, a is " + text(a) + ", b is " + text(b);
}

function destructured(...[a = 9]: [number?]): string {
  return arguments.length + " arguments, a is " + text(a);
}

const arrowOptional: Taker = a => "a is " + text(a);
const arrowDefaulted: Taker = (a = 7) => "a is " + text(a);
const arrowRest: Taker = (...a) => a.length + " collected, first " + text(a[0]);

class Host {
  base = 100;
  method(a?: number): string {
    return arguments.length + " arguments, a is " + text(a);
  }
  withDefault(a: number = this.base): string {
    return arguments.length + " arguments, a is " + text(a);
  }
}
const host = new Host();

const takers: [string, Taker][] = [
  ["optional", optional],
  ["defaulted", defaulted],
  ["rest", rest],
  ["optional then rest", optionalThenRest],
  ["two defaults", defaultThenDefault],
  ["a destructured rest", destructured],
  ["an arrow, optional", arrowOptional],
  ["an arrow, defaulted", arrowDefaulted],
  ["an arrow, rest", arrowRest],
  ["a method", a => (a === undefined ? host.method() : host.method(a))],
  ["a bound method", host.method.bind(host)],
  ["a bound method with a default", host.withDefault.bind(host)],
];

const empty: [] = [];
const one: [number] = [1];
const maybeNone: [number?] = [];
const maybeUndefined: [number?] = [undefined];
const hole: [number?] = [,];

const calls: [string, (f: Taker) => string][] = [
  ["f()", f => f()],
  ["f(undefined)", f => f(undefined)],
  ["f(void 0)", f => f(void 0)],
  ["f(...[])", f => f(...[])],
  ["f(...[undefined])", f => f(...[undefined])],
  ["f(...empty)", f => f(...empty)],
  ["f(...one)", f => f(...one)],
  ["f(...maybeNone)", f => f(...maybeNone)],
  ["f(...maybeUndefined)", f => f(...maybeUndefined)],
  ["f(...hole)", f => f(...hole)],
  ["f(0)", f => f(0)],
  ["f(-0)", f => f(-0)],
  ["f(NaN)", f => f(NaN)],
  ["f.call(null)", f => f.call(null)],
  ["f.call(null, undefined)", f => f.call(null, undefined)],
  ["f.apply(null)", f => f.apply(null)],
  ["f.apply(null, [])", f => f.apply(null, [])],
  ["f.apply(null, [undefined])", f => f.apply(null, [undefined])],
  ["f.bind(null)()", f => f.bind(null)()],
  ["f.bind(null, undefined)()", f => f.bind(null, undefined)()],
  ["Reflect.apply(f, null, [])", f => Reflect.apply(f, null, [])],
];

for (const [name, f] of takers) for (const [form, call] of calls) console.log(name + ", " + form + ": " + call(f));

console.log("direct: " + optional() + " | " + optional(undefined) + " | " + optional(...[]) + " | " + optional(...one));
console.log("direct: " + defaulted() + " | " + defaulted(undefined) + " | " + defaulted(...[]) + " | " + defaulted(...one));
console.log("direct: " + rest() + " | " + rest(undefined) + " | " + rest(...[]) + " | " + rest(...one));
