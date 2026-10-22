import "./setup.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

declare const ambientCount: number;
declare let ambientName: string;
declare var ambientList: number[];
declare const ambientPoint: { x: number; y: number };
declare const ambientStep: (n: number) => number;
declare function ambientTwice(n: number): number;
declare function ambientGone(): number;
declare class AmbientBox<T> {
  value: T;
  constructor(value: T);
  get(): T;
  size(): number;
}
declare namespace AmbientTools {
  const scale: number;
  function grow(n: number): number;
  function shrink(n: number): number;
}
declare enum AmbientMode {
  On = 1,
  Off = 0,
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

attempt("honest", () => [plusOne(1), size("ab"), total([1, 2])]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab") + total([i]);
console.log("2000 honest rounds", warm);

attempt("a constant", () => [ambientCount, ambientCount + 1, plusOne(ambientCount), typeof ambientCount, ambientCount * 2]);
attempt("a variable", () => [ambientName, ambientName + "!", typeof ambientName]);
attempt("a variable: size", () => size(ambientName));
attempt("a variable: a method", () => ambientName.toUpperCase());
attempt("a list", () => [total(ambientList), ambientList.length, ambientList[0]]);
attempt("a list: a method", () => ambientList.map(plusOne));
attempt("a list: iterated", () => {
  let sum = 0;
  for (const n of ambientList) sum += n;
  return sum;
});
attempt("a point", () => [ambientPoint.x + ambientPoint.y, ambientPoint.x + 1, ambientPoint.y]);
attempt("a function-typed constant", () => ambientStep(1));
attempt("a function", () => [ambientTwice(2), plusOne(ambientTwice(2)), typeof ambientTwice(2)]);
attempt("a function that is not there", () => ambientGone());
attempt("a class", () => {
  const box = new AmbientBox(5);
  return [box.value, box.get(), plusOne(box.get()), plusOne(box.value), Object.keys(box), box instanceof AmbientBox];
});
attempt("a class: a method that is not there", () => new AmbientBox("s").size());
attempt("a class: extended", () => {
  class Counted extends AmbientBox<number> {
    next(): number {
      return this.get() + 1;
    }
    field(): number {
      return this.value + 1;
    }
  }
  return [new Counted(1).next(), new Counted(1).field()];
});
attempt("a namespace", () => [AmbientTools.scale, AmbientTools.scale + 1, AmbientTools.grow(1), plusOne(AmbientTools.grow(1))]);
attempt("a namespace: a function that is not there", () => AmbientTools.shrink(1));
attempt("an enum", () => [AmbientMode.On, AmbientMode.Off, AmbientMode.On === 1, AmbientMode.On + 1, AmbientMode[1], AmbientMode[0]]);
attempt("stored to", () => {
  ambientName = "stored";
  ambientList = [1, 2];
  return [size(ambientName), total(ambientList)];
});
attempt("honest again", () => [plusOne(1), size("ab"), total([1, 2])]);
