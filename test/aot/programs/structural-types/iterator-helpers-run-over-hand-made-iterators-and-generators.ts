function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];

function handMade(limit: number): Iterator<number> {
  let n = 0;
  return {
    next(): IteratorResult<number> {
      n++;
      log.push("next " + n);
      return n > limit ? { done: true, value: undefined } : { value: n };
    },
    return(): IteratorResult<number> {
      log.push("return");
      return { done: true, value: undefined };
    },
  };
}

function* generated(limit: number): Generator<number, string, void> {
  try {
    for (let n = 1; n <= limit; n++) {
      log.push("yield " + n);
      yield n;
    }
    return "ran out";
  } finally {
    log.push("finally");
  }
}

const uses: [string, (numbers: IteratorObject<number, unknown, unknown>) => unknown][] = [
  ["toArray", numbers => numbers.toArray()],
  ["map", numbers => numbers.map((n, i) => n * 10 + i).toArray()],
  ["filter", numbers => numbers.filter(n => n % 2 === 1).toArray()],
  ["take 2", numbers => numbers.take(2).toArray()],
  ["take 0", numbers => numbers.take(0).toArray()],
  ["drop 2", numbers => numbers.drop(2).toArray()],
  ["flatMap", numbers => numbers.flatMap(n => [n, -n]).toArray()],
  ["reduce", numbers => numbers.reduce((sum, n) => sum + n, 100)],
  ["reduce without a start", numbers => numbers.reduce((sum, n) => sum + n)],
  ["some", numbers => numbers.some(n => n === 2)],
  ["every", numbers => numbers.every(n => n < 2)],
  ["find", numbers => numbers.find(n => n > 1)],
  ["find nothing", numbers => text(numbers.find(n => n > 100))],
  ["forEach", numbers => {
    const seen: string[] = [];
    numbers.forEach((n, i) => seen.push(n + "@" + i));
    return seen;
  }],
  ["a function that throws", numbers => numbers.map(n => {
    if (n === 2) throw new RangeError("two");
    return n;
  }).toArray()],
  ["a chain left by a break", numbers => {
    for (const n of numbers.map(n => n + 1).filter(n => n > 2)) return n;
    return -1;
  }],
  ["a helper is closed before it starts", numbers => text(numbers.map(n => n).return?.())],
  ["take of a fraction", numbers => numbers.take(1.9).toArray()],
  ["take of a negative number", numbers => numbers.take(-1).toArray()],
  ["take of not a number", numbers => numbers.take(NaN).toArray()],
];

const sources: [string, () => IteratorObject<number, unknown, unknown>][] = [
  ["hand made", () => Iterator.from(handMade(4))],
  ["generator", () => generated(4)],
  ["array", () => [1, 2, 3, 4].values()],
];

for (const [label, use] of uses) {
  for (const [kind, make] of sources) {
    log = [];
    let outcome: string;
    try {
      outcome = text(use(make()));
    } catch (error) {
      outcome = failure(error);
    }
    console.log(label + ", " + kind + ": " + outcome + " [" + log.join(", ") + "]");
  }
}

const wrapped = Iterator.from(handMade(1));
console.log("wrapped instanceof Iterator: " + (wrapped instanceof Iterator));
const g = generated(1);
const same: unknown = Iterator.from(g);
console.log("Iterator.from of a generator is the generator: " + (same === g));
console.log("a generator instanceof Iterator: " + (g instanceof Iterator));
