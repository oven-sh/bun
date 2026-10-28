type Step = (n: number) => number;

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function" || typeof value === "symbol") return typeof value;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  for (const key of Object.keys(value)) parts.push(key + ": " + show(Reflect.get(value, key)));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

const things = {
  honest: (n: number) => n + 1,
  texts: (n: number) => n + "!",
  nothingBack: () => undefined,
  bound: function (this: { by: number }, n: number) {
    return n + this.by;
  }.bind({ by: 5 }),
  proxied: new Proxy((n: number) => n + 1, {
    apply(target, self, list) {
      log.push("apply");
      return Reflect.apply(target, self, list);
    },
  }),
  onlyConstructs: class {
    constructor(public n: number) {}
  },
  later: async (n: number) => n + 1,
  generator: function* (n: number) {
    yield n;
  },
  native: Math.abs,
  twoOperands: Math.pow,
  usesThis: function (this: unknown, n: number) {
    return this === undefined ? n : -n;
  },
  countsOperands: function () {
    return arguments.length;
  },
  lookAlike: { call: () => 1, apply: () => 2, bind: () => () => 3, length: 1, name: "fake" },
  nothing: null,
  missing: undefined,
  number: 5,
  text: "f",
};
const names = Object.keys(things);

const opaque: object = things;

function get(name: string) {
  return Object.fromEntries(Object.entries(opaque))[name];
}

function twice(f: Step): number {
  return f(f(1));
}

class Machine {
  step: Step;
  constructor(name: string) {
    this.step = get(name);
  }
  run(): number {
    return this.step(1) + 1;
  }
}

console.log("honest callers: " + [twice(n => n + 1), twice(n => n * 3), twice(Math.sqrt)].join(" "));

const sinks: [string, (name: string) => unknown][] = [
  [
    "a local",
    name => {
      const f: Step = get(name);
      const result = f(1);
      return [result, result + 1, typeof result];
    },
  ],
  ["a parameter", name => twice(get(name))],
  ["a field", name => new Machine(name).run()],
  [
    "an element",
    name => {
      const steps: Step[] = [n => n + 1, get(name)];
      let total = 0;
      for (const f of steps) total += f(1);
      return [total, steps[1](2)];
    },
  ],
  [
    "a map value",
    name => {
      const map = new Map<string, Step>([["first", n => n + 1]]);
      map.set("second", get(name));
      let total = 0;
      for (const f of map.values()) total += f(1);
      return total;
    },
  ],
  [
    "a callback",
    name => {
      const f: Step = get(name);
      return [4, 9].map(f);
    },
  ],
  [
    "call, apply and bind",
    name => {
      const f: Step = get(name);
      return [f.call(undefined, 1), f.apply(undefined, [1]), f.bind(undefined, 1)()];
    },
  ],
  [
    "its members",
    name => {
      const f: Step = get(name);
      return [typeof f, f.length, f.name];
    },
  ],
];

for (const [sink, run] of sinks) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run("honest");
    rounds++;
  }
  console.log(sink + ": " + rounds + " honest rounds");
  for (const name of names) attempt(sink + ", " + name, () => run(name));
  attempt(sink + ", honest again", () => run("honest"));
}

export {};
