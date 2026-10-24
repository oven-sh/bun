function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
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

async function collect(items: Iterable<number | PromiseLike<number>>): Promise<string> {
  let sum = 0;
  const kinds: string[] = [];
  try {
    for await (const n of items) {
      log.push("body " + text(n));
      kinds.push(typeof n);
      sum += n;
    }
  } catch (error) {
    return failure(error) + " after " + kinds.join() + " sum " + text(sum);
  }
  return kinds.join() + " sum " + text(sum);
}

function* promises(): Generator<Promise<number>, void, void> {
  try {
    for (let i = 1; i <= 3; i++) {
      log.push("make " + i);
      yield Promise.resolve(i);
    }
  } finally {
    log.push("generator closed");
  }
}

const cases: [string, () => Iterable<number | PromiseLike<number>>][] = [
  ["numbers", () => [1, 2, 3]],
  ["promises", () => [Promise.resolve(1), Promise.resolve(2)]],
  ["thenables", () => [new Answer(1), new Answer(2)]],
  ["a mix", () => [1, Promise.resolve(2), new Answer(3), 4]],
  ["a set of promises", () => new Set([Promise.resolve(1), Promise.resolve(2)])],
  ["a generator of promises", promises],
  ["nothing", () => []],
  ["a rejection in the middle", () => [1, Promise.reject(new RangeError("two")), 3]],
  ["a promise of a thenable", () => [Promise.resolve(new Answer(5))]],
  ["a typed array", () => new Uint8Array([7, 8])],
];

for (const [label, make] of cases) {
  log = [];
  console.log(label + ": " + (await collect(make())));
  console.log(label + " log: " + log.join(", "));
}

async function firstOnly(items: Iterable<number | PromiseLike<number>>): Promise<number> {
  for await (const n of items) return n;
  return -1;
}
log = [];
console.log("left after the first of a generator: " + (await firstOnly(promises())) + " [" + log.join(", ") + "]");

const growing: Promise<number>[] = [Promise.resolve(1)];
let rounds = 0;
for await (const n of growing) {
  rounds++;
  if (n < 4) growing.push(Promise.resolve(n + 1));
}
console.log("a list that grows while it is walked: " + rounds + " rounds");

async function order(): Promise<void> {
  const trail: string[] = [];
  const walking = (async () => {
    for await (const n of [1, 2]) trail.push("item " + n);
    trail.push("loop over");
  })();
  let chain = Promise.resolve();
  for (let i = 1; i <= 8; i++) chain = chain.then(() => void trail.push("tick " + i));
  await Promise.all([walking, chain]);
  console.log(trail.join(", "));
}
await order();

export {};
