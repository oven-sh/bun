function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type MakesPromise = () => Promise<number>;
type MakesIterator = () => Iterator<number>;
type MakesIterable = () => Iterable<number>;

const asyncArrow: MakesPromise = async () => 1;
const plainPromise: MakesPromise = () => Promise.resolve(2);
const thenableClass: MakesPromise = () => new (class Sub extends Promise<number> {})(resolve => resolve(3));
async function throwsLater(): Promise<number> {
  throw new RangeError("later");
}
function throwsNow(): Promise<number> {
  throw new RangeError("now");
}

function* generator(): Generator<number> {
  yield 1;
  yield 2;
}
const handMade: MakesIterator = () => {
  let n = 0;
  return { next: () => (n < 2 ? { done: false, value: ++n * 10 } : { done: true, value: undefined }) };
};
const fromArray: MakesIterator = () => [5, 6][Symbol.iterator]();

function drain(make: MakesIterator): string {
  const it = make();
  const out: number[] = [];
  for (let r = it.next(); !r.done; r = it.next()) out.push(r.value);
  return out.join();
}
function collect(make: MakesIterable): string {
  return [...make()].join();
}

show("drain a generator", () => drain(generator));
show("drain a hand-made iterator", () => drain(handMade));
show("drain an array's iterator", () => drain(fromArray));
show("collect a generator", () => collect(generator));
show("collect an array", () => collect(() => [7, 8]));
show("collect a set", () => collect(() => new Set([9, 9, 10])));
show("collect a typed array", () => collect(() => new Uint8Array([1, 300])));

let reads = 0;
class Lazy {
  get run(): () => number {
    reads++;
    return () => reads;
  }
  method(): number {
    return -1;
  }
}
interface Runs {
  run(): number;
}
function runTwice(r: Runs): string {
  return r.run() + "," + r.run();
}
show("a getter that returns a function, as a method", () => runTwice(new Lazy()));
show("reads", () => reads);
show("a real method at the same place", () => runTwice({ run: () => 5 }));
show("a class with the method", () => runTwice(new (class { run(): number { return 6; } })()));

async function settle(label: string, make: MakesPromise): Promise<void> {
  try {
    const promise = make();
    console.log(label + ": " + promise.constructor.name + " " + (await promise));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}
function startsSynchronously(make: MakesPromise): string {
  try {
    make().catch(() => {});
    return "returned";
  } catch (error) {
    return "threw at once";
  }
}
show("an async function that throws", () => startsSynchronously(throwsLater));
show("a plain function that throws", () => startsSynchronously(throwsNow));

async function main(): Promise<void> {
  await settle("async arrow", asyncArrow);
  await settle("plain promise", plainPromise);
  await settle("subclass of Promise", thenableClass);
  await settle("throws later", throwsLater);
  await settle("throws now", throwsNow);
}
main().then(() => console.log("done"));
