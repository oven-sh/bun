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

class Answer<T> implements PromiseLike<T> {
  held: T;
  constructor(held: T) {
    this.held = held;
  }
  then<A = T, B = never>(onfulfilled?: Fulfilled<T, A>, _?: Rejected<B>): PromiseLike<A | B> {
    console.log("  then of the thenable that holds " + text(this.held));
    onfulfilled?.(this.held);
    return new Promise<A | B>(() => {});
  }
}

function shape(result: IteratorResult<number, string>): string {
  return Object.keys(result).join() + " | " + text(result.value) + " | " + result.done;
}

async function* source(): AsyncGenerator<number, string, string> {
  const a: string = yield 1;
  console.log("  sent " + text(a));
  const b: string = yield Promise.resolve(2);
  console.log("  sent " + text(b));
  const c: string = yield new Answer(3);
  console.log("  sent " + text(c));
  try {
    const d: string = yield Promise.reject(new RangeError("yielded"));
    console.log("  never printed " + d);
  } catch (error) {
    console.log("  the generator itself caught: " + failure(error));
  }
  const e: string = yield 5;
  console.log("  sent " + text(e));
  return Promise.resolve("the end");
}

const byHand = source();
console.log("next is a promise: " + (byHand.next("dropped") instanceof Promise));
for (const sent of ["b", "c", "d", "e", "f", "g"]) console.log("next(" + sent + "): " + shape(await byHand.next(sent)));

const seen: string[] = [];
const hidden: AsyncIterable<number> = source();
for await (const n of hidden) seen.push(text(n));
console.log("for await: " + seen.join(", "));

async function* returnsAThenable(): AsyncGenerator<number, string, void> {
  yield 1;
  return new Answer("from a thenable");
}
const t = returnsAThenable();
console.log(shape(await t.next()));
console.log(shape(await t.next()));
console.log(shape(await t.next()));

async function* returnsARejection(): AsyncGenerator<number, string, void> {
  try {
    return Promise.reject(new SyntaxError("returned"));
  } catch (error) {
    console.log("  caught inside: " + failure(error));
    return "recovered";
  } finally {
    console.log("  finally");
  }
}
try {
  console.log(shape(await returnsARejection().next()));
} catch (error) {
  console.log("outside: " + failure(error));
}

async function* nested(): AsyncGenerator<number, string, void> {
  const end: string = yield* returnsAThenable();
  console.log("  yield* gave " + text(end));
  yield* [Promise.resolve(10), 11];
  return end.toUpperCase();
}
const n = nested();
for (let i = 0; i < 5; i++) console.log("nested: " + shape(await n.next()));

async function* promiseOfPromise(): AsyncGenerator<number, void, void> {
  yield Promise.resolve(Promise.resolve(7));
  yield new Answer(Promise.resolve(8));
}
for await (const value of promiseOfPromise()) console.log("unwrapped: " + text(value + 1));

export {};
