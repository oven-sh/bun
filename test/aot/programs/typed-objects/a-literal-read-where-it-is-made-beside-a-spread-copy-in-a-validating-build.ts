// A literal is read in the expression that makes it, one of its sources was changed through `any`, and another record of the same type is copied by a spread right behind. Built with --aot-validate.
type Pair = { x: number; y: number };
function text(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function describe(value: unknown): string {
  if (value === null || typeof value !== "object") return String(value);
  let all = value.constructor === Object ? "{" : value.constructor.name + "{";
  for (const key of Object.keys(value)) all += key + ":" + describe((value as Record<string, unknown>)[key]) + ";";
  return all + "}";
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
const kept: unknown[] = [];
function makePair(q: number): Pair {
  const first: Pair = { x: q, y: 2 };
  const same: Pair = first;
  return { x: first.x, y: same.y };
}
class Holder {
  inner: Pair = new Point(1, 2);
  list: number[] = [0.5, 1];
  constructor(x: number) {
    this.inner = { x: x + 1, y: 3 };
  }
}
class Runner {
  run(p: number, q: number): string {
    const first: Pair = makePair(q);
    const same: Pair = first;
    const holder = new Holder(p + 1);
    let other: Pair = new Point(0.5, p + 1);
    const numbers: number[] = [p + 1, q, 1];
    const loose = numbers as any;
    same.y += loose[1];
    other = holder.inner;
    let out = text({ x: first.x, y: same.y }.x) + " ";
    other = { ...other, x: 0 };
    kept.push({ held: first });
    out += [first.x, first.y, same.x, same.y, other.x, other.y].map(text).join() + " ";
    out += describe(holder) + (first === same) + (same === other);
    return out;
  }
}
for (let round = 0; round < 3; round++) console.log(new Runner().run(3, 60));
console.log(kept.length);
