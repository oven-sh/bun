function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  if (error instanceof AggregateError) return "AggregateError of " + error.errors.map(text).join("; ");
  return "rejected " + (error instanceof Error ? error.constructor.name : text(error));
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

let log: string[] = [];

class Answer<T> implements PromiseLike<T> {
  label: string;
  held: T;
  jobs: number;
  refuse: boolean;
  constructor(label: string, held: T, jobs: number, refuse = false) {
    this.label = label;
    this.held = held;
    this.jobs = jobs;
    this.refuse = refuse;
  }
  then<A = T, B = never>(onfulfilled?: Fulfilled<T, A>, onrejected?: Rejected<B>): PromiseLike<A | B> {
    log.push("then " + this.label);
    let left = this.jobs;
    const step = (): void => {
      if (left-- > 0) return queueMicrotask(step);
      log.push("answer " + this.label);
      if (this.refuse) onrejected?.("no " + this.label);
      else onfulfilled?.(this.held);
    };
    step();
    return new Promise<A | B>(() => {});
  }
}

type Mixed = [number, PromiseLike<string>, Promise<boolean>, PromiseLike<number[]>, string];

function mixed(): Mixed {
  return [1, new Answer("text", "two", 0), Promise.resolve(true), new Answer("list", [4], 3), "five"];
}

log = [];
const [a, b, c, d, e] = await Promise.all(mixed());
console.log("all: " + [text(a + 1), text(b.length), text(!c), text(d.length), text(e.length)].join(" | "));
console.log("all log: " + log.join(", "));

log = [];
const settled = await Promise.allSettled(mixed());
console.log("allSettled: " + settled.map(r => r.status + " " + (r.status === "fulfilled" ? text(r.value) : text(r.reason))).join(" | "));
console.log("allSettled keys: " + settled.map(r => Object.keys(r).join("+")).join());
console.log("allSettled log: " + log.join(", "));

type Racers = [PromiseLike<number>, PromiseLike<string>, Promise<boolean>];

const races: [string, () => Racers][] = [
  ["the thenable answers at once", () => [new Answer("fast", 1, 0), new Answer("slow", "s", 5), Promise.resolve(true)]],
  ["both thenables are slow", () => [new Answer("slow 4", 1, 4), new Answer("slow 5", "s", 5), Promise.resolve(true)]],
  ["the first refuses at once", () => [new Answer("refuses", 1, 0, true), new Answer("slow", "s", 5), Promise.resolve(true)]],
  ["all refuse", () => [new Answer("r1", 1, 2, true), new Answer("r2", "s", 0, true), Promise.reject(new RangeError("r3"))]],
];

for (const [label, make] of races) {
  log = [];
  console.log("race, " + label + ": " + (await Promise.race(make()).then(text, failure)));
  for (let i = 0; i < 8; i++) await null;
  console.log("race log: " + log.join(", "));
  log = [];
  console.log("any, " + label + ": " + (await Promise.any(make()).then(text, failure)));
  for (let i = 0; i < 8; i++) await null;
  console.log("any log: " + log.join(", "));
  log = [];
  console.log("all, " + label + ": " + (await Promise.all(make()).then(text, failure)));
  for (let i = 0; i < 8; i++) await null;
  console.log("all log: " + log.join(", "));
}

console.log("all of nothing: " + text(await Promise.all([])));
console.log("allSettled of nothing: " + text(await Promise.allSettled([])));
console.log("any of nothing: " + (await Promise.any([]).then(text, failure)));

const sparse: (number | undefined)[] = [1, , 3];
console.log("all over a hole: " + text(await Promise.all(sparse)) + ", 1 in it: " + (1 in (await Promise.all(sparse))));

export {};
