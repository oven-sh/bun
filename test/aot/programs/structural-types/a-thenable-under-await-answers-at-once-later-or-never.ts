function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

class AtOnce implements PromiseLike<number> {
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, _?: Rejected<B>): PromiseLike<A | B> {
    console.log("at once: then runs");
    onfulfilled?.(1);
    console.log("at once: then ends");
    return new Promise<A | B>(() => {});
  }
}

class Later implements PromiseLike<number> {
  jobs: number;
  constructor(jobs: number) {
    this.jobs = jobs;
  }
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, _?: Rejected<B>): PromiseLike<A | B> {
    console.log("later " + this.jobs + ": then runs");
    let left = this.jobs;
    const step = (): void => {
      if (left-- > 0) queueMicrotask(step);
      else onfulfilled?.(this.jobs);
    };
    step();
    return new Promise<A | B>(() => {});
  }
}

class Never implements PromiseLike<number> {
  asked = 0;
  then<A = number, B = never>(_?: Fulfilled<number, A>, __?: Rejected<B>): PromiseLike<A | B> {
    this.asked++;
    console.log("never: then runs");
    return new Promise<A | B>(() => {});
  }
}

function ticks(count: number): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 1; i <= count; i++) chain = chain.then(() => console.log("    tick " + i));
  return chain;
}

async function wait(label: string, awaited: PromiseLike<number> | number): Promise<void> {
  console.log(label + ": before the await");
  const n: number = await awaited;
  console.log(label + ": after the await with " + text(n));
}

async function round(label: string, awaited: PromiseLike<number> | number): Promise<void> {
  console.log("--- " + label);
  const waiting = wait(label, awaited);
  console.log(label + ": the caller goes on");
  await Promise.all([waiting, ticks(6)]);
}

await round("a number", 0);
await round("a settled promise", Promise.resolve(0));
await round("at once", new AtOnce());
await round("later 0", new Later(0));
await round("later 2", new Later(2));
await round("a promise made from a thenable", Promise.resolve(new AtOnce()));

console.log("--- never");
const never = new Never();
let finished = false;
wait("never", never).then(() => {
  finished = true;
});
await ticks(4);
console.log("never: asked " + never.asked + " time(s), finished " + finished);

export {};
