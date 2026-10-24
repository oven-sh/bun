function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "rejected " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];

class Tracing<T> extends Promise<T> {
  static resolve(): Tracing<void>;
  static resolve<T>(value: T): Tracing<Awaited<T>>;
  static resolve(value?: unknown): Tracing<unknown> {
    log.push("resolve " + text(value));
    return new Tracing<unknown>(resolve => resolve(value));
  }
}

class PlusTen<T> extends Promise<T> {
  static resolve(): Promise<void>;
  static resolve<T>(value: T): Promise<Awaited<T>>;
  static resolve(value?: unknown): Promise<unknown> {
    log.push("plus ten " + text(value));
    return Promise.resolve(typeof value === "number" ? value + 10 : value);
  }
}

const inputs: [number, Promise<number>, number] = [1, Promise.resolve(2), 3];

const uses: [string, (type: PromiseConstructor) => Promise<unknown>][] = [
  ["all", type => type.all(inputs)],
  ["allSettled", type => type.allSettled(inputs)],
  ["race", type => type.race(inputs)],
  ["any", type => type.any(inputs)],
  ["all over a set", type => type.all(new Set([7, 8]))],
  ["all of nothing", type => type.all([])],
];

const types: [string, PromiseConstructor][] = [
  ["Promise", Promise],
  ["Tracing", Tracing],
  ["PlusTen", PlusTen],
];

for (const [name, use] of uses) {
  for (const [label, type] of types) {
    log = [];
    const result = use(type);
    console.log(name + " on " + label + ": " + result.constructor.name + " " + (await result.then(text, failure)) + " [" + log.join(", ") + "]");
  }
}

class NoResolve<T> extends Promise<T> {}
Object.defineProperty(NoResolve, "resolve", { value: 5 });
const broken: PromiseConstructor = NoResolve;
console.log("resolve is a number, all: " + (await broken.all([1]).then(text, failure)));
console.log("resolve is a number, race: " + (await broken.race([1]).then(text, failure)));
console.log("resolve is a number, all of nothing: " + (await broken.all([]).then(text, failure)));

export {};
