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

b[Symbol.iterator] = function* () {
  log.push("own generator");
  yield 100;
  yield 200;
};
round("an own generator function", b);
round("the other", other);

b[Symbol.iterator] = function* () {
  log.push("backwards");
  for (let i = this.items.length - 1; i >= 0; i--) yield this.items[i];
};
round("one that reads this", b);

Reflect.deleteProperty(b, Symbol.iterator);
round("uncovered", b);

const original = Bag.prototype[Symbol.iterator];
Bag.prototype[Symbol.iterator] = function* () {
  log.push("patched");
  for (const n of this.items) yield n * 2;
};
round("replaced on the prototype", b);
round("the other", other);
Bag.prototype[Symbol.iterator] = original;
round("put back", b);

const swapping = new Bag(1, 2, 3, 4);
const seen: number[] = [];
for (const n of swapping) {
  seen.push(n);
  if (n === 2)
    swapping[Symbol.iterator] = function* () {
      yield -1;
    };
}
console.log("replaced while a loop runs: " + seen.join() + ", the next loop: " + spread(swapping));

export {};
