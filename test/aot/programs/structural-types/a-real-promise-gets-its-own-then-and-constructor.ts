function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

let log: string[] = [];

function plain(): Promise<number> {
  return Promise.resolve(1);
}

function withOwnThen(): Promise<number> {
  const p = Promise.resolve(1);
  Object.defineProperty(p, "then", {
    configurable: true,
    value(resolve: (n: number) => void): void {
      log.push("own then");
      resolve(1000);
    },
  });
  return p;
}

function withThenGetter(): Promise<number> {
  const p = Promise.resolve(1);
  const original = p.then;
  Object.defineProperty(p, "then", {
    configurable: true,
    get(): typeof original {
      log.push("get then");
      return original;
    },
  });
  return p;
}

function withOwnConstructor(): Promise<number> {
  const p = Promise.resolve(1);
  Object.defineProperty(p, "constructor", {
    configurable: true,
    get(): ObjectConstructor {
      log.push("get constructor");
      return Object;
    },
  });
  return p;
}

function withTheSameConstructor(): Promise<number> {
  const p = Promise.resolve(1);
  Object.defineProperty(p, "constructor", {
    configurable: true,
    get(): PromiseConstructor {
      log.push("get constructor");
      return Promise;
    },
  });
  return p;
}

function withAnotherPrototype(): Promise<number> {
  const p = Promise.resolve(1);
  const parent: Promise<number> = Object.create(Promise.prototype, {
    then: {
      value(this: Promise<number>, resolve: (n: number) => void): void {
        log.push("then of the new prototype");
        resolve(2000);
      },
    },
  });
  Object.setPrototypeOf(p, parent);
  return p;
}

async function awaited(p: Promise<number>): Promise<number> {
  return (await p) + 1;
}

const uses: [string, (p: Promise<number>) => Promise<unknown>][] = [
  ["await", awaited],
  ["returned from an async function", async p => p],
  ["Promise.resolve", p => Promise.resolve(p)],
  ["a resolve function", p => new Promise<number>(resolve => resolve(p))],
  ["a reaction's result", p => Promise.resolve().then(() => p)],
  ["Promise.all", p => Promise.all([p])],
  ["Promise.race", p => Promise.race([p])],
  ["Promise.allSettled", p => Promise.allSettled([p])],
  ["Promise.any", p => Promise.any([p])],
  ["for await", async p => {
    const out: number[] = [];
    for await (const n of [p]) out.push(n);
    return out;
  }],
  ["yield in an async generator", async p => {
    async function* source(): AsyncGenerator<number, void, void> {
      yield p;
    }
    return (await source().next()).value;
  }],
];

const makers: [string, () => Promise<number>][] = [
  ["plain", plain],
  ["own then", withOwnThen],
  ["then is a getter", withThenGetter],
  ["own constructor", withOwnConstructor],
  ["a getter for the same constructor", withTheSameConstructor],
  ["another prototype", withAnotherPrototype],
];

for (const [name, use] of uses) {
  for (const [label, make] of makers) {
    log = [];
    console.log(name + ", " + label + ": " + text(await use(make())) + " [" + log.join(", ") + "]");
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += await awaited(plain());
log = [];
console.log("2000 plain: " + warm + ", then another prototype: " + (await awaited(withAnotherPrototype())) + " [" + log.join(", ") + "]");

export {};
