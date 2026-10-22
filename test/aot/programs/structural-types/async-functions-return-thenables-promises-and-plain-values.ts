function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

class Answer implements PromiseLike<number> {
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, _?: Rejected<B>): PromiseLike<A | B> {
    console.log("  then of the thenable");
    onfulfilled?.(3);
    return new Promise<A | B>(() => {});
  }
}

class Sub extends Promise<number> {}

function ticks(count: number): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 1; i <= count; i++) chain = chain.then(() => console.log("    tick " + i));
  return chain;
}

const returns: [string, () => Promise<number>][] = [
  ["a number", async () => 1],
  ["an awaited number", async () => await 1],
  ["a promise", async () => Promise.resolve(2)],
  ["an awaited promise", async () => await Promise.resolve(2)],
  ["a thenable", async () => new Answer()],
  ["an awaited thenable", async () => await new Answer()],
  ["a subclass", async () => Sub.resolve(4)],
  ["another async function's promise", async () => (async () => 5)()],
  ["a promise from a try block", async () => {
    try {
      return Promise.resolve(6);
    } finally {
      console.log("  finally");
    }
  }],
  ["not async, a promise", () => Promise.resolve(7)],
  ["not async, a chain", () => Promise.resolve(7).then(n => n + 1)],
];

for (const [label, run] of returns) {
  console.log("--- returns " + label);
  const result = run();
  console.log("  a promise comes back: " + (result instanceof Promise) + " " + result.constructor.name);
  const [value] = await Promise.all([
    result.then(n => {
      console.log("  settled with " + text(n));
      return n;
    }),
    ticks(5),
  ]);
  console.log("  value + 1: " + text(value + 1));
}

const shared = Promise.resolve(9);
async function handsBack(): Promise<number> {
  return shared;
}
console.log("the promise that is returned is not the one that comes back: " + (handsBack() !== shared));

async function rejects(how: number): Promise<number> {
  if (how === 0) throw new RangeError("thrown");
  if (how === 1) return Promise.reject(new TypeError("returned"));
  try {
    return Promise.reject(new SyntaxError("returned in a try, not caught there"));
  } catch {
    return -1;
  }
}
async function rejectsAwaited(): Promise<number> {
  try {
    return await Promise.reject(new SyntaxError("awaited in a try, caught there"));
  } catch {
    return -1;
  }
}
for (const how of [0, 1, 2]) console.log("rejects " + how + ": " + (await rejects(how).then(text, error => "rejected " + (error instanceof Error ? error.constructor.name : typeof error))));
console.log("rejects awaited: " + text(await rejectsAwaited()));

export {};
