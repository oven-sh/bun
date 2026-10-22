const log: string[] = [];

class Bag {
  items: number[];
  constructor(...items: number[]) {
    this.items = items;
  }
  *[Symbol.iterator](): Generator<number, void, unknown> {
    log.push("class iterator");
    yield* this.items;
  }
}

function sum(b: Bag): number {
  let total = 0;
  for (const n of b) total += n;
  return total;
}

function spread(b: Bag): string {
  return [...b].join();
}

function firstTwo(b: Bag): string {
  const [x, y] = b;
  return x + " " + y;
}

function largest(b: Bag): number {
  return Math.max(...b);
}

function* through(b: Bag): Generator<number, void, unknown> {
  yield* b;
}

function all(b: Bag): string {
  return [sum(b), spread(b), firstTwo(b), largest(b), Array.from(b).join(), new Set(b).size, [...through(b)].join(), new Map([...b].map(n => [n, n])).size].join(" | ");
}

function round(label: string, b: Bag): void {
  log.length = 0;
  console.log(label + ": " + all(b) + " {" + log.length + " " + [...new Set(log)].join() + "}");
}

const b = new Bag(1, 2, 3);
const other = new Bag(10, 20);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(b) + largest(b) + sum(other);
console.log("2000 honest: " + warm);
round("the class's", b);

export {};
