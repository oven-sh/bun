function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];

function source(members: string): Iterable<number, string> {
  return {
    [Symbol.iterator](): Iterator<number, string> {
      let n = 0;
      const iterator: Iterator<number, string> = {
        next(sent?: unknown): IteratorResult<number, string> {
          log.push("next " + text(sent));
          return ++n > 3 ? { done: true, value: "inner end" } : { done: false, value: n };
        },
      };
      if (members.includes("return")) {
        iterator.return = (value?: string): IteratorResult<number, string> => {
          log.push("return " + text(value));
          return members.includes("stubborn") ? { done: false, value: -5 } : { done: true, value: "inner closed" };
        };
      }
      if (members.includes("throw")) {
        iterator.throw = (error?: unknown): IteratorResult<number, string> => {
          log.push("throw " + text(error));
          return members.includes("ends") ? { done: true, value: "inner gave up" } : { done: false, value: -9 };
        };
      }
      return iterator;
    },
  };
}

function* outer(members: string): Generator<number, string, unknown> {
  try {
    const end: string = yield* source(members);
    log.push("yield* gave " + text(end));
    yield 50;
    return "outer end after " + end;
  } catch (error) {
    log.push("outer caught " + failure(error));
    return "outer recovered";
  } finally {
    log.push("outer finally");
  }
}

const kinds = ["only next", "return", "throw", "return and throw", "return, stubborn", "throw, ends", "return and throw, ends"];

for (const members of kinds) {
  for (const [label, act] of [
    ["return", (g: Generator<number, string, unknown>) => [g.return("asked"), g.next("after")]],
    ["throw", (g: Generator<number, string, unknown>) => [g.throw("raised"), g.next("after")]],
    ["next with a value", (g: Generator<number, string, unknown>) => [g.next("sent"), g.next()]],
  ] satisfies [string, (g: Generator<number, string, unknown>) => unknown][]) {
    log = [];
    const g = outer(members);
    g.next("first");
    let outcome: string;
    try {
      outcome = text(act(g));
    } catch (error) {
      outcome = failure(error);
    }
    console.log(members + ", " + label + ": " + outcome);
    console.log("  " + log.join(", "));
  }
}

function* overAnArray(): Generator<number, string, unknown> {
  try {
    yield* [1, 2, 3];
    return "array ran out";
  } finally {
    log.push("finally");
  }
}
log = [];
const a = overAnArray();
a.next();
console.log("an array, return: " + text(a.return("asked")) + " [" + log.join() + "]");
log = [];
const b = overAnArray();
b.next();
try {
  console.log("an array, throw: " + text(b.throw(new RangeError("raised"))));
} catch (error) {
  console.log("an array, throw: " + failure(error) + " [" + log.join() + "]");
}
