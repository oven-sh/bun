function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

let log: string[] = [];

class Loud<T> extends Promise<T> {
  then<A = T, B = never>(onfulfilled?: Fulfilled<T, A>, onrejected?: Rejected<B>): Promise<A | B> {
    log.push("then(" + typeof onfulfilled + ", " + typeof onrejected + ")");
    return super.then(onfulfilled, onrejected);
  }
}

class Doubling extends Promise<number> {
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, onrejected?: Rejected<B>): Promise<A | B> {
    log.push("doubling then");
    return super.then(onfulfilled ? n => onfulfilled(n * 2) : onfulfilled, onrejected);
  }
}

class Deaf extends Promise<number> {
  then<A = number, B = never>(_?: Fulfilled<number, A>, __?: Rejected<B>): Promise<A | B> {
    log.push("deaf then");
    return new Promise<A | B>(() => {});
  }
}

async function awaited(p: Promise<number>): Promise<number> {
  const n: number = await p;
  return n + 1;
}

const uses: [string, (p: Promise<number>) => Promise<unknown>][] = [
  ["await", awaited],
  ["then", p => p.then(n => n + 1)],
  ["catch", p => p.catch(() => -1)],
  ["finally", p => p.finally(() => {})],
  ["returned from an async function", async p => p],
  ["Promise.resolve", p => Promise.resolve(p)],
  ["Promise.all", p => Promise.all([p])],
  ["Promise.race", p => Promise.race([p])],
  ["Promise.allSettled", p => Promise.allSettled([p])],
  ["a reaction's result", p => Promise.resolve().then(() => p)],
  ["for await", async p => {
    const out: number[] = [];
    for await (const n of [p]) out.push(n);
    return out;
  }],
];

const makers: [string, () => Promise<number>][] = [
  ["plain", () => Promise.resolve(1)],
  ["loud", () => Loud.resolve(1)],
  ["doubling", () => new Doubling(resolve => resolve(1))],
];

for (const [name, use] of uses) {
  for (const [label, make] of makers) {
    log = [];
    console.log(name + ", " + label + ": " + text(await use(make())) + " [" + log.join(", ") + "]");
  }
}

log = [];
let finished = false;
awaited(new Deaf(resolve => resolve(1))).then(() => {
  finished = true;
});
for (let i = 0; i < 6; i++) await null;
console.log("a then that never answers: finished " + finished + " [" + log.join(", ") + "]");

let warm = 0;
for (let i = 0; i < 2000; i++) warm += await awaited(Promise.resolve(1));
log = [];
console.log("2000 plain ones: " + warm + ", then a doubling one: " + (await awaited(new Doubling(resolve => resolve(1)))) + " [" + log.join(", ") + "]");

export {};
