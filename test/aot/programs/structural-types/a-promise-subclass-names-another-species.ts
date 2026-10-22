let log: string[] = [];

class Other<T> extends Promise<T> {}

class Shifting<T> extends Promise<T> {
  static kind: PromiseConstructor = Promise;
  static get [Symbol.species](): PromiseConstructor {
    log.push("species");
    return Shifting.kind;
  }
}

function kind(value: unknown): string {
  if (value instanceof Shifting) return "Shifting";
  if (value instanceof Other) return "Other";
  if (value instanceof Promise) return "Promise";
  return typeof value;
}

const ready = (): Shifting<number> => new Shifting<number>(resolve => resolve(1));

const kinds: [string, PromiseConstructor][] = [
  ["Promise", Promise],
  ["Other", Other],
  ["Shifting", Shifting],
];

for (const [label, constructor] of kinds) {
  Shifting.kind = constructor;
  const uses: [string, () => Promise<unknown>][] = [
    ["then", () => ready().then(n => n)],
    ["catch", () => ready().catch(() => 0)],
    ["finally", () => ready().finally(() => {})],
    ["resolve", () => Shifting.resolve(1)],
    ["all", () => Shifting.all([1])],
    ["then of then", () => ready().then(n => n).then(n => n)],
  ];
  for (const [name, use] of uses) {
    log = [];
    const result = use();
    console.log("species " + label + ", " + name + ": " + kind(result) + ", settled " + JSON.stringify(await result) + " [" + log.join() + "]");
  }
  log = [];
  const n: number = await ready();
  console.log("species " + label + ", await: " + n + " [" + log.join() + "]");
  log = [];
  const back = await (async (): Promise<number> => ready())();
  console.log("species " + label + ", returned from an async function: " + back + " [" + log.join() + "]");
}

class Broken<T> extends Promise<T> {
  static get [Symbol.species](): PromiseConstructor {
    throw new RangeError("no species");
  }
}

const broken = new Broken<number>(resolve => resolve(2));
try {
  broken.then(n => n);
  console.log("a species getter that throws: then went through");
} catch (error) {
  console.log("a species getter that throws: then threw " + (error instanceof Error ? error.constructor.name : typeof error));
}
try {
  console.log("a species getter that throws: await gives " + (await broken));
} catch (error) {
  console.log("a species getter that throws: await threw " + (error instanceof Error ? error.constructor.name : typeof error));
}

export {};
