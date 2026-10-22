function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function inspect(numbers: number[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const value = numbers[i];
    const exact = Object.is(value, undefined) ? "undefined" : Object.is(value, 0) ? "zero" : Object.is(value, -0) ? "minus zero" : Object.is(value, NaN) ? "not a number" : String(value);
    lines.push(i + " " + (i in numbers ? "present" : "absent") + " " + typeof value + " " + exact);
  }
  return lines;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function sumByForOf(numbers: number[]): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

function sumAsIntegers(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total = (total + numbers[i]) | 0;
  return total;
}

function doubled(numbers: number[]): number[] {
  return numbers.map(number => number * 2);
}

function doubledByHand(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i] * 2);
  return result;
}

function report(name: string, make: () => number[]): void {
  attempt(name + ": elements", () => inspect(make()));
  attempt(name + ": length", () => make().length);
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": sum by for-of", () => sumByForOf(make()));
  attempt(name + ": sum as integers", () => sumAsIntegers(make()));
  attempt(name + ": map", () => doubled(make()));
  attempt(name + ": doubled by hand", () => doubledByHand(make()));
  attempt(name + ": the first, fixed", () => make()[0].toFixed(1));
  attempt(name + ": after a push", () => {
    const numbers = make();
    const length = numbers.push(7);
    return [length, inspect(numbers), sum(numbers)];
  });
  attempt(name + ": after a store at 1", () => {
    const numbers = make();
    numbers[1] = 1.5;
    return [inspect(numbers), sum(numbers)];
  });
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": JSON", () => JSON.stringify(make()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  for (const dense of [[i, 2, 3], [i + 0.5, 2.5, 3.5]]) {
    warm += inspect(dense).length + sum(dense) + sumByForOf(dense) + sumAsIntegers(dense) + doubled(dense)[0] + doubledByHand(dense)[1];
  }
}
console.log("after 4000 dense arrays", warm);

const log: string[] = [];

class Stubborn extends Array<number> {
  push(...items: number[]): number {
    log.push("push " + items.join());
    return 42;
  }
  pop(): number | undefined {
    log.push("pop");
    return -1;
  }
  indexOf(item: number): number {
    log.push("indexOf " + item);
    return 99;
  }
  at(index: number): number | undefined {
    log.push("at " + index);
    return 1000 + index;
  }
  join(): string {
    return "joined my way";
  }
}

class Backwards extends Array<number> {
  *[Symbol.iterator](): ArrayIterator<number> {
    for (let i = this.length - 1; i >= 0; i--) yield this[i];
  }
}

class PlainResults extends Array<number> {
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
}

function pushOne(numbers: number[]): number {
  return numbers.push(123);
}

function popOne(numbers: number[]): number | undefined {
  return numbers.pop();
}

function find(numbers: number[], item: number): number {
  return numbers.indexOf(item);
}

function lastOf(numbers: number[]): number | undefined {
  return numbers.at(-1);
}

function text(numbers: number[]): string {
  return numbers.join();
}

function spreadOut(numbers: number[]): number[] {
  return [...numbers];
}

function firstByPattern(numbers: number[]): number {
  const [first] = numbers;
  return first;
}

function classOfMap(numbers: number[]): string {
  return numbers.map(number => number).constructor.name;
}

for (let i = 0; i < 2000; i++) {
  const plain = [i, 2, 3];
  warm += pushOne(plain) + (popOne(plain) ?? 0) + find(plain, 2) + (lastOf(plain) ?? 0) + text(plain).length + spreadOut(plain).length + firstByPattern(plain) + classOfMap(plain).length;
}
console.log("after 2000 more plain arrays", warm);

function stubborn(): number[] {
  return Stubborn.from([1, 2, 3]);
}
attempt("push is overridden", () => {
  const numbers = stubborn();
  return [pushOne(numbers), numbers.length, inspect(numbers)];
});
attempt("pop is overridden", () => {
  const numbers = stubborn();
  return [popOne(numbers), numbers.length];
});
attempt("indexOf is overridden", () => find(stubborn(), 2));
attempt("at is overridden", () => lastOf(stubborn()));
attempt("join is overridden", () => [text(stubborn()), String(stubborn()), `${stubborn()}`]);
attempt("isArray, instanceof, constructor", () => [Array.isArray(stubborn()), stubborn() instanceof Stubborn, stubborn().constructor.name]);
attempt("the class of map, filter, slice, concat", () => [classOfMap(stubborn()), stubborn().filter(() => true).constructor.name, stubborn().slice().constructor.name, stubborn().concat([4]).constructor.name]);
attempt("a mapped one still overrides push", () => pushOne(stubborn().map(number => number * 2)));
console.log("log", log.join("; "));
report("a stubborn array", stubborn);

function backwards(): number[] {
  return Backwards.from({ 0: 1, 1: 2, 2: 3, length: 3 });
}
attempt("for-of runs backwards", () => {
  const seen: number[] = [];
  for (const number of backwards()) seen.push(number);
  return seen;
});
attempt("spread runs backwards", () => spreadOut(backwards()));
attempt("a pattern takes the last", () => firstByPattern(backwards()));
attempt("by index it runs forwards", () => [sum(backwards()), doubledByHand(backwards())]);
attempt("Math.max, Array.from, new Set", () => [Math.max(...backwards()), Array.from(backwards()), [...new Set(backwards())]]);
attempt("a plain array again", () => [spreadOut([1, 2, 3]), firstByPattern([1, 2, 3])]);

attempt("species", () => {
  const numbers: number[] = PlainResults.from([1, 2]);
  return [numbers.constructor.name, classOfMap(numbers), numbers.slice().constructor.name];
});
attempt("a constructor with its own parameter", () => {
  class Tagged extends Array<number> {
    tag: string;
    constructor(tag: string | number) {
      super();
      this.tag = typeof tag + ":" + tag;
    }
  }
  const tagged = new Tagged("mine");
  tagged.push(1, 2);
  const numbers: number[] = tagged;
  const mapped = numbers.map(number => number + 1);
  return [tagged.tag, mapped, mapped instanceof Tagged ? mapped.tag : "plain"];
});
