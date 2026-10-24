function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

const log: string[] = [];

class Tracked<T> extends Promise<T> {
  label = "tracked";
  constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void) {
    super(executor);
    log.push("constructed");
  }
  tagged(): string {
    return this.label;
  }
}

class PlainResults<T> extends Promise<T> {
  static get [Symbol.species](): PromiseConstructor {
    return Promise;
  }
}

function nameOf(promise: Promise<unknown>): string {
  return promise.constructor.name;
}

async function valueOf(promise: Promise<number>): Promise<number> {
  return (await promise) + 1;
}

async function plainAsync(): Promise<number> {
  return 1;
}

let warm = 0;
for (let i = 0; i < 500; i++) warm += (await valueOf(Promise.resolve(i))) + nameOf(Promise.resolve(i)).length;
console.log("after 500 plain promises", warm);

const makers: [string, () => Promise<number>][] = [
  ["new Tracked", () => new Tracked<number>(resolve => resolve(1))],
  ["Tracked.resolve", () => Tracked.resolve(1)],
  ["then", () => Tracked.resolve(1).then(value => value + 1)],
  ["then without a reaction", () => Tracked.resolve(1).then()],
  ["catch", () => Tracked.resolve(1).catch(() => 0)],
  ["finally", () => Tracked.resolve(1).finally(() => {})],
  ["Tracked.all", () => Tracked.all([1, 2]).then(values => values.length)],
  ["Tracked.race", () => Tracked.race([1, 2])],
  ["Promise.resolve of a tracked one", () => Promise.resolve(Tracked.resolve(1))],
  ["Tracked.resolve of a plain one", () => Tracked.resolve(Promise.resolve(1))],
  ["Tracked.resolve of a tracked one", () => Tracked.resolve(Tracked.resolve(1))],
  ["an async function", plainAsync],
  ["an async function that returns a tracked one", async () => Tracked.resolve(1)],
  ["species Promise: then", () => PlainResults.resolve(1).then(value => value)],
  ["species Promise: itself", () => PlainResults.resolve(1)],
  ["Promise.prototype.then applied", () => Reflect.apply(Promise.prototype.then, Tracked.resolve(1), [(value: number) => value])],
  ["withResolvers", () => {
    const { promise, resolve } = Tracked.withResolvers<number>();
    resolve(1);
    return promise;
  }],
];
for (const [name, make] of makers) {
  log.length = 0;
  const made = make();
  console.log(name + " -> " + show([nameOf(made), made instanceof Tracked, made instanceof Tracked ? made.tagged() : "no method", log.length, await valueOf(made)]));
}
console.log("the same object -> " + show([
  (tracked => Tracked.resolve(tracked) === tracked)(Tracked.resolve(1)),
  (tracked => Promise.resolve(tracked) === tracked)(Tracked.resolve(1)),
  (plain => Tracked.resolve(plain) === plain)(Promise.resolve(1)),
]));
attempt("a subclass whose constructor does not call the executor's way", () => {
  class Broken<T> extends Promise<T> {
    constructor() {
      super(() => {});
    }
  }
  return nameOf(new Broken<number>().then(() => 1));
});
attempt("then on what is no promise", () => Promise.prototype.then.call(Object.create(Promise.prototype), () => 1));

export {};
