function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

let calls = 0;

class Countdown implements Iterator<number>, Iterable<number> {
  left: number;
  constructor(left: number) {
    this.left = left;
  }
  next(): IteratorResult<number> {
    calls++;
    if (this.left > 0) return { value: this.left-- };
    return { done: true, value: undefined };
  }
  [Symbol.iterator](): Countdown {
    return this;
  }
}

function* honest(from: number): Generator<number, void, void> {
  for (let i = from; i > 0; i--) yield i;
}

function byNegation(it: Iterator<number>): number[] {
  const out: number[] = [];
  for (let r = it.next(); !r.done; r = it.next()) out.push(r.value);
  return out;
}

function byComparison(it: Iterator<number>): number[] {
  const out: number[] = [];
  for (let r = it.next(); r.done === false; r = it.next()) out.push(r.value);
  return out;
}

function keysOfTheFirst(it: Iterator<number>): string {
  const r = it.next();
  return Object.keys(r).join() + " | done in it: " + ("done" in r) + " | " + text(r.done) + " | " + text(r.value);
}

function* delegating(numbers: Iterable<number>): Generator<number, void, void> {
  yield* numbers;
}

const uses: [string, (make: () => Iterable<number> & Iterator<number>) => unknown][] = [
  ["by negation", make => byNegation(make())],
  ["by comparison with false", make => byComparison(make())],
  ["keys of the first result", make => keysOfTheFirst(make())],
  ["for-of", make => {
    const out: number[] = [];
    for (const n of make()) out.push(n);
    return out;
  }],
  ["spread", make => [...make()]],
  ["Array.from", make => Array.from(make())],
  ["destructuring", make => {
    const [x, y, z, w] = make();
    return [text(x), text(y), text(z), text(w)];
  }],
  ["yield*", make => [...delegating(make())]],
  ["yield*, first result", make => keysOfTheFirst(delegating(make()))],
  ["Iterator.from", make => Iterator.from(make()).toArray()],
  ["Math.min", make => Math.min(...make())],
];

for (const [label, use] of uses) {
  calls = 0;
  console.log(label + ", countdown: " + text(use(() => new Countdown(3))) + " after " + calls + " calls");
  console.log(label + ", generator: " + text(use(() => honest(3))));
}

let sum = 0;
for (let i = 0; i < 2000; i++) for (const n of honest(2)) sum += n;
for (const n of new Countdown(2)) sum += n;
console.log("2000 generators and one countdown at other sites: " + sum);

function total(numbers: Iterable<number>): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}
let grand = 0;
for (let i = 0; i < 2000; i++) grand += total(honest(2));
grand += total(new Countdown(4));
grand += total(honest(1));
console.log("2000 generators and one countdown at one site: " + grand);
