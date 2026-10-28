// `strictNullChecks` of a file is that of the tsconfig.json nearest to it, like every other compiler option.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { build, expectSameAnswerAsBunRun, expectWhatEachProjectReports, type Files } from "./harness/projects";
import { run } from "./harness/run";
import { test } from "./supported";

const shared = { allowImportingTsExtensions: true, noEmit: true, target: "esnext", module: "esnext" };
const options = (compilerOptions: object) => JSON.stringify({ compilerOptions: { ...shared, ...compilerOptions } });
const strict = options({ strict: true });
const loose = options({ strict: false });

const returnsUndefined = `export function first(list: number[]): number { return list.length ? list[0] : undefined; }\n`;
const usesFirst = `import { first } from "./inner/lib.ts";\nconsole.log(first([]), first([4]));\n`;

const projects: [title: string, files: Files][] = [
  [
    "undefined for a number, in a file without the option below an entry point that has it",
    { "main.ts": usesFirst, "tsconfig.json": strict, "inner/lib.ts": returnsUndefined, "inner/tsconfig.json": loose },
  ],
  [
    "undefined for a number, in a file with the option below an entry point that lacks it",
    { "main.ts": usesFirst, "tsconfig.json": loose, "inner/lib.ts": returnsUndefined, "inner/tsconfig.json": strict },
  ],
  [
    "an element for a number, under noUncheckedIndexedAccess without strictNullChecks",
    {
      "main.ts": usesFirst,
      "tsconfig.json": strict,
      "inner/lib.ts": `export function first(list: number[]): number { return list[0]; }\n`,
      "inner/tsconfig.json": options({ strict: false, noUncheckedIndexedAccess: true }),
    },
  ],
  [
    "a string for a number, in a file without the option",
    {
      "main.ts": usesFirst,
      "tsconfig.json": strict,
      "inner/lib.ts": `export function first(list: number[]): number { return list.length ? "none" : undefined; }\n`,
      "inner/tsconfig.json": loose,
    },
  ],
  [
    "a member of what may be undefined, in a file with the option below an entry point that lacks it",
    {
      "main.ts": `import { size } from "./inner/lib.ts";\nconsole.log(size("a"));\n`,
      "tsconfig.json": loose,
      "inner/lib.ts": `export function size(text?: string): number { return text.length; }\n`,
      "inner/tsconfig.json": strict,
    },
  ],
  [
    "two folders without the option, one of them with noImplicitAny",
    {
      "main.ts": `import { first } from "./one/lib.ts";\nimport { twice } from "./two/lib.ts";\nconsole.log(first([]), twice(2));\n`,
      "tsconfig.json": strict,
      "one/lib.ts": returnsUndefined + `export function same(n) { return n; }\n`,
      "one/tsconfig.json": loose,
      "two/lib.ts": `export function twice(n): number { return n ? n * 2 : null; }\n`,
      "two/tsconfig.json": options({ strict: true, strictNullChecks: false }),
    },
  ],
  [
    "two folders without the option",
    {
      "main.ts": `import { first } from "./one/lib.ts";\nimport { twice } from "./two/lib.ts";\nconsole.log(first([]), twice(2), twice(0));\n`,
      "tsconfig.json": strict,
      "one/lib.ts": returnsUndefined + `export function same(n) { return n; }\n`,
      "one/tsconfig.json": loose,
      "two/lib.ts": `export function twice(n: number): number { return n ? n * 2 : null; }\n`,
      "two/tsconfig.json": options({ strict: true, strictNullChecks: false }),
    },
  ],
  [
    "undefined for a number, in a folder with the option below one without it",
    {
      "main.ts": usesFirst,
      "tsconfig.json": strict,
      "inner/lib.ts": `import { none } from "./deep/lib.ts";\nexport function first(list: number[]): number { return list.length ? list[0] : none(); }\n`,
      "inner/tsconfig.json": loose,
      "inner/deep/lib.ts": `export function none(): number { return undefined; }\n`,
      "inner/deep/tsconfig.json": strict,
    },
  ],
  [
    "what may be undefined for a number, in a folder without the option above one with it",
    {
      "main.ts": usesFirst,
      "tsconfig.json": strict,
      "inner/lib.ts": `import { none } from "./deep/lib.ts";\nexport function first(list: number[]): number { return list.length ? list[0] : none(); }\n`,
      "inner/tsconfig.json": loose,
      "inner/deep/lib.ts": `export function none(): number | undefined { return undefined; }\n`,
      "inner/deep/tsconfig.json": strict,
    },
  ],
];

test.each(projects)(
  "a build reports what `bun check` reports in the project of each file: %s",
  async (_, files) => {
    await expectWhatEachProjectReports(files);
  },
  240_000,
);

test("a package with a tsconfig.json of its own keeps its types", async () => {
  await expectSameAnswerAsBunRun({
    "main.ts": `import { first } from "inner";\nconsole.log(first([]), first([4]));\n`,
    "tsconfig.json": strict,
    "node_modules/inner/lib.ts": returnsUndefined,
    "node_modules/inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0", main: "./lib.ts" }),
    "node_modules/inner/tsconfig.json": loose,
  });
}, 240_000);

test("a type error in a package with a tsconfig.json of its own is a warning, beside a folder of the program without the option", async () => {
  using folder = tempDir("aot-null-checks", {
    "main.ts": `import { first } from "inner";\nimport { last } from "./mine/lib.ts";\nconsole.log(first([]), first([4]), last([]), last([5]));\n`,
    "tsconfig.json": strict,
    "mine/lib.ts": `export function last(list: number[]): number { return list.length ? list[list.length - 1] : null; }\n`,
    "mine/tsconfig.json": loose,
    "node_modules/inner/lib.ts": `export function first(list: number[]): number { return list.length ? "none" : undefined; }\n`,
    "node_modules/inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0", main: "./lib.ts" }),
    "node_modules/inner/tsconfig.json": loose,
  });
  const dir = String(folder);
  const built = await build(dir);
  expect(built.stderr).toContain("warn: TS100009: 'inner' has 1 type error");
  expect(built.stderr).not.toContain("error: TS");
  expect(built.exitCode).toBe(0);
  const [compiled, plain] = [await run([built.outfile], dir), await run([bunExe(), "run", "./main.ts"], dir)];
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 240_000);

const looseLibrary = `export class Point {
  x: number;
  y: number;
  label: string;
  next: Point;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
export function numberOrNothing(flag: boolean): number {
  return flag ? 1.5 : undefined;
}
export function integerOrNull(flag: boolean): number {
  return flag ? 7 : null;
}
export function textOrNothing(flag: boolean): string {
  return flag ? "text" : undefined;
}
export function flagOrNull(flag: boolean): boolean {
  return flag ? true : null;
}
export function pointOrNothing(flag: boolean): Point {
  return flag ? new Point(1, 2) : undefined;
}
export function callWithNothing(callback: (n: number, s: string, p: Point, b: boolean) => string): string {
  return callback(undefined, null, undefined, null);
}
export function emptyFields(point: Point): void {
  point.x = undefined;
  point.y = null;
  point.label = undefined;
}
export function emptyPair(pair: { left: number; right: string }): void {
  pair.left = null;
  pair.right = undefined;
}
export function numbersWithGaps(): number[] {
  return [1.5, undefined, 2.5, null];
}
export function integersWithGaps(): number[] {
  return [1, null, 2, undefined];
}
export function pushNothing(list: number[]): void {
  list.push(undefined);
  list[0] = null;
}
export function textsWithGaps(): string[] {
  return ["a", undefined, null];
}
export function pick<T>(list: T[], index: number): T {
  return index < list.length ? list[index] : undefined;
}
export class Box<T> {
  value: T;
  constructor(value?: T) {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
}
export const counts = new Map<string, number>([
  ["a", 1],
  ["b", undefined],
  ["c", null],
]);
export let total: number = undefined;
export const settings: { port: number; host: string } = { port: undefined, host: null };
export function later(flag: boolean): Promise<number> {
  return Promise.resolve(flag ? 3 : undefined);
}
`;

const usesLooseLibrary = `import {
  Box,
  Point,
  callWithNothing,
  counts,
  emptyFields,
  emptyPair,
  flagOrNull,
  integerOrNull,
  integersWithGaps,
  later,
  numberOrNothing,
  numbersWithGaps,
  pick,
  pointOrNothing,
  pushNothing,
  settings,
  textOrNothing,
  textsWithGaps,
  total,
} from "./inner/lib.ts";

function show(label: string, value: unknown) {
  console.log(label, typeof value, String(value));
}
function addOne(n: number): number {
  return n + 1;
}
function twice(n: number): number {
  return n * 2;
}
function bits(n: number): number {
  return (n | 0) + (n >>> 1);
}
function size(s: string): number {
  try {
    return s.length;
  } catch {
    return -1;
  }
}
function sumOf(p: Point): number {
  try {
    return p.sum();
  } catch {
    return -1;
  }
}
function sum(list: number[]): number {
  let result = 0;
  for (const n of list) result += n;
  return result;
}
function sumByIndex(list: number[]): number {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i] as number;
  return result;
}

for (const flag of [true, false]) {
  const n = numberOrNothing(flag);
  show("number", n);
  show("number + 1", addOne(n));
  show("number * 2", twice(n));
  show("number bits", bits(n));
  show("number is undefined", n === undefined);
  show("number or 5", n ?? 5);
  show("number text", \`\${n}\`);
  const i = integerOrNull(flag);
  show("integer", i);
  show("integer + 1", addOne(i));
  show("integer bits", bits(i));
  show("integer is null", i === null);
  show("integer < 1", i < 1);
  const s = textOrNothing(flag);
  show("text", s);
  show("text size", size(s));
  show("text + !", s + "!");
  const b = flagOrNull(flag);
  show("flag", b);
  show("flag not", !b);
  show("flag is false", b === false);
  const p = pointOrNothing(flag);
  show("point", p === undefined ? "nothing" : p.sum());
  show("point sum", sumOf(p));
}
show(
  "callback",
  callWithNothing((n, s, p, b) => \`\${n + 1} \${s + "!"} \${typeof p} \${b === false} \${n === undefined} \${s === null}\`),
);
const point = new Point(3, 4);
show("fields before", point.sum());
emptyFields(point);
show("field x", point.x);
show("field y", point.y);
show("field label", point.label);
show("field next", point.next);
show("fields sum", point.sum());
show("field x + 1", addOne(point.x));
show("field y + 1", addOne(point.y));
const pair = { left: 1, right: "r" };
emptyPair(pair);
show("pair left", pair.left);
show("pair left + 1", pair.left + 1);
show("pair right", pair.right);
const gaps = numbersWithGaps();
show("elements", gaps.join());
show("elements sum", sum(gaps));
show("elements by index", sumByIndex(gaps));
show("element 1", gaps[1]);
show("element 3", gaps[3]);
show("elements mapped", gaps.map(n => n + 1).join());
show("integers sum", sum(integersWithGaps()));
show("integers mapped", integersWithGaps().map(n => n | 0).join());
const mine = [1.5, 2.5];
pushNothing(mine);
show("mine", JSON.stringify(mine));
show("mine sum", sum(mine));
show("mine by index", sumByIndex(mine));
show("texts", textsWithGaps().map(size).join());
show("pick in", addOne(pick([1, 2], 1)));
show("pick out", addOne(pick([1, 2], 2)));
show("pick text out", size(pick(["a"], 5)));
show("box", addOne(new Box<number>().get()));
show("box value", new Box<number>().value);
show("box full", addOne(new Box<number>(4).get()));
for (const [key, value] of counts) show("count " + key, addOne(value));
show("total", total);
show("total + 1", addOne(total));
show("port", settings.port);
show("port + 1", addOne(settings.port));
show("host", size(settings.host));
show("later", addOne(await later(true)));
show("later nothing", addOne(await later(false)));
`;

const strictLibrary = `export class Point {
  x: number;
  y: number;
  label: string = "p";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
export function addOne(n: number): number {
  return n + 1;
}
export function bits(n: number): number {
  return (n | 0) + (n >>> 1);
}
export function size(s: string): number {
  return s.length;
}
export function shout(s: string): string {
  return s + "!";
}
export function not(b: boolean): boolean {
  return !b;
}
export function describe(p: Point): string {
  return p.label + ":" + p.sum();
}
export function sum(list: number[]): number {
  let result = 0;
  for (const n of list) result += n;
  return result;
}
export function sumByIndex(list: number[]): number {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i]!;
  return result;
}
export function first<T>(list: T[]): T | undefined {
  return list[0];
}
export class Box<T> {
  constructor(public value: T) {}
  map<U>(change: (value: T) => U): Box<U> {
    return new Box(change(this.value));
  }
}
export function orDefault(n: number | undefined): number {
  return n === undefined ? -1 : n;
}
export function isNull(n: number | null): boolean {
  return n === null;
}
export function lengthOrZero(s?: string): number {
  return s === undefined ? 0 : s.length;
}
export const registry: Map<string, number> = new Map();
export function totalOfRegistry(): number {
  let result = 0;
  for (const value of registry.values()) result += value;
  return result;
}
export const numbers: number[] = [1.5, 2.5];
export const origin = new Point(0, 0);
export function maybe(flag: boolean): number | null {
  return flag ? 1 : null;
}
export function apply(change: (n: number) => number, n: number): number {
  return change(n) + 1;
}
`;

const looseUserOfStrictLibrary = `import {
  Box,
  Point,
  addOne,
  apply,
  bits,
  describe,
  first,
  isNull,
  lengthOrZero,
  maybe,
  not,
  numbers,
  orDefault,
  origin,
  registry,
  shout,
  size,
  sum,
  sumByIndex,
  totalOfRegistry,
} from "./inner/lib.ts";

function show(label: string, value: unknown) {
  console.log(label, typeof value, String(value));
}
function attempt(label: string, run: () => unknown) {
  try {
    show(label, run());
  } catch (error) {
    show(label, error instanceof TypeError ? "TypeError" : "another error");
  }
}
const nothing: number = undefined;
const none: number = null;
const noText: string = undefined;
const noPoint: Point = null;
show("addOne undefined", addOne(nothing));
show("addOne null", addOne(none));
show("addOne literal", addOne(undefined));
show("bits undefined", bits(nothing));
show("bits null", bits(null));
attempt("size undefined", () => size(noText));
show("shout undefined", shout(noText));
show("shout null", shout(null));
show("not undefined", not(undefined));
attempt("describe null", () => describe(noPoint));
const point = new Point(undefined, null);
show("point x", point.x);
show("point y", point.y);
show("point sum", point.sum());
show("describe", describe(point));
point.label = undefined;
show("describe without label", describe(point));
origin.x = null;
origin.y = undefined;
show("origin", describe(origin));
show("sum", sum([1, undefined, 2]));
show("sum null", sum([1.5, null, 2]));
show("sumByIndex", sumByIndex([1, undefined, 2]));
show("sumByIndex null", sumByIndex([null, 1.5]));
numbers.push(undefined);
numbers[0] = null;
show("numbers", JSON.stringify(numbers));
show("numbers sum", sum(numbers));
show("numbers by index", sumByIndex(numbers));
show("first", first([undefined, 1]));
show("first empty", addOne(first([])));
show("box", new Box<number>(undefined).map(addOne).value);
show("box null", new Box<number>(null).map(n => n + 1).value);
show("orDefault", orDefault(undefined));
show("orDefault null", orDefault(null));
show("isNull", isNull(null));
show("isNull undefined", isNull(undefined));
show("lengthOrZero", lengthOrZero());
attempt("lengthOrZero null", () => lengthOrZero(null));
registry.set("a", 1);
registry.set("b", undefined);
registry.set("c", null);
show("registry", totalOfRegistry());
const some: number = maybe(false);
show("maybe", some);
show("maybe + 1", some + 1);
show("maybe true + 1", maybe(true) + 1);
show("apply", apply(n => undefined, 1));
show("apply null", apply(n => null, 1));
show("apply of nothing", apply(n => n * 2, undefined));
`;

const borders: [title: string, files: Files][] = [
  [
    "a file with the option uses one without it",
    {
      "main.ts": usesLooseLibrary,
      "tsconfig.json": strict,
      "inner/lib.ts": looseLibrary,
      "inner/tsconfig.json": loose,
    },
  ],
  [
    "a file without the option uses one with it",
    {
      "main.ts": looseUserOfStrictLibrary,
      "tsconfig.json": loose,
      "inner/lib.ts": strictLibrary,
      "inner/tsconfig.json": strict,
    },
  ],
  [
    "a file without the option uses one without it under another tsconfig.json",
    { "main.ts": usesLooseLibrary, "tsconfig.json": loose, "inner/lib.ts": looseLibrary, "inner/tsconfig.json": loose },
  ],
  [
    "classes on either side extend each other",
    {
      "main.ts": `import { Animal } from "./shared.ts";
import { Dog, describe, makeNameless } from "./inner/lib.ts";
class Puppy extends Dog {
  age: number = 1;
  older(): number {
    return this.age + this.legs;
  }
}
const puppy = new Puppy("rex");
console.log(puppy.name, puppy.legs, puppy.older(), puppy.speak(), puppy instanceof Animal, puppy instanceof Dog);
const nameless = makeNameless();
console.log(nameless.name, typeof nameless.name, nameless.speak(), nameless.legs, nameless.legs + 1, nameless.owner);
console.log(describe(puppy), describe(new Animal("cat")));
`,
      "tsconfig.json": strict,
      "shared.ts": `export class Animal {
  legs: number = 4;
  constructor(public name: string) {}
  speak(): string {
    return this.name + "?";
  }
}
export function count(list: Animal[]): number {
  return list.length;
}
`,
      "inner/lib.ts": `import { Animal, count } from "../shared.ts";
export class Dog extends Animal {
  owner: string;
  speak(): string {
    return super.speak() + "!" + this.owner;
  }
}
export function makeNameless(): Dog {
  const dog = new Dog(undefined);
  dog.legs = null;
  return dog;
}
export function describe(animal: Animal): string {
  return animal.name + count([animal, null]);
}
`,
      "inner/tsconfig.json": loose,
    },
  ],
];

test.each(borders)(
  "undefined and null in results, arguments, fields, elements and type arguments are what they are under `bun run`: %s",
  async (_, files) => {
    await expectSameAnswerAsBunRun(files);
  },
  240_000,
);
