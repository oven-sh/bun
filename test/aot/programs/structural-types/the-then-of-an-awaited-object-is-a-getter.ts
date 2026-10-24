function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

let log: string[] = [];

class Lazy implements PromiseLike<number> {
  reads = 0;
  get then(): PromiseLike<number>["then"] {
    const read = ++this.reads;
    log.push("get then " + read);
    return <A = number, B = never>(onfulfilled?: Fulfilled<number, A>, _?: Rejected<B>): PromiseLike<A | B> => {
      log.push("call then " + read);
      onfulfilled?.(read * 100);
      return new Promise<A | B>(() => {});
    };
  }
}

class Inherited extends Lazy {}

const onThePrototype: PromiseLike<number> = Object.create(new Lazy());

async function once(thenable: PromiseLike<number>): Promise<number> {
  return (await thenable) + 1;
}

async function twice(thenable: PromiseLike<number>): Promise<number> {
  const a: number = await thenable;
  const b: number = await thenable;
  return a + b;
}

async function handedBack(thenable: PromiseLike<number>): Promise<number> {
  return thenable;
}

const uses: [string, (thenable: PromiseLike<number>) => Promise<unknown>][] = [
  ["await once", once],
  ["await twice", twice],
  ["returned from an async function", handedBack],
  ["Promise.resolve", thenable => Promise.resolve(thenable)],
  ["a resolve function", thenable => new Promise<number>(resolve => resolve(thenable))],
  ["a reaction's result", thenable => Promise.resolve().then(() => thenable)],
  ["Promise.all of two", thenable => Promise.all([thenable, thenable])],
  ["Promise.race", thenable => Promise.race([thenable])],
  ["Promise.any", thenable => Promise.any([thenable])],
  ["Promise.allSettled", thenable => Promise.allSettled([thenable])],
  ["for await", async thenable => {
    const out: number[] = [];
    for await (const n of [thenable, thenable]) out.push(n);
    return out;
  }],
  ["yielded by an async generator", async thenable => {
    async function* source(): AsyncGenerator<number, void, void> {
      yield thenable;
    }
    const out: number[] = [];
    for await (const n of source()) out.push(n);
    return out;
  }],
];

for (const [label, use] of uses) {
  for (const [kind, make] of [
    ["own class", () => new Lazy()],
    ["subclass", () => new Inherited()],
  ] satisfies [string, () => PromiseLike<number>][]) {
    log = [];
    console.log(label + ", " + kind + ": " + text(await use(make())));
    console.log(label + ", " + kind + " log: " + log.join(", "));
  }
}

log = [];
console.log("two levels up the prototype chain: " + text(await once(onThePrototype)));
console.log("log: " + log.join(", "));

export {};
