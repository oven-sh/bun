function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

function volume(a: number, b: number, c: number = 10, ...more: number[]): string {
  return arguments.length + " given: " + [a, b, c].map(text).join(", ") + ", more " + text(more);
}

const none = volume.bind(null);
const one = volume.bind(null, 2);
const two = volume.bind(null, 2, 3);
const three = volume.bind(null, 2, 3, 4);
const five = volume.bind(null, 2, 3, 4, 5, 6);
const withUndefined = volume.bind(null, 2, 3, undefined);

attempt("shapes", () => [volume, none, one, two, three, five].map(text));
attempt("none(1, 2)", () => none(1, 2));
attempt("one(3)", () => one(3));
attempt("one(3, undefined)", () => one(3, undefined));
attempt("two()", () => two());
attempt("two(4, 5)", () => two(4, 5));
attempt("three()", () => three());
attempt("five(7)", () => five(7));
attempt("an undefined was bound where the default is", () => withUndefined());
attempt("bound twice", () => one.bind(null, 3).bind(null, 4)(5));

function triple(a: number, b: number, c: number = 10): string {
  return arguments.length + " given: " + [a, b, c].map(text).join(", ");
}
attempt("map over a bound function: the index is the next parameter", () => [7, 8].map(triple.bind(null, 1)).join(" | "));

function tagged(prefix: string, word: string, suffix?: string): string {
  return prefix + word + " suffix " + text(suffix) + (suffix === undefined ? "" : " of length " + text(suffix.length));
}
const short: (prefix: string, word: string) => string = tagged;
attempt("honest", () => tagged(">", "w", "!"));
attempt("bound behind a shorter type, mapped", () => ["a", "b"].map(short.bind(null, ">")));

class Counter {
  count: number = 0;
  add(n: number, times: number = 1): number {
    this.count += n * times;
    return this.count;
  }
}
const counter = new Counter();
const other = new Counter();
const addFive = counter.add.bind(counter, 5);
attempt("a bound method", () => [addFive(), addFive(2), counter.count]);
attempt("call cannot move the receiver", () => [addFive.call(other), other.count, counter.count]);
attempt("bind cannot move the receiver", () => [addFive.bind(other)(), other.count, counter.count]);
attempt("bound to a look-alike", () => {
  const like = { count: 100, add: counter.add };
  return [counter.add.bind(like, 1)(), like.count];
});
attempt("forEach with a bound method: the index is the multiplier", () => {
  const fresh = new Counter();
  [1, 1, 1].forEach(fresh.add.bind(fresh));
  return fresh.count;
});

class Pair {
  a: number;
  b: number;
  constructor(a: number, b: number = -1) {
    this.a = a;
    this.b = b;
  }
}
const BoundPair = Pair.bind(null, 1);
attempt("a bound class is constructed", () => [new BoundPair(), new BoundPair(2), new BoundPair() instanceof Pair, new BoundPair() instanceof BoundPair]);
attempt("a bound class has no prototype member", () => ["prototype" in BoundPair, text(BoundPair)]);
attempt("a bound class is called", () => Reflect.apply(BoundPair, null, []));

const arrow = (a: number, b: number): string => a + ":" + b;
attempt("a bound arrow", () => [arrow.bind(null, 1)(2), text(arrow.bind(null, 1))]);

async function later(a: number, b: number): Promise<number> {
  await null;
  return a * b;
}
function* counting(from: number, to: number): Generator<number, void, void> {
  for (let i = from; i <= to; i++) yield i;
}
attempt("a bound generator function", () => [...counting.bind(null, 2)(4)]);
console.log("a bound async function: " + (await later.bind(null, 6)(7)));

let warm = 0;
for (let i = 0; i < 2000; i++) warm += addFive(0) + one(i).length;
console.log("2000 calls of bound functions: " + warm);

export {};
