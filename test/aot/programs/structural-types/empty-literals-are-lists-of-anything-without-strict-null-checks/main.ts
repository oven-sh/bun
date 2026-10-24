interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function total(numbers: number[]): number {
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

class Holder {
  n: number = null;
  p: Point = undefined;
  list: number[] = [];
  label: string;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([].concat([i, 1])) + plusOne(i) + sum({ x: i, y: 1 });
console.log("2000 honest rounds: " + warm);

attempt("concat on an empty literal", () => {
  const numbers: number[] = [].concat(1, "2", [3, "4"], [[5]], null);
  return [numbers, total(numbers), numbers.length];
});
attempt("concat on an empty literal, points", () => {
  const points: Point[] = [].concat({ x: 1, y: 2 }, [{ x: "3" }], 4);
  return points.map(sum);
});
attempt("an object that spreads itself", () => {
  const numbers: number[] = [].concat({ length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true });
  return [numbers, total(numbers)];
});
attempt("an empty literal in a member", () => {
  const state = { list: [], value: null, other: undefined };
  state.list.push("text", 1);
  state.value = "stored";
  state.other = [1];
  const numbers: number[] = state.list;
  const n: number = state.value;
  const p: Point = state.other;
  return [total(numbers), n + 1, p.x];
});
attempt("a result that is an empty literal", () => {
  const make = () => [];
  const numbers: number[] = make();
  const loose = make();
  loose.push("a");
  const texts: number[] = loose;
  return [numbers.length, total(texts)];
});
attempt("null and undefined in every type", () => {
  const n: number = null;
  const m: number = undefined;
  const s: string = null;
  const b: boolean = undefined;
  return [n + 1, m + 1, plusOne(n), plusOne(m), s + "!", !b, n === null, typeof m];
});
attempt("null for a point", () => {
  const p: Point = null;
  return sum(p);
});
attempt("null in lists", () => {
  const numbers: number[] = [1, null, undefined, 2];
  const points: Point[] = [null, { x: 1, y: 2 }];
  return [total(numbers), numbers.map(plusOne), points[1].x, points[0]];
});
attempt("fields", () => {
  const holder = new Holder();
  return [holder.n, holder.n + 1, holder.p, holder.label, holder.label + "!", Object.keys(holder).join(), JSON.stringify(holder)];
});
attempt("a member of a field that is undefined", () => new Holder().p.x);
attempt("the length of a field that was never set", () => new Holder().label.length);
attempt("results", () => {
  const find = (list: number[], wanted: number): number => list.find(n => n === wanted);
  const first = (list: Point[]): Point => list[0];
  return [find([1], 2), find([1], 2) + 1, plusOne(find([1], 2)), first([])];
});
attempt("a map", () => {
  const map = new Map<string, number>();
  const n: number = map.get("missing");
  return [n, n + 1];
});
