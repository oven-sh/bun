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

function ifElse(value: {}): string {
  if (value) return "truthy";
  return "falsy";
}

function conditional(value: {}): string {
  return value ? "truthy" : "falsy";
}

function negated(value: {}): boolean {
  return !value;
}

function twiceNegated(value: {}): boolean {
  return !!value;
}

function asBoolean(value: {}): boolean {
  return Boolean(value);
}

function and(value: {}): unknown {
  return value && "right";
}

function or(value: {}): unknown {
  return value || "right";
}

function nullish(value: {}): unknown {
  return value ?? "right";
}

function loops(value: {}): number {
  let count = 0;
  while (value && count < 3) count++;
  return count;
}

function orAssigned(value: {}): unknown {
  let held = value;
  held ||= "replaced";
  return held;
}

function andAssigned(value: {}): unknown {
  let held = value;
  held &&= "replaced";
  return held;
}

function countTruthy(values: {}[]): number {
  return values.filter(Boolean).length + values.filter(value => value).length;
}

function lengthHolder(item: { length: number }): string {
  return item ? "truthy" : "falsy";
}

function fixable(item: { toFixed(digits: number): string }): string {
  return !item ? "falsy" : "truthy";
}

function maybe(item: { length: number } | undefined): string {
  return item ? "given " + item.length : "not given";
}

function chained(item: { length: number } | undefined): number | undefined {
  return item?.length;
}

class Slot {
  constructor(public held: {}) {}
  filled(): boolean {
    return this.held ? true : false;
  }
}

const values: [string, {}][] = [
  ["a literal", {}],
  ["0", 0],
  ["-0", -0],
  ["NaN", NaN],
  ["1", 1],
  ["0.1", 0.1],
  ["an empty string", ""],
  ["a space", " "],
  ["the text 0", "0"],
  ["false", false],
  ["true", true],
  ["0n", 0n],
  ["1n", 1n],
  ["a symbol", Symbol()],
  ["an empty array", []],
  ["a Boolean object of false", new Boolean(false)],
  ["a Number object of 0", new Number(0)],
  ["a String object of nothing", new String("")],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { i };
  warm += ifElse(honest).length + conditional(honest).length + (negated(honest) ? 1 : 0) + (twiceNegated(honest) ? 1 : 0) + (asBoolean(honest) ? 1 : 0);
  warm += (and(honest) === "right" ? 1 : 0) + (or(honest) === honest ? 1 : 0) + (nullish(honest) === honest ? 1 : 0) + loops(honest);
  warm += (orAssigned(honest) === honest ? 1 : 0) + (andAssigned(honest) === "replaced" ? 1 : 0) + countTruthy([honest]) + (new Slot(honest).filled() ? 1 : 0);
  warm += lengthHolder({ length: 0 }).length + fixable({ toFixed: () => "" }).length + maybe({ length: 0 }).length + (chained({ length: i }) ?? 0);
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": if", () => ifElse(value));
  attempt(name + ": ?:", () => conditional(value));
  attempt(name + ": !", () => negated(value));
  attempt(name + ": !!", () => twiceNegated(value));
  attempt(name + ": Boolean()", () => asBoolean(value));
  attempt(name + ": &&", () => and(value));
  attempt(name + ": ||", () => or(value));
  attempt(name + ": ??", () => nullish(value));
  attempt(name + ": while", () => loops(value));
  attempt(name + ": ||=", () => orAssigned(value));
  attempt(name + ": &&=", () => andAssigned(value));
  attempt(name + ": in a field", () => new Slot(value).filled());
}
attempt("truthy among all", () => countTruthy(values.map(([, value]) => value)));
attempt("length holders", () => [lengthHolder(""), lengthHolder("a"), lengthHolder([]), lengthHolder({ length: 0 })]);
attempt("numbers with toFixed", () => [fixable(0), fixable(-0), fixable(NaN), fixable(1), fixable(new Number(0))]);
attempt("maybe a length holder", () => [maybe(""), maybe("a"), maybe(undefined), maybe([]), maybe({ length: 0 })]);
attempt("chained", () => [chained(""), chained("ab"), chained(undefined), chained([])]);
