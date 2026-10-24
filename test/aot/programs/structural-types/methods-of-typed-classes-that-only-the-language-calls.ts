export {};

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Money {
  constructor(public amount: number) {}
  toString(): string {
    log.push("toString");
    return "money " + this.amount;
  }
  valueOf(): number {
    log.push("valueOf");
    return this.amount;
  }
  toJSON(key: string): { amount: number; key: string } {
    log.push("toJSON");
    return { amount: this.amount, key };
  }
}

class Exact {
  constructor(public amount: number) {}
  [Symbol.toPrimitive](hint: string): number | string {
    log.push("toPrimitive:" + hint);
    return hint === "string" ? "exact " + this.amount : this.amount;
  }
  get [Symbol.toStringTag](): string {
    log.push("toStringTag");
    return "Exact";
  }
}

class Range {
  constructor(
    public from: number,
    public to: number,
  ) {}
  [Symbol.iterator](): Iterator<number> {
    log.push("iterator");
    let next = this.from;
    const last = this.to;
    return {
      next: () => {
        log.push("next");
        return next <= last ? { done: false, value: next++ } : { done: true, value: undefined };
      },
      return: () => {
        log.push("return");
        return { done: true, value: undefined };
      },
    };
  }
}

class Later {
  constructor(public value: number) {}
  then(resolve: (value: number) => void): void {
    log.push("then");
    resolve(this.value);
  }
}

class Resource {
  constructor(public name: string) {}
  [Symbol.dispose](): void {
    log.push("dispose:" + this.name);
  }
}

class Even {
  static [Symbol.hasInstance](value: unknown): boolean {
    log.push("hasInstance");
    return typeof value === "number" && value % 2 === 0;
  }
}

class Pattern {
  [Symbol.replace](text: string, by: string): string {
    log.push("replace");
    return text + by;
  }
  [Symbol.split](text: string): string[] {
    log.push("split");
    return [text, text];
  }
  [Symbol.search](text: string): number {
    log.push("search");
    return text.length;
  }
}

class Watched {
  #n = 1;
  get n(): number {
    log.push("get-n");
    return this.#n;
  }
  set n(value: number) {
    log.push("set-n:" + value);
    this.#n = value;
  }
}

class Setup {
  static ready = (log.push("static-field"), true);
  static {
    log.push("static-block");
  }
  field = (log.push("field"), 1);
  constructor(public given: number = (log.push("default"), 5)) {
    log.push("constructor");
  }
}
console.log("while the class was defined:", log.join(" "));

attempt("a template", () => `${new Money(1)}`);
attempt("an addition with a string", () => new Money(1) + "");
attempt("arithmetic", () => +new Money(2) * 2);
attempt("a comparison", () => new Money(1) < new Money(2));
attempt("loose equality", () => [new Money(1) == new Money(1), Number(new Money(1)) === 1]);
attempt("String and Number", () => [String(new Money(1)), Number(new Money(1))]);
attempt("as a key", () => Object.keys({ [String(new Money(1))]: 1 }));
attempt("join", () => [new Money(1), new Money(2)].join("+"));
attempt("JSON.stringify", () => JSON.stringify({ a: new Money(1), list: [new Money(2)] }));
attempt("toPrimitive: template, addition, arithmetic", () => [`${new Exact(1)}`, new Exact(1) + "", +new Exact(1)]);
attempt("toStringTag", () => Object.prototype.toString.call(new Exact(1)));
attempt("for-of", () => {
  let sum = 0;
  for (const n of new Range(1, 3)) sum += n;
  return sum;
});
attempt("for-of left early", () => {
  for (const n of new Range(1, 3)) if (n === 2) return n;
  return -1;
});
attempt("spread, destructuring, Array.from", () => {
  const [first] = new Range(5, 9);
  return [[...new Range(1, 2)], first, Array.from(new Range(1, 2)), Math.max(...new Range(1, 3)), new Set(new Range(1, 2)).size];
});
attempt("yield*", () => {
  function* all(): Generator<number> {
    yield* new Range(1, 2);
  }
  return [...all()];
});
attempt("instanceof", () => {
  const values: unknown[] = [2, 3, "2"];
  return values.map(v => v instanceof Even);
});
attempt("using", () => {
  {
    using a = new Resource("a");
    using b = new Resource("b");
    log.push("body:" + a.name + b.name);
  }
  return "left";
});
attempt("using, left by a throw", () => {
  using a = new Resource("a");
  throw new RangeError(a.name);
});
attempt("replace, split, search", () => ["t".replace(new Pattern(), "x"), "t".split(new Pattern()), "text".search(new Pattern())]);
attempt("accessors: read, store, update", () => {
  const w = new Watched();
  w.n = 2;
  w.n++;
  w.n += 5;
  return w.n;
});
attempt("accessors: destructuring, spread, assign, JSON, keys", () => {
  const w = new Watched();
  const { n } = w;
  return [n, { ...w }, Object.assign({}, w), JSON.stringify(w), Object.keys(w), "n" in w];
});
attempt("initializers", () => [new Setup().given, new Setup(1).given, Setup.ready]);
attempt("a tag function", () => {
  const tag = (strings: TemplateStringsArray, ...values: number[]): string => (log.push("tag"), strings.join("|") + values.join());
  return tag`a${1}b${2}c`;
});
attempt("callbacks of built-ins", () => {
  const compare = (a: number, b: number): number => (log.push("compare"), a - b);
  const replacer = (key: string, value: unknown): unknown => (log.push("replacer:" + key), value);
  const reviver = (key: string, value: unknown): unknown => (log.push("reviver:" + key), value);
  return [[2, 1].sort(compare), JSON.stringify({ a: 1 }, replacer), JSON.parse('{"a":1}', reviver).a, "ab".replace(/a/, m => (log.push("replace"), m + m))];
});
attempt("proxy traps", () => {
  const p = new Proxy(new Money(1), {
    get: (t, k, r) => (log.push("get:" + String(k)), Reflect.get(t, k, r)),
    has: (t, k) => (log.push("has:" + String(k)), Reflect.has(t, k)),
    ownKeys: t => (log.push("ownKeys"), Reflect.ownKeys(t)),
  });
  return [p.amount, "amount" in p, Object.keys(p)];
});
log.length = 0;
console.log("await of a thenable ->", await new Later(5), log.join(" "));
log.length = 0;
console.log("Promise.resolve of a thenable ->", await Promise.resolve(new Later(6)), log.join(" "));
log.length = 0;
console.log("an async function returns a thenable ->", await (async () => new Later(7))(), log.join(" "));
