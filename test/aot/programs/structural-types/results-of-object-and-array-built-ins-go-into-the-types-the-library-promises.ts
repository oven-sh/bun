interface Point {
  x: number;
  y: number;
}

class Pixel implements Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

function sum(p: Point): number {
  return p.x + p.y;
}

function total(numbers: number[]): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}

const point: Point = { x: 1, y: 2 };
const points: Point[] = [{ x: 1, y: 2 }, new Pixel(3, 4), { y: 6, x: 5 }];
const counts: Record<string, number> = { a: 1, b: 2 };

attempt("Object.values", () => {
  const values: number[] = Object.values(counts);
  const members: number[] = Object.values(point);
  return [total(values), total(members)];
});
attempt("Object.entries", () => {
  const entries: [string, number][] = Object.entries(counts);
  let result = 0;
  for (const [name, n] of entries) result += n + name.length;
  return result;
});
attempt("Object.keys", () => {
  const keys: string[] = Object.keys(point);
  return keys.map(key => key.length);
});
attempt("Object.assign", () => {
  const both: Point & { z: number } = Object.assign({ x: 1, y: 2 }, { z: 3 });
  const three: Point & { z: number } & { w: string } = Object.assign({ x: 1, y: 2 }, { z: 3 }, { w: "w" });
  return [sum(both) + both.z, three.w.length, Object.keys(three).join()];
});
attempt("Object.freeze, seal and preventExtensions", () => {
  const frozen: Readonly<Point> = Object.freeze({ x: 1, y: 2 });
  const sealed: Point = Object.seal({ x: 3, y: 4 });
  const closed: Point = Object.preventExtensions({ x: 5, y: 6 });
  return [sum(frozen), sum(sealed), sum(closed)];
});
attempt("Object.defineProperty and defineProperties", () => {
  const one: Point = Object.defineProperty({ x: 1, y: 2 }, "x", { value: 10 });
  const two: Point = Object.defineProperties({ x: 1, y: 2 }, { y: { value: 20 } });
  return [sum(one), sum(two)];
});
attempt("Object.groupBy and Map.groupBy", () => {
  const groups: Partial<Record<"small" | "large", Point[]>> = Object.groupBy(points, p => (p.x < 3 ? "small" : "large"));
  const map: Map<boolean, Point[]> = Map.groupBy(points, p => p.x < 3);
  return [groups.small?.map(sum), groups.large?.map(sum), map.get(true)?.length, map.get(false)?.map(sum)];
});
attempt("structuredClone", () => {
  const copy: Point = structuredClone(point);
  const copies: Point[] = structuredClone(points);
  return [sum(copy), copies.map(sum), copy === point];
});
attempt("Array.from and Array.of", () => {
  const fromSet: number[] = Array.from(new Set([1, 2]));
  const mapped: Point[] = Array.from({ length: 2 }, (_, i) => ({ x: i, y: i }));
  const fromMap: [string, Point][] = Array.from(new Map([["a", point]]));
  const listed: Point[] = Array.of(point, new Pixel(1, 1));
  return [total(fromSet), mapped.map(sum), sum(fromMap[0][1]), listed.map(sum)];
});
attempt("copies of a list", () => {
  const sorted: Point[] = points.toSorted((a, b) => b.x - a.x);
  const reversed: Point[] = points.toReversed();
  const spliced: Point[] = points.toSpliced(0, 1);
  const replaced: Point[] = points.with(0, { x: 9, y: 9 });
  const sliced: Point[] = points.slice(1);
  const joined: Point[] = points.concat([{ x: 7, y: 8 }], { x: 9, y: 10 });
  return [sorted.map(sum), reversed.map(sum), spliced.map(sum), replaced.map(sum), sliced.map(sum), joined.map(sum)];
});
attempt("elements", () => {
  const last: Point | undefined = points.at(-1);
  const found: Point | undefined = points.find(p => p.x === 3);
  const foundLast: Point | undefined = points.findLast(p => p.x > 0);
  const none: Point | undefined = points.find(p => p.x === 99);
  return [last && sum(last), found && sum(found), foundLast && sum(foundLast), none];
});
attempt("flat, flatMap, map, filter, reduce", () => {
  const flat: number[] = [[1], [2, 3]].flat();
  const deep: number[] = [[1, [2]], [[3]]].flat(2);
  const many: number[] = points.flatMap(p => [p.x, p.y]);
  const sums: number[] = points.map(sum);
  const large: Point[] = points.filter(p => p.x > 1);
  const reduced: Point = points.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y }));
  return [total(flat), total(deep), total(many), total(sums), large.map(sum), sum(reduced)];
});
attempt("entries, keys and values of a list", () => {
  const entries: [number, Point][] = [...points.entries()];
  const keys: number[] = [...points.keys()];
  const values: Point[] = [...points.values()];
  return [entries.map(([i, p]) => i + sum(p)), total(keys), values.map(sum)];
});
attempt("iterator helpers", () => {
  const doubled: number[] = [1, 2, 3].values().map(n => n * 2).toArray();
  const some: Point[] = points.values().filter(p => p.x > 1).take(1).toArray();
  return [total(doubled), some.map(sum)];
});
attempt("sets", () => {
  const union: Set<number> = new Set([1, 2]).union(new Set([2, 3]));
  const common: Set<number> = new Set([1, 2]).intersection(new Set([2, 3]));
  return [total([...union]), total([...common])];
});

let warm = 0;
for (let i = 0; i < 500; i++) warm += total(Object.values(counts)) + sum(structuredClone(point)) + total(points.map(sum)) + sum(points.toSorted((a, b) => a.x - b.x)[0]) + sum(Object.assign({ x: i, y: 1 }, { z: 1 }));
console.log("500 rounds: " + warm);

export {};
