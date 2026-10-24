function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

type Numeric = { valueOf(): number };

const log: string[] = [];

class Celsius {
  constructor(private degrees: number) {}
  valueOf(): number {
    log.push("Celsius.valueOf");
    return this.degrees;
  }
}

function unwrap(value: Numeric): number {
  return value.valueOf();
}

function plusOne(value: Numeric): number {
  return value.valueOf() + 1;
}

function byUnaryPlus(value: Numeric): number {
  return +value;
}

function byNumber(value: Numeric): number {
  return Number(value);
}

function isNegativeZero(value: Numeric): boolean {
  return Object.is(value.valueOf(), -0);
}

function less(a: Numeric, b: Numeric): boolean {
  return a < b;
}

function sum(values: Numeric[]): number {
  let total = 0;
  for (const value of values) total += value.valueOf();
  return total;
}

function kindOf(value: Numeric): string {
  return typeof value + "/" + typeof value.valueOf();
}

const values: [string, Numeric][] = [
  ["a literal", { valueOf: () => 3 }],
  ["degrees", new Celsius(21.5)],
  ["5", 5],
  ["2.5", 2.5],
  ["-0", -0],
  ["NaN", NaN],
  ["-Infinity", -Infinity],
  ["2 ** 53", 2 ** 53],
  ["a Number object", new Number(7)],
  ["a date", new Date(86400000)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Numeric = { valueOf: () => i };
  warm += unwrap(honest) + plusOne(honest) + byUnaryPlus(honest) + byNumber(honest) + (isNegativeZero(honest) ? 1 : 0);
  warm += (less(honest, { valueOf: () => 1000 }) ? 1 : 0) + sum([honest, honest]) + kindOf(honest).length;
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": valueOf", () => unwrap(value));
  attempt(name + ": plus one", () => plusOne(value));
  attempt(name + ": unary plus", () => byUnaryPlus(value));
  attempt(name + ": Number()", () => byNumber(value));
  attempt(name + ": is -0", () => isNegativeZero(value));
  attempt(name + ": less than 4", () => less(value, 4));
  attempt(name + ": 4 less than it", () => less(4, value));
  attempt(name + ": kinds", () => kindOf(value));
}
attempt("sum of numbers", () => sum([1, 2.5, -0]));
attempt("sum of a mix", () => sum([1, new Celsius(2), new Number(3), { valueOf: () => 4 }, 0.5]));
console.log("calls", log.length, log[0]);

function text(value: { valueOf(): string }): string {
  return value.valueOf() + "!";
}
function flag(value: { valueOf(): boolean }): string {
  return value.valueOf() ? "yes" : "no";
}
function flagItself(value: { valueOf(): boolean }): string {
  return value ? "truthy" : "falsy";
}
function big(value: { valueOf(): bigint }): bigint {
  return value.valueOf() * 2n;
}
function mark(value: { valueOf(): symbol }): string | undefined {
  return value.valueOf().description;
}
function anything(value: { valueOf(): unknown }): string {
  return typeof value.valueOf();
}
attempt("text of a literal", () => text({ valueOf: () => "literal" }));
attempt("text of a string", () => text("string"));
attempt("text of a String object", () => text(new String("boxed")));
attempt("flag of a literal", () => flag({ valueOf: () => false }));
attempt("flag of true", () => flag(true));
attempt("flag of false", () => flag(false));
attempt("flag of a Boolean object", () => flag(new Boolean(false)));
attempt("false itself", () => flagItself(false));
attempt("a Boolean object of false itself", () => flagItself(new Boolean(false)));
attempt("big of a literal", () => big({ valueOf: () => 4n }));
attempt("big of a bigint", () => big(2n ** 64n));
attempt("mark of a symbol", () => mark(Symbol("here")));
for (const value of [1, "s", true, 1n, Symbol.iterator, anything, [], {}, null === null] satisfies { valueOf(): unknown }[]) {
  attempt("anything", () => anything(value));
}
