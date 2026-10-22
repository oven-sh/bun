type Executor<T> = (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void;

class Counting<T> extends Promise<T> {
  static made = 0;
  serial: number;
  constructor(executor: Executor<T>) {
    super(executor);
    this.serial = ++Counting.made;
  }
}

function kind(value: unknown): string {
  return value instanceof Counting ? "Counting " + value.serial : value instanceof Promise ? "Promise" : typeof value;
}

async function count(label: string, run: () => unknown): Promise<void> {
  const before = Counting.made;
  const result = run();
  const atOnce = Counting.made - before;
  let settled: string;
  try {
    settled = JSON.stringify(await result);
  } catch (error) {
    settled = "rejected " + String(error);
  }
  console.log(label + ": " + kind(result).replace(/\d+/, "") + ", made at once " + atOnce + ", in the end " + (Counting.made - before) + ", settled " + settled);
}

const ready = (): Counting<number> => new Counting<number>(resolve => resolve(1));

await count("new", ready);
await count("resolve of a number", () => Counting.resolve(1));
await count("resolve of one of its own", () => Counting.resolve(ready()));
await count("resolve of a plain promise", () => Counting.resolve(Promise.resolve(1)));
await count("Promise.resolve of one", () => Promise.resolve(ready()));
await count("reject", () => Counting.reject("no"));
await count("then with nothing", () => ready().then());
await count("then", () => ready().then(n => n + 1));
await count("then twice", () => ready().then(n => n + 1).then(n => n + 1));
await count("then that returns one", () => ready().then(() => ready()));
await count("catch", () => ready().catch(() => 0));
await count("finally", () => ready().finally(() => {}));
await count("finally after a rejection", () => Counting.reject("no").finally(() => {}));
await count("all", () => Counting.all([1, ready()]));
await count("all of nothing", () => Counting.all([]));
await count("allSettled", () => Counting.allSettled([1, ready()]));
await count("race", () => Counting.race([1, ready()]));
await count("any", () => Counting.any([1, ready()]));
await count("withResolvers", () => {
  const parts = Counting.withResolvers<number>();
  parts.resolve(5);
  return parts.promise;
});
await count("Promise.all over two", () => Promise.all([ready(), ready()]));
await count("an async function awaits one", async () => (await ready()) + 1);
await count("an async function returns one", async () => ready());
await count("an async function is never one", () => (async () => 1)());
await count("a plain promise's reaction returns one", () => Promise.resolve().then(ready));

const first = ready();
const second = first.then(n => n);
console.log("serials go up: " + (second instanceof Counting && second.serial === first.serial + 1));
console.log("keys: " + Object.keys(first).join());
console.log("constructor: " + first.constructor.name + ", derived " + second.constructor.name);

function typed(p: Promise<number>): Promise<number> {
  return p.then(n => n * 2);
}
console.log("through a function over Promise<number>: " + kind(typed(ready())).replace(/\d+/, "") + " and " + kind(typed(Promise.resolve(1))));

export {};
