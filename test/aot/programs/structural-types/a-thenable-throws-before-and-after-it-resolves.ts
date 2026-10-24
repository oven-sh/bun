function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "caught " + (error instanceof Error ? error.constructor.name : text(error));
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

class Faulty implements PromiseLike<number> {
  how: string;
  constructor(how: string) {
    this.how = how;
  }
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, onrejected?: Rejected<B>): PromiseLike<A | B> {
    switch (this.how) {
      case "throws at once":
        throw new RangeError("at once");
      case "throws a number":
        throw 7;
      case "throws undefined":
        throw undefined;
      case "resolves and throws":
        onfulfilled?.(1);
        throw new RangeError("after resolving");
      case "rejects and throws":
        onrejected?.("rejected first");
        throw new RangeError("after rejecting");
      case "throws and would resolve later":
        queueMicrotask(() => onfulfilled?.(2));
        throw new SyntaxError("before the later call");
    }
    onfulfilled?.(0);
    return new Promise<A | B>(() => {});
  }
}

class ThrowingGetter implements PromiseLike<number> {
  reads = 0;
  get then(): PromiseLike<number>["then"] {
    this.reads++;
    throw new EvalError("the getter");
  }
}

async function wait(thenable: PromiseLike<number>): Promise<string> {
  let before = 10;
  try {
    before += await thenable;
    return "went on with " + text(before);
  } catch (error) {
    return failure(error) + " with " + text(before);
  } finally {
    console.log("  finally");
  }
}

const kinds = ["well behaved", "throws at once", "throws a number", "throws undefined", "resolves and throws", "rejects and throws", "throws and would resolve later"];

for (const how of kinds) {
  console.log(how + ", await: " + (await wait(new Faulty(how))));
  console.log(how + ", Promise.resolve: " + (await Promise.resolve(new Faulty(how)).then(text, failure)));
  console.log(how + ", returned from a reaction: " + (await Promise.resolve().then(() => new Faulty(how)).then(text, failure)));
  console.log(how + ", returned from an async function: " + (await (async (): Promise<number> => new Faulty(how))().then(text, failure)));
  console.log(how + ", Promise.all: " + (await Promise.all([new Faulty(how)]).then(text, failure)));
  console.log(how + ", Promise.allSettled: " + (await Promise.allSettled([new Faulty(how)]).then(results => results.map(r => r.status + " " + (r.status === "fulfilled" ? text(r.value) : failure(r.reason))).join())));
}

const getter = new ThrowingGetter();
console.log("a getter that throws, await: " + (await wait(getter)) + ", reads " + getter.reads);
console.log("a getter that throws, Promise.resolve: " + (await Promise.resolve(getter).then(text, failure)) + ", reads " + getter.reads);
console.log("a getter that throws, Promise.race: " + (await Promise.race([getter]).then(text, failure)) + ", reads " + getter.reads);

export {};
