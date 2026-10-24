function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];

class Source implements Iterable<number> {
  how: string;
  constructor(how: string) {
    this.how = how;
  }
  [Symbol.iterator](): Iterator<number> {
    let n = 0;
    const how = this.how;
    return {
      next(): IteratorResult<number> {
        n++;
        log.push("next " + n);
        if (how === "next throws" && n === 2) throw new RangeError("next");
        return n > 3 ? { done: true, value: undefined } : { done: false, value: n };
      },
      return(): IteratorResult<number> {
        log.push("return");
        if (how === "return throws") throw new SyntaxError("return");
        if (how === "return gives a number") return JSON.parse("5");
        if (how === "return gives null") return JSON.parse("null");
        return { done: true, value: undefined };
      },
    };
  }
}

function leaveByBreak(numbers: Iterable<number>): string {
  let last = 0;
  for (const n of numbers) {
    last = n;
    if (n === 1) break;
  }
  return "broke at " + last;
}

function leaveByReturn(numbers: Iterable<number>): string {
  for (const n of numbers) return "returned at " + n;
  return "empty";
}

function leaveByThrow(numbers: Iterable<number>): string {
  for (const n of numbers) throw new EvalError("body " + n);
  return "empty";
}

function leaveByContinueOuter(numbers: Iterable<number>): string {
  let rounds = 0;
  outer: for (let i = 0; i < 2; i++) {
    for (const n of numbers) {
      rounds += n;
      continue outer;
    }
  }
  return "rounds " + rounds;
}

function leaveByPattern(numbers: Iterable<number>): string {
  const [a] = numbers;
  return "took " + a;
}

function patternDefaultThrows(numbers: Iterable<number | undefined>): string {
  const explode = (): number => {
    throw new EvalError("default");
  };
  const [a, b = explode()] = numbers;
  return "took " + a + " and " + b;
}

function runToTheEnd(numbers: Iterable<number>): string {
  let sum = 0;
  for (const n of numbers) sum += n;
  return "sum " + sum;
}

function* leaveInsideAGenerator(numbers: Iterable<number>): Generator<number, string, void> {
  for (const n of numbers) yield n;
  return "ended";
}

const kinds = ["well behaved", "return throws", "return gives a number", "return gives null", "next throws"];
const ways: [string, (numbers: Iterable<number>) => string][] = [
  ["break", leaveByBreak],
  ["return", leaveByReturn],
  ["throw", leaveByThrow],
  ["continue outer", leaveByContinueOuter],
  ["pattern", leaveByPattern],
  ["pattern with a default", patternDefaultThrows],
  ["to the end", runToTheEnd],
  ["a generator that is closed", numbers => {
    const g = leaveInsideAGenerator(numbers);
    g.next();
    return text(g.return("closed"));
  }],
  ["a generator that is thrown at", numbers => {
    const g = leaveInsideAGenerator(numbers);
    g.next();
    return text(g.throw(new URIError("thrown in")));
  }],
];

for (const kind of kinds) {
  for (const [label, leave] of ways) {
    log = [];
    let outcome: string;
    try {
      outcome = leave(new Source(kind));
    } catch (error) {
      outcome = failure(error);
    }
    console.log(kind + ", " + label + ": " + outcome + " [" + log.join(", ") + "]");
  }
}
