function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

let log: string[] = [];
let made: IteratorResult<number>[] = [];

function result(n: number, last: boolean): IteratorResult<number> {
  const r = {
    extra: "more " + n,
    get value(): number {
      log.push("value " + n);
      return n;
    },
    get done(): boolean {
      log.push("done " + n);
      return last;
    },
  };
  made.push(r);
  return r;
}

class Watched implements Iterable<number> {
  limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  [Symbol.iterator](): Iterator<number> {
    log.push("iterator");
    let n = 0;
    const limit = this.limit;
    const iterator = {
      get next(): () => IteratorResult<number> {
        log.push("get next");
        return () => {
          n++;
          log.push("next " + n);
          return result(n, n > limit);
        };
      },
      get return(): () => IteratorResult<number> {
        log.push("get return");
        return () => {
          log.push("return");
          return result(-1, true);
        };
      },
    };
    return iterator;
  }
}

function* delegating(numbers: Iterable<number>): Generator<number, void, void> {
  yield* numbers;
}

const uses: [string, (numbers: Iterable<number>) => unknown][] = [
  ["for-of", numbers => {
    let sum = 0;
    for (const n of numbers) sum += n;
    return sum;
  }],
  ["for-of with a break", numbers => {
    for (const n of numbers) return n;
    return 0;
  }],
  ["for-of that ignores the value", numbers => {
    let count = 0;
    for (const _ of numbers) count++;
    return count;
  }],
  ["spread", numbers => [...numbers]],
  ["destructuring one", numbers => {
    const [a] = numbers;
    return a;
  }],
  ["destructuring with a gap", numbers => {
    const [, b] = numbers;
    return b;
  }],
  ["destructuring all and more", numbers => {
    const [a, b, c] = numbers;
    return [a, b, text(c)];
  }],
  ["Array.from", numbers => Array.from(numbers)],
  ["new Set", numbers => new Set(numbers).size],
  ["yield* under spread", numbers => [...delegating(numbers)]],
];

for (const [label, use] of uses) {
  log = [];
  made = [];
  console.log(label + ": " + text(use(new Watched(2))));
  console.log(label + " log: " + log.join(", "));
}

log = [];
made = [];
const outer = delegating(new Watched(2));
const first = outer.next();
console.log("yield* by hand log before a read: " + log.join(", "));
console.log("yield* hands on the very object: " + (first === made[0]));
console.log("keys " + Object.keys(first).join());
console.log("extra in it: " + ("extra" in first));
console.log("value " + text(first.value) + " done " + text(first.done));
console.log("log: " + log.join(", "));
log = [];
console.log("return through yield*: " + Object.keys(outer.return()).join());
console.log("log: " + log.join(", "));
