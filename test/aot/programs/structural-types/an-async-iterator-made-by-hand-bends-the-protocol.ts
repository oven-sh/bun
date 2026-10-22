function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];

class Source implements AsyncIterable<number> {
  how: string;
  constructor(how: string) {
    this.how = how;
  }
  [Symbol.asyncIterator](): AsyncIterator<number> {
    let n = 0;
    const how = this.how;
    log.push("asyncIterator");
    return {
      next(): Promise<IteratorResult<number>> {
        n++;
        log.push("next " + n);
        if (n > 2) return Promise.resolve({ done: true, value: undefined });
        switch (how) {
          case "no done":
            return Promise.resolve({ value: n });
          case "parsed, not a promise":
            return JSON.parse('{"value":' + n + ',"done":false}');
          case "a promise of a number":
            return Promise.resolve(JSON.parse("5"));
          case "a promise of null":
            return Promise.resolve(JSON.parse("null"));
          case "next throws":
            throw new RangeError("next");
          case "next rejects":
            return Promise.reject(new TypeError("next"));
          case "the value is text":
            return Promise.resolve(JSON.parse('{"value":"text","done":false}'));
        }
        return Promise.resolve({ done: false, value: n });
      },
      return(): Promise<IteratorResult<number>> {
        log.push("return");
        if (how === "return rejects") return Promise.reject(new SyntaxError("return"));
        if (how === "return gives a number") return Promise.resolve(JSON.parse("7"));
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }
}

async function sum(numbers: AsyncIterable<number>): Promise<string> {
  let total = 0;
  const kinds: string[] = [];
  for await (const n of numbers) {
    kinds.push(typeof n);
    total += n;
  }
  return kinds.join() + " total " + text(total);
}

async function first(numbers: AsyncIterable<number>): Promise<string> {
  for await (const n of numbers) return "first " + text(n);
  return "empty";
}

async function bodyThrows(numbers: AsyncIterable<number>): Promise<string> {
  for await (const n of numbers) throw new EvalError("body " + n);
  return "empty";
}

async function* relay(numbers: AsyncIterable<number>): AsyncGenerator<number, void, void> {
  yield* numbers;
}

const kinds = [
  "well behaved",
  "no done",
  "parsed, not a promise",
  "a promise of a number",
  "a promise of null",
  "next throws",
  "next rejects",
  "the value is text",
  "return rejects",
  "return gives a number",
];

const uses: [string, (numbers: AsyncIterable<number>) => Promise<string>][] = [
  ["sum", sum],
  ["first", first],
  ["the body throws", bodyThrows],
  ["sum through yield*", numbers => sum(relay(numbers))],
  ["first through yield*", numbers => first(relay(numbers))],
];

for (const how of kinds) {
  for (const [label, use] of uses) {
    log = [];
    let outcome: string;
    try {
      outcome = await use(new Source(how));
    } catch (error) {
      outcome = failure(error);
    }
    console.log(how + ", " + label + ": " + outcome + " [" + log.join(", ") + "]");
  }
}

class Both implements AsyncIterable<number>, Iterable<number> {
  *[Symbol.iterator](): Generator<number, void, void> {
    yield 1;
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<number, void, void> {
    yield 2;
  }
}
async function either(numbers: AsyncIterable<number> | Iterable<number>): Promise<string> {
  const out: number[] = [];
  for await (const n of numbers) out.push(n);
  return out.join();
}
console.log("both protocols, for await: " + (await either(new Both())) + ", for-of: " + [...new Both()].join());
console.log("only the sync one: " + (await either([3])));

export {};
