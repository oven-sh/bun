function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

class Box<T> implements PromiseLike<T> {
  label: string;
  inside: T;
  constructor(label: string, inside: T) {
    this.label = label;
    this.inside = inside;
  }
  then<A = T, B = never>(onfulfilled?: Fulfilled<T, A>, _?: Rejected<B>): PromiseLike<A | B> {
    console.log("  then of " + this.label);
    onfulfilled?.(this.inside);
    return new Promise<A | B>(() => {});
  }
}

class Refusing<T> implements PromiseLike<T> {
  reason: unknown;
  constructor(reason: unknown) {
    this.reason = reason;
  }
  then<A = T, B = never>(_?: Fulfilled<T, A>, onrejected?: Rejected<B>): PromiseLike<A | B> {
    console.log("  then of the refusing one");
    onrejected?.(this.reason);
    return new Promise<A | B>(() => {});
  }
}

function ticks(count: number): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 1; i <= count; i++) chain = chain.then(() => console.log("    tick " + i));
  return chain;
}

async function one(box: Box<number>): Promise<string> {
  const n: number = await box;
  return text(n + 1);
}
async function two(box: Box<Box<number>>): Promise<string> {
  const n: number = await box;
  return text(n + 1);
}
async function three(box: Box<Box<Box<number>>>): Promise<string> {
  const n: number = await box;
  return text(n + 1);
}
async function mixed(box: Box<Promise<number>>): Promise<string> {
  const n: number = await box;
  return text(n + 1);
}
async function refused(box: Box<PromiseLike<number>>): Promise<string> {
  try {
    const n: number = await box;
    return text(n + 1);
  } catch (error) {
    return "caught " + text(error);
  }
}

async function round(label: string, run: () => Promise<string>): Promise<void> {
  console.log("--- " + label);
  const [result] = await Promise.all([run().then(value => {
    console.log("  settled");
    return value;
  }), ticks(9)]);
  console.log(label + ": " + result);
}

await round("one box", () => one(new Box("a", 1)));
await round("two boxes", () => two(new Box("outer", new Box("inner", 2))));
await round("three boxes", () => three(new Box("outer", new Box("middle", new Box("inner", 3)))));
await round("a promise between two boxes", () => mixed(new Box("outer", Promise.resolve(new Box("inner", 4)))));
await round("the inner one refuses", () => refused(new Box("outer", new Refusing<number>("no"))));
await round("the inner one refuses with a box", () => refused(new Box("outer", new Refusing<number>(new Box("reason", 5)))));

const selfish: { then?: (resolve: (value: unknown) => void) => void } = {};
selfish.then = resolve => {
  console.log("  then of the one that resolves with itself");
  delete selfish.then;
  resolve(selfish);
};
console.log("--- resolves with itself after dropping its then");
const settled: unknown = await Promise.resolve().then(() => selfish);
console.log("same object: " + (settled === selfish) + ", keys [" + Object.keys(selfish).join() + "]");

export {};
