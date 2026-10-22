import { runInNewContext } from "node:vm";

interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function asNumbers(u: unknown): unknown {
  if (!Array.isArray(u)) return "no list";
  const list: number[] = u;
  let sum = 0;
  for (const n of list) sum += n;
  return [sum, total(list), list.length, list.map(n => n * 2), list[0] + 1];
}

function asPoints(u: unknown): unknown {
  if (!Array.isArray(u)) return "no list";
  const list: Point[] = u;
  let sum = 0;
  for (const p of list) sum += p.x + p.y;
  return [sum, list.map(p => p.x)];
}

function asTexts(u: unknown): unknown {
  if (!Array.isArray(u)) return "no list";
  const list: string[] = u;
  return [list.map(s => s.length), list.join("+")];
}

function firstAsNumber(u: unknown): unknown {
  if (!Array.isArray(u)) return "no list";
  const n: number = u[0];
  const [, m]: number[] = u;
  return [n + 1, m + 1, typeof n];
}

function pushedTo(u: unknown): unknown {
  if (!Array.isArray(u)) return "no list";
  const list: number[] = u;
  const length = list.push(9);
  return [length, list.length, list[list.length - 1], list.pop()];
}

class Loud extends Array<number> {
  push(...items: number[]): number {
    log.push("push");
    return super.push(...items) + 100;
  }
  map<U>(f: (n: number, i: number, all: number[]) => U): U[] {
    log.push("map");
    return [];
  }
  *[Symbol.iterator](): ArrayIterator<number> {
    log.push("iterate");
    yield 1000;
  }
}

const lists: [string, () => unknown][] = [
  ["numbers", () => [1, 2]],
  ["texts", () => ["a", "b"]],
  ["mixed", () => [1, "b", null, undefined, true]],
  ["points", () => [{ x: 1, y: 2 }]],
  ["points with texts", () => [{ x: "1", y: 2 }, { y: 1 }]],
  ["empty", () => []],
  ["holes", () => [, 1, ,]],
  ["only holes", () => Array(2)],
  ["bigints", () => [1n]],
  ["lists", () => [[1], [2]]],
  ["a subclass", () => Loud.from([1, 2])],
  [
    "a proxy",
    () =>
      new Proxy([1, 2], {
        get(target, key, receiver) {
          log.push("get " + String(key));
          return Reflect.get(target, key, receiver);
        },
      }),
  ],
  ["frozen", () => Object.freeze([1, 2])],
  ["another prototype", () => Object.setPrototypeOf([1, 2], { length: "inherited" })],
  ["no prototype", () => Object.setPrototypeOf([1, 2], null)],
  ["an own method", () => Object.assign([1, 2], { map: () => "own map", push: () => "own push" })],
  ["another realm", () => runInNewContext("[1, 2]")],
  ["another realm, texts", () => runInNewContext("['a', 'b']")],
  ["an array-like", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a text", () => "12"],
];

const uses: [string, (u: unknown) => unknown][] = [
  ["numbers", asNumbers],
  ["points", asPoints],
  ["texts", asTexts],
  ["its first", firstAsNumber],
  ["pushed to", pushedTo],
];

for (const [use, run] of uses) {
  let rounds = 0;
  const honest = use === "points" ? [{ x: 1, y: 2 }] : use === "texts" ? ["a"] : [1, 2];
  for (let i = 0; i < 2000; i++) {
    run(honest);
    rounds++;
  }
  console.log("as " + use + ": " + rounds + " honest rounds");
  for (const [name, make] of lists) attempt("as " + use + ", " + name, () => run(make()));
}
