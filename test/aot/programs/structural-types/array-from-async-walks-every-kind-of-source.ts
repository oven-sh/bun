function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "rejected " + (error instanceof Error ? error.constructor.name : text(error));
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

let log: string[] = [];

class Answer implements PromiseLike<number> {
  held: number;
  constructor(held: number) {
    this.held = held;
  }
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, _?: Rejected<B>): PromiseLike<A | B> {
    log.push("then " + this.held);
    onfulfilled?.(this.held);
    return new Promise<A | B>(() => {});
  }
}

async function* stream(): AsyncGenerator<number, void, void> {
  try {
    yield 1;
    yield 2;
  } finally {
    log.push("stream closed");
  }
}

function* sync(): Generator<number | PromiseLike<number>, void, void> {
  try {
    yield 1;
    yield Promise.resolve(2);
    yield new Answer(3);
  } finally {
    log.push("generator closed");
  }
}

const arrayLike: ArrayLike<number | PromiseLike<number>> = { length: 3, 0: 1, 1: Promise.resolve(2) };

const sources: [string, () => AsyncIterable<number> | Iterable<number | PromiseLike<number>> | ArrayLike<number | PromiseLike<number>>][] = [
  ["an async generator", stream],
  ["a sync generator", sync],
  ["numbers", () => [1, 2]],
  ["promises", () => [Promise.resolve(1), Promise.resolve(2)]],
  ["thenables", () => [new Answer(1), new Answer(2)]],
  ["a set", () => new Set([1, 2])],
  ["an array-like with a gap", () => arrayLike],
  ["nothing", () => []],
  ["a rejection", () => {
    const doomed = Promise.reject<number>(new RangeError("two"));
    doomed.catch(() => {});
    return [1, doomed];
  }],
];

for (const [label, make] of sources) {
  log = [];
  console.log(label + ": " + (await Array.fromAsync(make()).then(text, failure)) + " [" + log.join(", ") + "]");
  log = [];
  console.log(label + ", mapped: " + (await Array.fromAsync(make(), (n, i) => (typeof n === "number" ? n * 10 + i : "not awaited")).then(text, failure)) + " [" + log.join(", ") + "]");
  log = [];
  console.log(label + ", mapped to promises: " + (await Array.fromAsync(make(), async n => (typeof n === "number" ? n + 0.5 : "not awaited")).then(text, failure)) + " [" + log.join(", ") + "]");
  log = [];
  console.log(label + ", the function throws: " + (await Array.fromAsync(make(), (): number => {
    throw new EvalError("mapper");
  }).then(text, failure)) + " [" + log.join(", ") + "]");
}

const result = Array.fromAsync([1]);
console.log("a promise comes back: " + (result instanceof Promise) + ", of an array: " + Array.isArray(await result));

export {};
