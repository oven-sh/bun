type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

const trail: string[] = [];

class Answer implements PromiseLike<number> {
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, _?: Rejected<B>): PromiseLike<A | B> {
    trail.push("thenable: then");
    onfulfilled?.(0);
    return new Promise<A | B>(() => {});
  }
}

class Sub extends Promise<number> {}

async function awaits(label: string, make: () => unknown, times: number): Promise<void> {
  trail.push(label + ": starts");
  for (let i = 1; i <= times; i++) {
    await make();
    trail.push(label + ": after await " + i);
  }
}

async function inner(): Promise<number> {
  trail.push("inner: runs");
  return 1;
}

async function innerReturnsAPromise(): Promise<number> {
  return Promise.resolve(1);
}

const everything: Promise<unknown>[] = [];

trail.push("script: start");

everything.push(awaits("number", () => 0, 3));
everything.push(awaits("promise", () => Promise.resolve(0), 3));
everything.push(awaits("thenable", () => new Answer(), 2));
everything.push(awaits("subclass", () => Sub.resolve(0), 2));
everything.push(awaits("async call", inner, 2));
everything.push(awaits("async call that returns a promise", innerReturnsAPromise, 2));

let chain: Promise<void> = Promise.resolve();
for (let i = 1; i <= 8; i++) chain = chain.then(() => void trail.push("chain: " + i));
everything.push(chain);

queueMicrotask(() => {
  trail.push("microtask: 1");
  queueMicrotask(() => {
    trail.push("microtask: 2");
    queueMicrotask(() => void trail.push("microtask: 3"));
  });
});

everything.push(new Promise<void>(resolve => {
  trail.push("executor: runs at once");
  resolve();
  trail.push("executor: goes on after resolve");
}).then(() => void trail.push("executor: reaction")));

const settled = Promise.resolve("s");
everything.push(settled.then(() => void trail.push("settled: first reaction")));
everything.push(settled.then(() => void trail.push("settled: second reaction")));
everything.push(settled.finally(() => void trail.push("settled: finally")).then(() => void trail.push("settled: after finally")));

everything.push(Promise.reject(new Error("r")).catch(() => void trail.push("rejected: catch")).then(() => void trail.push("rejected: after catch")));
everything.push(Promise.reject(new Error("r")).then(() => void trail.push("never")).then(() => void trail.push("never")).catch(() => void trail.push("rejected: catch after two skipped reactions")));

everything.push(Promise.resolve(Promise.resolve(1)).then(() => void trail.push("resolve of a promise: reaction")));
everything.push(new Promise<number>(resolve => resolve(Promise.resolve(1))).then(() => void trail.push("resolved with a promise: reaction")));
everything.push(Promise.resolve().then(() => Promise.resolve(1)).then(() => void trail.push("a reaction returned a promise: next reaction")));

everything.push(Promise.all([1, Promise.resolve(2)]).then(() => void trail.push("all: reaction")));
everything.push(Promise.race([1, Promise.resolve(2)]).then(() => void trail.push("race: reaction")));
everything.push(Promise.allSettled([1]).then(() => void trail.push("allSettled: reaction")));
everything.push(Promise.any([1]).then(() => void trail.push("any: reaction")));

trail.push("script: everything is started");

await Promise.all(everything);
await null;
await null;

for (const line of trail) console.log(line);

export {};
