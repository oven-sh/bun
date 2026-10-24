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

import { deprecate } from "node:util";

type Scale = (value: number, factor?: number) => number;

function scale(this: unknown, value: number, factor: number = 2): number {
  return value * factor;
}

class Ruler {
  unit = 10;
  measure(value: number): number {
    return value * this.unit;
  }
}

function callIt(f: Scale, value: number): number {
  return f(value);
}

function callWithBoth(f: Scale, value: number): number {
  return f(value, 3);
}

function facts(f: Scale): unknown[] {
  return [typeof f, f.name, f.length, "prototype" in f, f === scale];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += callIt(scale, i) + callWithBoth(scale, i) + facts(scale).length;
console.log("after 2000 honest calls", warm);

const quiet = process.noDeprecation;
process.noDeprecation = true;

const makers: [string, () => Scale][] = [
  ["the function", () => scale],
  ["bound to nothing", () => scale.bind(undefined)],
  ["bound to a first argument", () => scale.bind(undefined, 5)],
  ["bound to both arguments", () => scale.bind(undefined, 5, 6)],
  ["bound twice", () => scale.bind(undefined).bind(undefined)],
  ["a proxy", () => new Proxy(scale, {})],
  ["marked as deprecated", () => deprecate(scale, "zzold")],
  ["with members assigned", () => Object.assign(scale.bind(undefined), { extra: 1 })],
  ["an arrow function around it", () => (value, factor) => scale(value, factor)],
  ["a method bound to its object", () => {
    const ruler = new Ruler();
    return ruler.measure.bind(ruler);
  }],
  ["a method taken off its object", () => new Ruler().measure],
  ["a built-in", () => Math.abs],
];
for (const [name, make] of makers) {
  attempt(name + ": called", () => callIt(make(), 4));
  attempt(name + ": called with both", () => callWithBoth(make(), 4));
  attempt(name + ": facts", () => facts(make()));
  attempt(name + ": handed to map", () => [1, 2].map(make()));
  attempt(name + ": call and apply", () => [make().call(undefined, 4), make().apply(undefined, [4, 3])]);
}
process.noDeprecation = quiet;
attempt("honest again", () => [callIt(scale, 4), callWithBoth(scale, 4)]);
