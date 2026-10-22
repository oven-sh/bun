interface Counter {
  (step: number): number;
  calls: number;
  label: string;
  reset(): void;
}

function makeCounter(): Counter {
  const counter: Counter = Object.assign(
    function count(step: number): number {
      counter.calls += 1;
      return step * 2;
    },
    {
      calls: 0,
      label: "counter",
      reset(): void {
        counter.calls = 0;
      },
    },
  );
  return counter;
}

function invoke(c: Counter): number {
  return c(2);
}

function callsPlusOne(c: Counter): number {
  return c.calls + 1;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;
}

function use(label: string, c: Counter): void {
  attempt(label + ", called", () => c(2));
  attempt(label + ", a typed function calls it", () => invoke(c));
  attempt(label + ", calls", () => c.calls);
  attempt(label + ", typeof calls", () => typeof c.calls);
  attempt(label + ", calls is a number", () => typeof c.calls === "number");
  attempt(label + ", calls is undefined", () => c.calls === undefined);
  attempt(label + ", reset is a function", () => typeof c.reset === "function");
  attempt(label + ", calls plus one", () => c.calls + 1);
  attempt(label + ", a typed function reads calls", () => callsPlusOne(c));
  attempt(label + ", the length of the label", () => c.label.length);
  attempt(label + ", reset", () => (c.reset(), c.calls));
  attempt(label + ", its name", () => c.name);
  attempt(label + ", its length", () => c.length);
  attempt(label + ", typeof", () => typeof c);
  attempt(label + ", through call", () => c.call(undefined, 3));
  attempt(label + ", through apply", () => c.apply(undefined, [4]));
  attempt(label + ", bound", () => c.bind(undefined, 5)());
  attempt(label + ", keys", () => Object.keys(c).join());
  attempt(label + ", a copy", () => JSON.stringify({ ...c }));
  attempt(label + ", instanceof Function", () => c instanceof Function);
  attempt(label + ", handed to map", () => [1, 2].map(c).join());
  attempt(label + ", calls stored", () => (c.calls = 50));
  attempt(label + ", calls incremented", () => ++c.calls);
  attempt(label + ", the label stored", () => (c.label = "stored"));
  attempt(label + ", called again", () => c(6) + c.calls);
}

class Holder {
  counter: Counter;
  constructor(counter: Counter) {
    this.counter = counter;
  }
}

function inPlaces(label: string, make: () => Counter): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.counter(2) + holder.counter.calls);
  const list: Counter[] = [makeCounter(), make()];
  attempt(label + ", an element", () => list[1](2) + list[1].calls);
  attempt(label + ", a result", () => make()(2));
}

function inALoop(label: string, write: (c: Counter) => void): void {
  const c = makeCounter();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(c);
      const value = c(1) + c.calls + c.label.length;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

const writes: [string, (c: Counter) => void][] = [
  ["calls becomes a string", c => { Object.defineProperty(c, "calls", { value: "text" }); }],
  ["calls becomes undefined", c => { Object.defineProperty(c, "calls", { value: undefined }); }],
  ["the label becomes a number", c => { Object.defineProperty(c, "label", { value: 7 }); }],
  ["reset becomes a number", c => { Object.defineProperty(c, "reset", { value: 5 }); }],
  ["reset becomes another function", c => { Object.defineProperty(c, "reset", { value: () => "nothing" }); }],
  ["the name is changed", c => { Object.defineProperty(c, "name", { value: "renamed" }); }],
  ["the name becomes a number", c => { Object.defineProperty(c, "name", { value: 5 }); }],
  ["the length is changed", c => { Object.defineProperty(c, "length", { value: 9 }); }],
  ["an own member named call", c => { Object.defineProperty(c, "call", { value: () => "own call" }); }],
  ["an own member named bind", c => { Object.defineProperty(c, "bind", { value: () => () => "own bind" }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) use("", makeCounter());
inPlaces("", makeCounter);
inALoop("", () => {});
quiet = false;

use("untouched", makeCounter());

for (const [label, write] of writes) {
  const c = makeCounter();
  attempt(label + ", the write itself", () => write(c));
  use(label, c);
  inPlaces(label, () => {
    const made = makeCounter();
    try {
      write(made);
    } catch {
      log.push("the write threw");
    }
    return made;
  });
  inALoop(label, write);
}

use("untouched afterwards", makeCounter());

export {};
