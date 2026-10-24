function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function twice(numbers: Iterable<number>): string {
  let first = 0;
  let second = 0;
  let count = 0;
  for (const n of numbers) {
    first += n;
    count++;
  }
  for (const n of numbers) second += n;
  return first + " then " + second + " of " + count;
}

function average(numbers: Iterable<number>): number {
  const count = [...numbers].length;
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum / count;
}

function* oneShot(): Generator<number, void, void> {
  yield 1;
  yield 2;
  yield 3;
}

class Fresh implements Iterable<number> {
  made = 0;
  *[Symbol.iterator](): Generator<number, void, void> {
    this.made++;
    yield this.made * 10;
    yield this.made * 10 + 1;
  }
}

class Shared implements Iterable<number> {
  walker = oneShot();
  [Symbol.iterator](): Iterator<number> {
    return this.walker;
  }
}

class Growing implements Iterable<number> {
  items: number[] = [1];
  [Symbol.iterator](): Iterator<number> {
    this.items.push(this.items.length + 1);
    return this.items[Symbol.iterator]();
  }
}

let warm = "";
for (let i = 0; i < 2000; i++) warm = twice([1, 2, 3]);
console.log("2000 arrays: " + warm);

const cases: [string, () => Iterable<number>][] = [
  ["an array", () => [1, 2, 3]],
  ["a generator", oneShot],
  ["an array's iterator", () => [1, 2, 3].values()],
  ["a set", () => new Set([1, 2, 3])],
  ["a set's iterator", () => new Set([1, 2, 3]).values()],
  ["the keys of a map", () => new Map([[1, "x"], [2, "y"]]).keys()],
  ["a typed array", () => new Float64Array([1.5, 2.5])],
  ["fresh each time", () => new Fresh()],
  ["one shared walker", () => new Shared()],
  ["grows each time", () => new Growing()],
  ["a helper", () => [1, 2, 3].values().map(n => n * 2)],
];

for (const [label, make] of cases) {
  console.log(label + ", twice: " + twice(make()));
  console.log(label + ", average: " + text(average(make())));
}

console.log("an array again: " + twice([4, 5]));

function halfAndHalf(numbers: Iterable<number>): string {
  const head: number[] = [];
  for (const n of numbers) {
    head.push(n);
    if (head.length === 1) break;
  }
  return text(head) + " then " + text([...numbers]);
}

for (const [label, make] of cases) console.log(label + ", a break and then the rest: " + halfAndHalf(make()));
