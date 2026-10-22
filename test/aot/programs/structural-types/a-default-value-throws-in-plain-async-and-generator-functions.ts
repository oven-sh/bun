function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return error instanceof Error ? error.constructor.name : text(error);
}

let log: string[] = [];

function raise(): number {
  log.push("default runs");
  throw new RangeError("no default");
}

function plain(n: number = raise()): number {
  log.push("body");
  return n;
}
const arrow = (n: number = raise()): number => {
  log.push("body");
  return n;
};
async function asynchronous(n: number = raise()): Promise<number> {
  log.push("body");
  return n;
}
const asyncArrow = async (n: number = raise()): Promise<number> => {
  log.push("body");
  return n;
};
function* generator(n: number = raise()): Generator<number, void, void> {
  log.push("body");
  yield n;
}
async function* asyncGenerator(n: number = raise()): AsyncGenerator<number, void, void> {
  log.push("body");
  yield n;
}
class Host {
  n: number;
  constructor(n: number = raise()) {
    log.push("body");
    this.n = n;
  }
  method(n: number = raise()): number {
    log.push("body");
    return n;
  }
  async later(n: number = raise()): Promise<number> {
    log.push("body");
    return n;
  }
  *steps(n: number = raise()): Generator<number, void, void> {
    log.push("body");
    yield n;
  }
}
async function patternOfNothing({ n }: { n: number } = missing()): Promise<number> {
  log.push("body");
  return n;
}
function missing(): { n: number } {
  log.push("default runs");
  return JSON.parse("null");
}

const host = new Host(0);

const calls: [string, (given: boolean) => unknown][] = [
  ["a function", given => (given ? plain(1) : plain())],
  ["an arrow", given => (given ? arrow(1) : arrow())],
  ["an async function", given => (given ? asynchronous(1) : asynchronous())],
  ["an async arrow", given => (given ? asyncArrow(1) : asyncArrow())],
  ["a generator", given => (given ? generator(1) : generator())],
  ["an async generator", given => (given ? asyncGenerator(1) : asyncGenerator())],
  ["a constructor", given => (given ? new Host(1) : new Host())],
  ["a method", given => (given ? host.method(1) : host.method())],
  ["an async method", given => (given ? host.later(1) : host.later())],
  ["a generator method", given => (given ? host.steps(1) : host.steps())],
  ["an async function whose pattern gets null", given => (given ? patternOfNothing({ n: 1 }) : patternOfNothing())],
];

for (const [label, call] of calls) {
  for (const given of [true, false]) {
    log = [];
    let outcome: string;
    try {
      const result = call(given);
      if (result instanceof Promise) outcome = "a promise came back, " + (await result.then(value => "fulfilled " + text(value), error => "rejected " + failure(error)));
      else outcome = "came back: " + Object.prototype.toString.call(result);
    } catch (error) {
      outcome = "threw at the call " + failure(error);
    }
    console.log(label + (given ? ", given" : ", not given") + ": " + outcome + " [" + log.join(", ") + "]");
  }
}

export {};
