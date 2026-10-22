const log: string[] = [];

class Range {
  from: number;
  to: number;
  constructor(from: number, to: number) {
    this.from = from;
    this.to = to;
  }
  values(): Iterable<number> {
    log.push("values ran");
    const list: number[] = [];
    for (let i = this.from; i <= this.to; i++) list.push(i);
    return list;
  }
}

function sum(r: Range): number {
  let total = 0;
  for (const n of r.values()) total += n;
  return total;
}

function firstTwo(r: Range): string {
  const [a, b] = r.values();
  return a + " " + b;
}

function kind(r: Range): string {
  const made = r.values();
  return (Array.isArray(made) ? "an array" : Object.prototype.toString.call(made)) + " " + [...made].join();
}

function round(label: string, r: Range): void {
  console.log(label + ": sum " + sum(r) + ", first two " + firstTwo(r) + ", kind " + kind(r) + " [" + log.join(", ") + "]");
  log.length = 0;
}

const r = new Range(1, 4);
const other = new Range(10, 11);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(r) + sum(other);
log.length = 0;
console.log("2000 honest: " + warm);
round("the method", r);

r.values = function* () {
  log.push("generator started");
  try {
    yield 100;
    yield 200;
    yield 300;
  } finally {
    log.push("generator closed");
  }
};
round("an own generator function", r);
round("the other", other);

r.values = () => new Set([7, 7, 8]);
round("an own arrow that makes a set", r);

r.values = () => new Uint8Array([1, 2, 300]);
round("an own arrow that makes a typed array", r);

Reflect.deleteProperty(r, "values");
round("uncovered", r);

const original = Range.prototype.values;
Range.prototype.values = function* () {
  log.push("generator of " + this.from);
  for (let i = this.to; i >= this.from; i--) yield i;
};
round("a generator function on the prototype", r);
round("the other", other);
Range.prototype.values = original;
round("put back", r);

export {};
