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

class Money {
  constructor(public cents: number) {}
  toString(): string {
    log.push("toString");
    return this.cents + "c";
  }
  valueOf(): number {
    log.push("valueOf");
    return this.cents;
  }
  toJSON(): string {
    log.push("toJSON");
    return "json " + this.cents;
  }
  toLocaleString(): string {
    log.push("toLocaleString");
    return "local " + this.cents;
  }
  get [Symbol.toStringTag](): string {
    log.push("tag");
    return "Money";
  }
}

class Hinted {
  [Symbol.toPrimitive](hint: string): string | number {
    log.push(hint);
    return hint === "number" ? 7 : "seven";
  }
}

class Target {
  #value = 0;
  set value(n: number) {
    log.push("set value " + n);
    this.#value = n;
  }
  get value(): number {
    log.push("get value");
    return this.#value;
  }
}

class Source {
  get value(): number {
    log.push("source get");
    return 5;
  }
}

class Spreadable {
  length = 2;
  0 = "a";
  1 = "b";
  get [Symbol.isConcatSpreadable](): boolean {
    log.push("spreadable?");
    return true;
  }
}

class Odd {
  static [Symbol.hasInstance](value: unknown): boolean {
    log.push("hasInstance");
    return typeof value === "number" && value % 2 === 1;
  }
}

class Like {
  readonly [index: number]: number;
  get length(): number {
    log.push("length");
    return 2;
  }
  get 0(): number {
    log.push("0");
    return 10;
  }
  get 1(): number {
    log.push("1");
    return 20;
  }
}

attempt("String()", () => String(new Money(1)));
attempt("a template", () => `${new Money(2)}`);
attempt("joined with a text", () => new Money(3) + "");
attempt("arithmetic", () => [+new Money(4), new Money(4).cents * 2, Number(new Money(4)), Math.max(Object(new Money(4)))]);
attempt("compared", () => [new Money(1) < new Money(2), new Money(2) >= new Money(2)]);
attempt("JSON.stringify", () => JSON.stringify({ price: new Money(5), list: [new Money(6)] }));
attempt("join and toLocaleString of a list", () => [[new Money(7), new Money(8)].join("+"), [new Money(9)].toLocaleString(), String([new Money(10)])]);
attempt("as a key", () => Object.keys({ [String(new Money(11))]: 1, [`${new Hinted()}`]: 2 }));
attempt("Object.prototype.toString", () => Object.prototype.toString.call(new Money(12)));
attempt("hints", () => [`${new Hinted()}`, +new Hinted(), new Hinted() + "", new Date(Object(new Hinted())).getTime(), [1, 2, 3, 4, 5, 6, 7, 8][Object(new Hinted())]]);
attempt("Object.assign runs the setter of the target", () => {
  const target = new Target();
  Object.assign(target, { value: 3 });
  return target.value;
});
attempt("Object.assign runs no getter of a prototype", () => Object.keys(Object.assign({}, new Source())));
attempt("Object.assign runs an own getter", () => {
  const source = Object.defineProperty({}, "value", { get: () => (log.push("own get"), 6), enumerable: true });
  return Object.assign(new Target(), source).value;
});
attempt("a spread runs an own getter", () => {
  const source = {
    get a(): number {
      log.push("a");
      return 1;
    },
  };
  return { ...source }.a + Object.values(source)[0] + Object.entries(source)[0][1];
});
attempt("Reflect.set runs the setter", () => {
  const target = new Target();
  return [Reflect.set(target, "value", 4), Reflect.get(target, "value")];
});
attempt("concat asks whether to spread", () => ["x"].concat(Object(new Spreadable())));
attempt("instanceof asks the class", () => [Object(3) instanceof Odd, Object(4) instanceof Odd, Reflect.apply(Odd[Symbol.hasInstance], Odd, [5])]);
attempt("apply reads an array-like", () => Reflect.apply(Math.max, undefined, new Like()));
attempt("Array.from reads an array-like", () => Array.from(new Like()));
attempt("array methods on an array-like", () => [Array.prototype.map.call(new Like(), n => n), Array.prototype.indexOf.call(new Like(), 20), Array.prototype.join.call(new Like(), "-")]);
attempt("a typed array from an array-like", () => [...new Uint8Array(new Like())]);
attempt("defineProperties reads descriptors", () => {
  const descriptors = {
    get a(): PropertyDescriptor {
      log.push("descriptor of a");
      return { value: 1, enumerable: true };
    },
  };
  return Object.defineProperties({}, descriptors);
});
attempt("an error reads its cause, a text its message", () => {
  const options = {
    get cause(): string {
      log.push("cause");
      return "why";
    },
  };
  class Named extends Error {
    get name(): string {
      log.push("name");
      return "Named";
    }
  }
  return [new Error("m", options).cause, String(new Named("m"))];
});
attempt("a date turned into json", () => {
  class Stamp extends Date {
    toISOString(): string {
      log.push("toISOString");
      return "stamp";
    }
  }
  return [JSON.stringify(new Stamp(0)), new Stamp(0).toJSON()];
});
attempt("bind reads name and length", () => {
  const f = Object.defineProperties((a: number, b: number) => a + b, { name: { get: () => (log.push("name"), "n") }, length: { get: () => (log.push("length"), 3) } });
  const bound = f.bind(null, 1);
  return [bound.name, bound.length];
});

export {};
