// bump and the setter store into `this`, which they declare to be a Counter: they are methods. Somebody constructs them all the same.
interface Counter { count: number; step: number; bump(): number; stride: number }
function Counter(this: Counter, step: number) {
  this.count = 0;
  this.step = step;
}
Counter.prototype.bump = function bump(this: Counter) {
  this.count += this.step;
  return this.count;
};
const descriptor = {
  set: function setStride(this: Counter, step: number) {
    this.step = step;
  },
  get: function getStride(this: Counter) {
    return this.step;
  },
};
Object.defineProperty(Counter.prototype, "stride", descriptor);
const CounterConstructor = Counter as unknown as new (step: number) => Counter;

const lines: string[] = [];
const counter = new CounterConstructor(2);
let total = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) counter.stride = 3;
  total += counter.bump();
}
lines.push(String(total), Object.keys(counter).join(","), String(counter.stride));

type Constructible = new (...values: unknown[]) => Record<string, unknown>;
const Bump = counter.bump as unknown as Constructible;
const bumped = new Bump();
lines.push(Object.keys(bumped).join(","), String(bumped.count), String(bumped instanceof Bump), String(bumped instanceof Counter));
lines.push(String(Object.getPrototypeOf(bumped) === Bump.prototype));

const SetStride = descriptor.set as unknown as Constructible;
const made = new SetStride(7);
lines.push(JSON.stringify(made), String(made instanceof SetStride));

// What the method made is handed to the method, and to the other one.
lines.push(String(counter.bump.call(made as unknown as Counter)), JSON.stringify(made));
(made as unknown as Counter).count = 1;
lines.push(String(counter.bump.call(made as unknown as Counter)), JSON.stringify(made));
descriptor.set.call(bumped as unknown as Counter, 5);
lines.push(JSON.stringify(bumped));

// Many of them, beside the real ones, through one function.
function countOf(value: Counter): number {
  return value.count + value.step;
}
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const value = i % 3 === 0 ? (new SetStride(i) as unknown as Counter) : new CounterConstructor(i);
  const count = countOf(value);
  sum += count === count ? count : 1;
}
lines.push(String(sum));
console.log(lines.join("\n"));
