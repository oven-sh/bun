const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
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

class Range {
  constructor(
    public from: number,
    public to: number,
  ) {}
  [Symbol.iterator](): Iterator<number> {
    log.push("iterator");
    let next = this.from;
    const to = this.to;
    return {
      next: () => {
        log.push("next");
        return next <= to ? { done: false, value: next++ } : { done: true, value: undefined };
      },
      return: () => {
        log.push("return");
        return { done: true, value: undefined };
      },
    };
  }
}

class Pairs {
  *[Symbol.iterator](): Generator<[string, number]> {
    log.push("pairs");
    yield ["a", 1];
    yield ["b", 2];
  }
}

class Slow {
  async *[Symbol.asyncIterator](): AsyncGenerator<number> {
    log.push("async iterator");
    yield 1;
    yield 2;
  }
}

class Later {
  constructor(public value: number) {}
  then(resolve: (value: number) => void): void {
    log.push("then");
    resolve(this.value + 1);
  }
}

class Counted extends Map<string, number> {
  stores = 0;
  set(key: string, value: number): this {
    this.stores = (this.stores ?? 0) + 1;
    return super.set(key, value * 10);
  }
}

class Unique extends Set<number> {
  add(value: number): this {
    return super.add(value * 10);
  }
}

class Stack extends Array<number> {
  static get [Symbol.species](): ArrayConstructor {
    log.push("species");
    return Array;
  }
}

attempt("for of", () => {
  let total = 0;
  for (const n of new Range(1, 3)) total += n;
  return total;
});
attempt("for of that stops early", () => {
  for (const n of new Range(1, 3)) return n;
  return 0;
});
attempt("a spread, a pattern and operands", () => {
  const [first, ...rest] = new Range(1, 3);
  return [[...new Range(1, 2)], first, rest, Math.max(...new Range(1, 3))];
});
attempt("a pattern that takes one", () => {
  const [first] = new Range(1, 3);
  return first;
});
attempt("Array.from, a set, a typed array", () => [Array.from(new Range(1, 2)), new Set(new Range(1, 2)).size, [...new Uint8Array(new Range(1, 2))]]);
attempt("a map and an object from pairs", () => [new Map(new Pairs()).get("b"), new Map(new Pairs()).size]);
attempt("yield star", () => {
  function* all(): Generator<number> {
    yield* new Range(1, 2);
  }
  return [...all()];
});
attempt("Iterator.from and helpers", () => Iterator.from(new Range(1, 3)).map(n => n * 2).toArray());
attempt("Promise.all and Promise.race walk an iterable", () => [typeof Promise.all(new Range(1, 2)).then, typeof Promise.race(new Range(1, 1)).then]);
attempt("a map subclass made from pairs", () => {
  const counted = new Counted([
    ["a", 1],
    ["b", 2],
  ]);
  return [counted.get("a"), counted.get("b"), counted.size];
});
attempt("a set subclass made from a list", () => [...new Unique([1, 2])]);
attempt("the species of a list", () => {
  const stack = Stack.from([1, 2]);
  const mapped = stack.map(n => n + 1);
  return [mapped, mapped instanceof Stack, stack.filter(() => true) instanceof Stack, stack.slice() instanceof Stack];
});
attempt("sort and its comparator", () => [[3, 1, 2].toSorted((a, b) => b - a), new Float64Array([3, 1, 2]).sort((a, b) => b - a).join()]);
attempt("callbacks of a map and a set", () => {
  const seen: string[] = [];
  new Map([["k", 1]]).forEach((value, key) => seen.push(key + value));
  new Set([2]).forEach(value => seen.push("s" + value));
  return seen;
});

log.length = 0;
console.log("await a thenable -> " + (await new Later(1)) + " | " + log.join(" "));
log.length = 0;
console.log("Promise.resolve of a thenable -> " + (await Promise.resolve(new Later(2))) + " | " + log.join(" "));
log.length = 0;
console.log("Promise.all of thenables -> " + show(await Promise.all([new Later(3), new Later(4)])) + " | " + log.join(" "));
log.length = 0;
console.log("returned by an async function -> " + (await (async () => new Later(5))()) + " | " + log.join(" "));
log.length = 0;
console.log("returned by a handler -> " + show(await Promise.resolve(0).then((): unknown => new Later(6))) + " | " + log.join(" "));
log.length = 0;
let total = 0;
for await (const n of new Slow()) total += n;
console.log("for await -> " + total + " | " + log.join(" "));
log.length = 0;
total = 0;
for await (const n of new Range(1, 2)) total += n;
console.log("for await over a sync iterable -> " + total + " | " + log.join(" "));
log.length = 0;
console.log("Array.fromAsync -> " + show(await Array.fromAsync(new Slow())) + " | " + log.join(" "));

export {};
