function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

let asked: string[] = [];

class Pretend<T> implements Promise<T> {
  readonly [Symbol.toStringTag] = "Pretend";
  held: T;
  constructor(held: T) {
    this.held = held;
  }
  then<A = T, B = never>(onfulfilled?: Fulfilled<T, A>, onrejected?: Rejected<B>): Promise<A | B> {
    asked.push("then(" + typeof onfulfilled + ", " + typeof onrejected + ")");
    return new Promise<A | B>(resolve => {
      if (onfulfilled) resolve(onfulfilled(this.held));
    });
  }
  catch<B = never>(onrejected?: Rejected<B>): Promise<T | B> {
    asked.push("catch(" + typeof onrejected + ")");
    return Promise.resolve(this.held);
  }
  finally(onfinally?: (() => void) | null): Promise<T> {
    asked.push("finally(" + typeof onfinally + ")");
    onfinally?.();
    return Promise.resolve(this.held);
  }
}

async function plusOne(p: Promise<number>): Promise<number> {
  return (await p) + 1;
}

function chained(p: Promise<number>): Promise<string> {
  return p.then(n => "got " + n);
}

function guarded(p: Promise<number>): Promise<number> {
  return p.catch(() => -1).finally(() => {});
}

function cleaned(p: Promise<number>): Promise<number> {
  return p.finally(() => {
    asked.push("cleanup");
  });
}

function make(real: boolean): Promise<number> {
  return real ? Promise.resolve(1) : new Pretend(1);
}

class Job {
  pending: Promise<number>;
  queue: Promise<number>[] = [];
  constructor(pending: Promise<number>) {
    this.pending = pending;
    this.queue.push(pending, pending);
  }
  async run(): Promise<number> {
    let sum = await this.pending;
    for (const p of this.queue) sum += await p;
    return sum;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += await plusOne(Promise.resolve(i & 1));
console.log("2000 real promises: " + warm);

for (const real of [true, false, true]) {
  const label = real ? "real" : "pretend";
  const uses: [string, (p: Promise<number>) => unknown][] = [
    ["awaited", plusOne],
    ["then", chained],
    ["catch and finally", guarded],
    ["finally", cleaned],
    ["in a field and a list", p => new Job(p).run()],
    ["captured", p => (async () => (await p) * 10)()],
    ["returned from an async function", p => (async (): Promise<number> => p)()],
    ["Promise.resolve gives it back", p => Promise.resolve(p) === p],
    ["instanceof Promise", p => p instanceof Promise],
    ["tag", p => Object.prototype.toString.call(p)],
    ["Promise.all", p => Promise.all([p, p])],
    ["Promise.race", p => Promise.race([p])],
    ["Promise.allSettled", p => Promise.allSettled([p])],
    ["Promise.any", p => Promise.any([p])],
    ["for await", async p => {
      let sum = 0;
      for await (const n of [p, p]) sum += n;
      return sum;
    }],
  ];
  for (const [name, use] of uses) {
    asked = [];
    console.log(label + ", " + name + ": " + text(await use(make(real))) + " [" + asked.join(", ") + "]");
  }
}

export {};
